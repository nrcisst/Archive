import { randomUUID } from "node:crypto";

const MAX_IMAGE_DATA_URL_LENGTH = 12_000_000;
const MAX_UPLOADS = 20;
const UPLOAD_TTL_MS = 10 * 60 * 1000;

interface CachedImageUpload {
  id: string;
  mimeType: string;
  base64Data: string;
  byteLength: number;
  createdAt: number;
  expiresAt: number;
}

type ImageUploadStore = Map<string, CachedImageUpload>;

declare global {
  var __archiveImageUploadStore: ImageUploadStore | undefined;
}

function getStore(): ImageUploadStore {
  globalThis.__archiveImageUploadStore ??= new Map();
  return globalThis.__archiveImageUploadStore;
}

function cleanupExpiredUploads(now = Date.now()) {
  const store = getStore();

  for (const [id, upload] of store.entries()) {
    if (upload.expiresAt <= now) {
      store.delete(id);
    }
  }

  while (store.size > MAX_UPLOADS) {
    const oldestId = store.keys().next().value;
    if (!oldestId) {
      break;
    }
    store.delete(oldestId);
  }
}

export function parseImageDataUrl(value: string): {
  mimeType: string;
  base64Data: string;
  byteLength: number;
} | null {
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return null;
  }

  const match = value.match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
  );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1];
  const base64Data = match[2];
  const byteLength = Math.ceil((base64Data.length * 3) / 4);

  return { mimeType, base64Data, byteLength };
}

export function saveImageUpload(imageDataUrl: string): CachedImageUpload | null {
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) {
    return null;
  }

  cleanupExpiredUploads();

  const now = Date.now();
  const upload: CachedImageUpload = {
    id: randomUUID(),
    ...parsed,
    createdAt: now,
    expiresAt: now + UPLOAD_TTL_MS,
  };

  getStore().set(upload.id, upload);
  cleanupExpiredUploads(now);

  return upload;
}

export function getImageUpload(id: string): CachedImageUpload | null {
  cleanupExpiredUploads();

  const upload = getStore().get(id);
  if (!upload) {
    return null;
  }

  if (upload.expiresAt <= Date.now()) {
    getStore().delete(id);
    return null;
  }

  return upload;
}
