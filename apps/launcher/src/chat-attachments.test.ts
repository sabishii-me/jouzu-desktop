import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_SEND_IMAGE_BASE64, MAX_SEND_TOTAL_BASE64, MAX_TOTAL_IMAGE_BYTES, base64Length, fitsSendBudget, readImageAttachment, removeSubmittedImages, validateImageBytes, validateImageSelection, type ImageAttachment } from "./chat-attachments";

const fileOf = (bytes: Uint8Array, name = "photo.png", type = "image/png") => ({
  name,
  type,
  size: bytes.length,
  arrayBuffer: async () => bytes.slice().buffer,
} as unknown as File);

const attachmentOf = (base64: number, id = "a"): ImageAttachment => ({
  id,
  name: "a.png",
  size: 1,
  image: { type: "image", data: "x".repeat(base64), mimeType: "image/png" },
});

const signatures = [
  ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
  ["image/jpeg", [255, 216, 255]],
  ["image/gif", [71, 73, 70, 56, 55, 97]],
  ["image/gif", [71, 73, 70, 56, 57, 97]],
  ["image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
] as const;
describe("image attachments", () => {
  it("uses mainstream per-image and total limits", () => {
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_TOTAL_IMAGE_BYTES).toBeGreaterThanOrEqual(MAX_IMAGE_BYTES);
  });
  it("accepts only the supported signatures and matching MIME", () => {
    for (const [mime, signature] of signatures) {
      expect(validateImageBytes(new Uint8Array(signature), mime)).toBe(mime);
      expect(() => validateImageBytes(new Uint8Array(signature.slice(0, -1)), mime)).toThrow();
      expect(() => validateImageBytes(new Uint8Array(signature), "text/plain")).toThrow();
    }
    expect(() => validateImageBytes(new Uint8Array(signatures[0][1]), "image/jpeg")).toThrow();
    expect(() => validateImageBytes(new Uint8Array([60, 115, 118, 103]), "image/png")).toThrow();
  });
  it("enforces combined raw byte and count limits including existing images", () => {
    const file = { type: "image/png", size: MAX_IMAGE_BYTES };
    expect(() => validateImageSelection([], [file])).not.toThrow();
    expect(() => validateImageSelection([{ size: MAX_TOTAL_IMAGE_BYTES }], [file])).toThrow(/20 MB/);
    expect(() => validateImageSelection([], Array(4).fill({ ...file, size: 1 }))).not.toThrow();
    expect(() => validateImageSelection([{ size: 1 }], Array(4).fill({ ...file, size: 1 }))).toThrow(/4 images/);
    for (const size of [0, -1, NaN, Infinity, 1.5]) expect(() => validateImageSelection([], [{ ...file, size }])).toThrow();
    expect(() => validateImageSelection([], [{ type: "image/svg+xml", size: 1 }])).toThrow(/only/);
    const large = new Uint8Array(MAX_IMAGE_BYTES + 1); large.set(signatures[0][1]);
    expect(() => validateImageBytes(large, "image/png")).toThrow();
  });
  it("removes only accepted submission identities, preserving later additions", () => {
    const attachment = (id: string): ImageAttachment => ({ id, name: "same.png", size: 8, image: { type: "image", data: "", mimeType: "image/png" } });
    const old = attachment("old"); const added = attachment("added");
    expect(removeSubmittedImages([old, added], [old])).toEqual([added]);
    expect(removeSubmittedImages([added], [old])).toEqual([added]);
  });
  it("reads asynchronously and emits raw base64, not a data URL", async () => {
    const bytes = new Uint8Array(signatures[0][1]);
    const result = await readImageAttachment(fileOf(bytes));
    expect(result.image).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
    expect(result.name).toBe("photo.png");
  });
  it("rejects unreadable and mismatched files", async () => {
    await expect(readImageAttachment(fileOf(new Uint8Array([1, 2, 3])))).rejects.toThrow(/contents/);
    await expect(readImageAttachment({ name: "changed.png", type: "image/png", size: 9, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer } as unknown as File)).rejects.toThrow(/size changed/);
  });
  it("keeps one message inside the runtime's flow submission budget", () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(0)).toBe(0);
    expect(fitsSendBudget([attachmentOf(MAX_SEND_IMAGE_BASE64)])).toBe(true);
    expect(fitsSendBudget([attachmentOf(MAX_SEND_TOTAL_BASE64 / 2), attachmentOf(MAX_SEND_TOTAL_BASE64 / 2, "b")])).toBe(true);
    expect(fitsSendBudget([attachmentOf(MAX_SEND_TOTAL_BASE64 + 4)])).toBe(false);
  });
});
