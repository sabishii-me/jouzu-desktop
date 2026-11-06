import type { ChatImage } from "./chat-connection";
import { invoke } from "./host/invoke";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGES = 4;
/**
 * What one message may add to the runtime's Flow submission budget. That budget is
 * 4 MiB for the whole session lifetime and is never reclaimed, so an image has to
 * stay small enough that a normal session keeps working.
 */
export const MAX_SEND_IMAGE_BASE64 = 200 * 1024;
export const MAX_SEND_TOTAL_BASE64 = 600 * 1024;
export interface ImageAttachment { id: string; name: string; size: number; image: ChatImage }
type ImageFile = { type: string; size: number };

export function validateImageSelection(existing: readonly { size: number }[], files: readonly ImageFile[]) {
  if (existing.length + files.length > MAX_IMAGES) throw new Error("Attach at most 4 images.");
  for (const file of files) {
    if (!IMAGE_ACCEPT.split(",").includes(file.type)) throw new Error("Choose PNG, JPEG, WebP, or GIF images only.");
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Images must not be empty.");
  }
  if ([...existing, ...files].reduce((total, file) => total + file.size, 0) > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error("Images must total 20 MB or less.");
  }
}

// Check file signatures independently of filename and browser-provided MIME type.
// This is a format guard, not a full image decoder.
export function validateImageBytes(bytes: Uint8Array, mimeType: string): ChatImage["mimeType"] {
  const starts = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  const valid = mimeType === "image/png" ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mimeType === "image/jpeg" ? starts([255, 216, 255])
    : mimeType === "image/gif" ? starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97])
    : mimeType === "image/webp" ? starts([82, 73, 70, 70]) && bytes.length >= 12 && starts([87, 69, 66, 80], 8)
    : false;
  if (!valid || bytes.length > MAX_IMAGE_BYTES) throw new Error("Image contents do not match a supported image type or exceed 10 MB.");
  return mimeType as ChatImage["mimeType"];
}

export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export function fitsSendBudget(images: readonly ImageAttachment[]): boolean {
  const total = images.reduce((sum, item) => sum + item.image.data.length, 0);
  return total <= MAX_SEND_TOTAL_BASE64;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Shrink an oversized image until one message stays inside the runtime's
 * budget. The shrink loop runs in the Rust backend (NSH has no canvas); it
 * re-encodes to JPEG where the baseline used WebP.
 */
export async function fitForSend(bytes: Uint8Array, mimeType: ChatImage["mimeType"]): Promise<{ bytes: Uint8Array; mimeType: ChatImage["mimeType"] }> {
  if (base64Length(bytes.length) <= MAX_SEND_IMAGE_BASE64) return { bytes, mimeType };
  const result = await invoke<{ data: string; mimeType: ChatImage["mimeType"] }>("image_fit_send", { data: toBase64(bytes), mimeType });
  return { bytes: fromBase64(result.data), mimeType: result.mimeType };
}

export async function readImageAttachment(file: File): Promise<ImageAttachment> {
  validateImageSelection([], [file]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error("Image size changed while reading.");
  const mimeType = validateImageBytes(bytes, file.type);
  const prepared = await fitForSend(bytes, mimeType);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: prepared.bytes.length,
    image: { type: "image", data: toBase64(prepared.bytes), mimeType: prepared.mimeType },
  };
}

export function removeSubmittedImages(current: readonly ImageAttachment[], submitted: readonly ImageAttachment[]) {
  const ids = new Set(submitted.map(image => image.id));
  return current.filter(image => !ids.has(image.id));
}
