// Jouzu Desktop's image generation tool. Installed into the agent's extension
// directory by the desktop; it is not part of the runtime.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://api.shisa.ai/image";
const SIZES = ["1K", "2K", "4K"];
const DEFAULT_MODEL = "gemini-3.1-flash-lite-image";
const DEFAULT_SIZE = "1K";

export function home() {
  return process.env.JOUZU_HOME || join(process.env.LOCALAPPDATA || process.cwd(), "Shisa.ai", "JouzuDesktop", "data");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** The Control Center's choice, written by the desktop. */
export async function settings() {
  try {
    const value = await readJson(join(home(), "agent", "image-generation.json"));
    return { model: typeof value.model === "string" ? value.model : undefined, size: typeof value.size === "string" ? value.size : undefined };
  } catch {
    return {};
  }
}

/** The launcher key first, then the signed-in runtime credential. */
export async function token() {
  const key = process.env.SHISA_API_KEY?.trim();
  if (key) return key;
  const auth = await readJson(join(home(), "agent", "auth.json"));
  const access = auth?.shisa?.access;
  if (typeof access !== "string" || !access.trim()) {
    throw new Error("Sign in to Shisa.AI, or add SHISA_API_KEY in Settings → Environment.");
  }
  return access.trim();
}

function failure(status, body) {
  const code = body?.code ?? body?.error?.code;
  if (status === 401) return "Sign in to Shisa.AI again to generate images.";
  if (status === 403 && code === 311) return "This key cannot use image generation (shisa/image).";
  if (status === 400) return "The model or image size was rejected.";
  if (status === 413) return "The prompt is too large.";
  if (status === 429 || status === 503) return "Image generation is busy. Try again in a moment.";
  return `Image generation failed (HTTP ${status}).`;
}

function extensionFor(mime) {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

export async function generate({ prompt, model, size }) {
  if (typeof model !== "string" || !/^[A-Za-z0-9._/-]{1,128}$/.test(model)) throw new Error("Unknown image model.");
  if (!SIZES.includes(size)) throw new Error("That image size is not available.");
  const text = String(prompt ?? "").trim();
  if (!text) throw new Error("Write a prompt first.");
  if (text.length > 32_000) throw new Error("The prompt is too large.");
  const bearer = await token();
  const response = await fetch(`${BASE}/v1beta/interactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: text, store: false, response_format: { type: "image", image_size: size } }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(failure(response.status, body));
  const image = (body?.steps ?? [])
    .flatMap(step => (Array.isArray(step?.content) ? step.content : []))
    .find(item => item?.type === "image");
  if (!image?.data) throw new Error("The answer contained no image.");
  const mime = image.mime_type ?? "image/png";
  return { data: image.data, mime, extension: extensionFor(mime) };
}

export default function jouzuImage(pi) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate one image with Shisa.AI from a text prompt. This consumes paid image tokens. " +
      "Always ask the user for approval first, then call again with confirm: true. " +
      "Without confirm: true nothing is generated.",
    promptSnippet: "Generate an image from a prompt with Shisa.AI (paid; ask the user first)",
    promptGuidelines: [
      "This tool costs image tokens, so confirm with the user before calling it.",
      "Show the model, image size and prompt in the question.",
      "Pass confirm: true only after the user agrees.",
      "The image is saved under the agent's artifacts/images directory and its path is returned.",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw." },
        model: { type: "string", description: "Image model; defaults to the Control Center choice." },
        size: { type: "string", enum: ["1K", "2K", "4K"], description: "Provider size setting; defaults to the Control Center choice." },
        confirm: { type: "boolean", description: "True only after the user approved the paid call." },
      },
      required: ["prompt", "confirm"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      if (params.confirm !== true) {
        return {
          content: [{
            type: "text",
            text: "Not generated. Ask the user to approve this paid image generation (show the model, size and prompt), then call generate_image again with confirm: true.",
          }],
        };
      }
      const saved = await settings();
      const model = params.model || saved.model || DEFAULT_MODEL;
      const size = params.size || saved.size || DEFAULT_SIZE;
      const result = await generate({ prompt: params.prompt, model, size });
      const directory = join(home(), "artifacts", "images");
      await mkdir(directory, { recursive: true });
      const file = join(directory, `image-${Date.now()}.${result.extension}`);
      await writeFile(file, Buffer.from(result.data, "base64"));
      return {
        content: [
          { type: "text", text: `Generated an image (${model}, ${size}) and saved it to ${file}` },
          { type: "image", data: result.data, mimeType: result.mime },
        ],
        details: { file, model, size },
      };
    },
  });
}
