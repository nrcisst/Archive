import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseAuditResponse } from "@/lib/schema";
import { buildTextPrompt, buildImagePrompt } from "@/lib/prompt-builder";
import { MOCK_AUDIT } from "@/lib/mock-data";
import { getImageUpload, parseImageDataUrl } from "@/lib/image-upload-cache";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

/**
 * Extract retry delay from a Gemini 429 error, if available.
 * Falls back to exponential backoff.
 */
function getRetryDelay(error: unknown, attempt: number): number {
  // Try to parse the server-suggested retry delay
  if (error && typeof error === "object") {
    const errObj = error as Record<string, unknown>;

    // Check for retryDelay in errorDetails
    if (Array.isArray(errObj.errorDetails)) {
      for (const detail of errObj.errorDetails) {
        if (
          detail &&
          typeof detail === "object" &&
          "@type" in detail &&
          String(detail["@type"]).includes("RetryInfo") &&
          "retryDelay" in detail
        ) {
          const delayStr = String(detail.retryDelay);
          const seconds = parseFloat(delayStr.replace("s", ""));
          if (!isNaN(seconds) && seconds > 0) {
            console.log(`[audit] Server suggested retry in ${seconds}s`);
            return Math.ceil(seconds * 1000);
          }
        }
      }
    }

    // Check the error message for "Please retry in Xs"
    const msg = String(errObj.message || "");
    const match = msg.match(/retry in ([\d.]+)s/i);
    if (match) {
      const seconds = parseFloat(match[1]);
      if (!isNaN(seconds) && seconds > 0) {
        console.log(`[audit] Parsed retry delay from message: ${seconds}s`);
        return Math.ceil(seconds * 1000);
      }
    }
  }

  // Exponential backoff: 2s, 4s, 8s
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  console.log(`[audit] Using exponential backoff: ${delay}ms`);
  return delay;
}

function is429Error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errObj = error as Record<string, unknown>;
  return (
    errObj.status === 429 ||
    String(errObj.message || "").includes("429") ||
    String(errObj.message || "").includes("Too Many Requests")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Gemini with retry logic for transient 429 rate limits.
 * Retries up to MAX_RETRIES times with server-suggested or exponential backoff delays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callWithRetry(fn: () => Promise<any>) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (is429Error(error) && attempt < MAX_RETRIES) {
        const delay = getRetryDelay(error, attempt);
        console.warn(
          `[audit] 429 rate limit hit (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }

      // Not a 429 or out of retries — throw
      throw error;
    }
  }

  throw lastError;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, image_base64, image_upload_id, occasion, budget } = body as {
      prompt?: string;
      image_base64?: string;
      image_upload_id?: string;
      occasion?: string;
      budget?: string;
    };

    // Validate: need at least a prompt or an image
    if (!prompt && !image_base64 && !image_upload_id) {
      return Response.json(
        { error: "Please provide a text prompt or an image." },
        { status: 400 }
      );
    }

    // Check API key
    if (!process.env.GEMINI_API_KEY) {
      console.warn("[audit] No GEMINI_API_KEY, returning mock data");
      return Response.json({ audit: MOCK_AUDIT });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let result;
    const uploadedImage = image_upload_id
      ? getImageUpload(image_upload_id)
      : null;
    const requestImage = image_base64 ? parseImageDataUrl(image_base64) : null;
    const imagePayload = uploadedImage || requestImage;

    if ((image_upload_id || image_base64) && !imagePayload) {
      return Response.json(
        {
          error:
            image_upload_id && !image_base64
              ? "Uploaded image expired. Please submit the photo again."
              : "Invalid image data.",
        },
        { status: image_upload_id && !image_base64 ? 410 : 400 }
      );
    }

    if (imagePayload) {
      // Image flow: send image + prompt to Gemini vision
      const imagePrompt = buildImagePrompt(occasion, budget);

      console.log("[audit] Using image input", {
        source: uploadedImage ? "pre-upload" : "request-body",
        byteLength: imagePayload.byteLength,
        mimeType: imagePayload.mimeType,
      });

      result = await callWithRetry(() =>
        model.generateContent([
          imagePrompt,
          {
            inlineData: {
              mimeType: imagePayload.mimeType,
              data: imagePayload.base64Data,
            },
          },
        ])
      );
    } else {
      // Text-only flow
      const textPrompt = buildTextPrompt(prompt!, occasion, budget);
      result = await callWithRetry(() =>
        model.generateContent(textPrompt)
      );
    }

    const responseText = result.response.text();
    console.log("[audit] Raw model response length:", responseText.length);

    // Parse and validate the response
    const audit = parseAuditResponse(responseText);

    if (!audit) {
      console.error("[audit] Schema validation failed, falling back to mock");
      console.error("[audit] Raw response:", responseText.slice(0, 500));
      return Response.json({ audit: MOCK_AUDIT, _fallback: true });
    }

    return Response.json({ audit });
  } catch (error) {
    console.error("[audit] Error:", error);

    // Graceful fallback: return mock data instead of crashing
    return Response.json(
      { audit: MOCK_AUDIT, _fallback: true, _error: "Model call failed" },
      { status: 200 }
    );
  }
}
