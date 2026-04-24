import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { createSign } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type GeminiPart = Part;
export type GeminiContent = string | Array<string | GeminiPart>;
export type GeminiGenerationConfig = Record<string, unknown>;
export type GeminiTool = Record<string, unknown>;

interface GeminiModelConfig {
  model: string;
  generationConfig?: GeminiGenerationConfig;
  tools?: GeminiTool[];
}

interface GeminiGenerateOptions {
  timeout?: number;
}

interface GeminiGenerateResponseBody {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: Record<string, unknown>;
}

interface VertexServiceAccountCredentials {
  type: string;
  project_id?: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

type GeminiAuthMode =
  | {
      kind: "api-key";
      apiKey: string;
    }
  | {
      kind: "vertex-service-account";
      credentials: VertexServiceAccountCredentials;
      credentialsPath: string;
      projectId: string;
      location: string;
    };

interface VertexAccessTokenCache {
  accessToken: string;
  expiresAtMs: number;
  cacheKey: string;
}

const DEFAULT_TIMEOUT_MS = 30000;
const GOOGLE_TOKEN_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SERVICE_ACCOUNT_FILE_PATTERN = /^archiv.*\.json$/i;

let cachedGeminiAuthModePromise: Promise<GeminiAuthMode | null> | null = null;
let cachedGeminiDeveloperClient: GoogleGenerativeAI | null = null;
let cachedVertexAccessToken: VertexAccessTokenCache | null = null;
let loggedGeminiAuthMode: string | null = null;

function base64UrlEncodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createGeminiError(
  status: number,
  message: string,
  errorDetails?: unknown
): Error & { status: number; errorDetails?: unknown } {
  const error = new Error(message) as Error & {
    status: number;
    errorDetails?: unknown;
  };
  error.status = status;
  error.errorDetails = errorDetails;
  return error;
}

function extractResponseText(payload: GeminiGenerateResponseBody): string {
  const text = (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("");

  return text.trim();
}

function normalizeGeminiParts(content: GeminiContent): GeminiPart[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  return content.map((part) =>
    typeof part === "string" ? { text: part } : part
  );
}

async function findLocalServiceAccountPath(): Promise<string | null> {
  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  const entries = await readdir(process.cwd(), { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && SERVICE_ACCOUNT_FILE_PATTERN.test(entry.name))
    .map((entry) => path.join(process.cwd(), entry.name))
    .sort();

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    console.warn("[gemini] Multiple local service account files found", {
      files: matches.map((match) => path.basename(match)),
      selected: path.basename(matches[0]),
    });
  }

  return matches[0];
}

async function loadServiceAccountCredentials(): Promise<{
  credentials: VertexServiceAccountCredentials;
  credentialsPath: string;
} | null> {
  const credentialsPath = await findLocalServiceAccountPath();
  if (!credentialsPath) {
    return null;
  }

  try {
    const raw = await readFile(credentialsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<VertexServiceAccountCredentials>;

    if (
      parsed.type !== "service_account" ||
      !parsed.client_email ||
      !parsed.private_key
    ) {
      console.warn("[gemini] Ignoring invalid service account file", {
        file: path.basename(credentialsPath),
      });
      return null;
    }

    return {
      credentials: {
        type: parsed.type,
        project_id: parsed.project_id,
        private_key_id: parsed.private_key_id,
        private_key: parsed.private_key,
        client_email: parsed.client_email,
        token_uri: parsed.token_uri,
      },
      credentialsPath,
    };
  } catch (error) {
    console.warn("[gemini] Failed to load service account file", {
      file: path.basename(credentialsPath),
      error: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

async function resolveGeminiAuthMode(): Promise<GeminiAuthMode | null> {
  if (!cachedGeminiAuthModePromise) {
    cachedGeminiAuthModePromise = (async () => {
      const serviceAccount = await loadServiceAccountCredentials();

      if (serviceAccount) {
        const projectId =
          process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
          process.env.VERTEX_AI_PROJECT?.trim() ||
          serviceAccount.credentials.project_id?.trim();

        if (projectId) {
          const location =
            process.env.GOOGLE_CLOUD_LOCATION?.trim() ||
            process.env.VERTEX_AI_LOCATION?.trim() ||
            "global";

          return {
            kind: "vertex-service-account",
            credentials: serviceAccount.credentials,
            credentialsPath: serviceAccount.credentialsPath,
            projectId,
            location,
          } satisfies GeminiAuthMode;
        }

        console.warn("[gemini] Service account found but no project id is configured", {
          file: path.basename(serviceAccount.credentialsPath),
        });
      }

      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (apiKey) {
        return {
          kind: "api-key",
          apiKey,
        } satisfies GeminiAuthMode;
      }

      return null;
    })();
  }

  const authMode = await cachedGeminiAuthModePromise;

  if (authMode && loggedGeminiAuthMode !== authMode.kind) {
    loggedGeminiAuthMode = authMode.kind;

    if (authMode.kind === "vertex-service-account") {
      console.log("[gemini] Using Vertex AI service account auth", {
        projectId: authMode.projectId,
        location: authMode.location,
        credentialsFile: path.basename(authMode.credentialsPath),
      });
    } else {
      console.log("[gemini] Using Gemini API key auth");
    }
  }

  return authMode;
}

async function getVertexAccessToken(
  authMode: Extract<GeminiAuthMode, { kind: "vertex-service-account" }>
): Promise<string> {
  const cacheKey = `${authMode.projectId}:${authMode.credentials.client_email}`;
  if (
    cachedVertexAccessToken &&
    cachedVertexAccessToken.cacheKey === cacheKey &&
    cachedVertexAccessToken.expiresAtMs > Date.now() + 60_000
  ) {
    return cachedVertexAccessToken.accessToken;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  const tokenUri = authMode.credentials.token_uri || GOOGLE_TOKEN_URI;

  const unsignedJwt = [
    base64UrlEncodeJson({
      alg: "RS256",
      typ: "JWT",
      ...(authMode.credentials.private_key_id
        ? { kid: authMode.credentials.private_key_id }
        : {}),
    }),
    base64UrlEncodeJson({
      iss: authMode.credentials.client_email,
      scope: GOOGLE_TOKEN_SCOPE,
      aud: tokenUri,
      iat: issuedAt,
      exp: expiresAt,
    }),
  ].join(".");

  const signature = createSign("RSA-SHA256")
    .update(unsignedJwt)
    .sign(authMode.credentials.private_key, "base64url");
  const assertion = `${unsignedJwt}.${signature}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  const data = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !data?.access_token) {
    throw createGeminiError(
      response.status,
      data?.error_description ||
        data?.error ||
        `Failed to retrieve Vertex access token (${response.status})`
    );
  }

  cachedVertexAccessToken = {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + Math.max((data.expires_in || 3600) - 60, 0) * 1000,
    cacheKey,
  };

  return data.access_token;
}

async function generateWithApiKey(
  authMode: Extract<GeminiAuthMode, { kind: "api-key" }>,
  config: GeminiModelConfig,
  content: GeminiContent
): Promise<{ response: { text(): string; raw: unknown } }> {
  if (!cachedGeminiDeveloperClient) {
    cachedGeminiDeveloperClient = new GoogleGenerativeAI(authMode.apiKey);
  }

  const model = cachedGeminiDeveloperClient.getGenerativeModel({
    model: config.model,
    ...(config.generationConfig ? { generationConfig: config.generationConfig } : {}),
    ...(config.tools ? { tools: config.tools } : {}),
  });

  const result = await model.generateContent(content);
  return {
    response: {
      text: () => result.response.text(),
      raw: result.response,
    },
  };
}

async function generateWithVertex(
  authMode: Extract<GeminiAuthMode, { kind: "vertex-service-account" }>,
  config: GeminiModelConfig,
  content: GeminiContent,
  options?: GeminiGenerateOptions
): Promise<{ response: { text(): string; raw: unknown } }> {
  const accessToken = await getVertexAccessToken(authMode);
  const modelPath = `projects/${authMode.projectId}/locations/${authMode.location}/publishers/google/models/${config.model}`;

  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/${modelPath}:generateContent`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: normalizeGeminiParts(content),
          },
        ],
        ...(config.generationConfig
          ? { generationConfig: config.generationConfig }
          : {}),
        ...(config.tools?.length ? { tools: config.tools } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(options?.timeout || DEFAULT_TIMEOUT_MS),
    }
  );

  const data = (await response.json().catch(() => null)) as
    | (GeminiGenerateResponseBody & {
        error?: {
          code?: number;
          message?: string;
          details?: unknown;
        };
      })
    | null;

  if (!response.ok) {
    throw createGeminiError(
      response.status,
      data?.error?.message || `Vertex Gemini request failed (${response.status})`,
      data?.error?.details
    );
  }

  const payload = (data || {}) as GeminiGenerateResponseBody;

  return {
    response: {
      text: () => extractResponseText(payload),
      raw: payload,
    },
  };
}

export async function hasGeminiCredentials(): Promise<boolean> {
  return Boolean(await resolveGeminiAuthMode());
}

export function createGeminiModel(config: GeminiModelConfig) {
  return {
    async generateContent(content: GeminiContent, options?: GeminiGenerateOptions) {
      const authMode = await resolveGeminiAuthMode();
      if (!authMode) {
        throw createGeminiError(401, "No Gemini credentials configured");
      }

      if (authMode.kind === "vertex-service-account") {
        return generateWithVertex(authMode, config, content, options);
      }

      return generateWithApiKey(authMode, config, content);
    },
  };
}
