// Shisa.AI image provider. One implementation of the image provider interface;
// other providers are added beside this file.
const BASE = "https://api.shisa.ai/image";

async function failure(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const code = body?.code ?? body?.error?.code;
  if (response.status === 401) return "Sign in to Shisa.AI again to generate images.";
  if (response.status === 403 && code === 311) return "This account cannot use image generation (shisa/image).";
  if (response.status === 400) return "The model or image size was rejected.";
  if (response.status === 413) return "The prompt is too large.";
  if (response.status === 429 || response.status === 503) return "Image generation is busy. Try again in a moment.";
  return `Image generation failed (HTTP ${response.status}).`;
}

export default {
  id: "shisa",
  label: "Shisa.AI",

  async listModels(token) {
    const response = await fetch(`${BASE}/models`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(await failure(response));
    const body = await response.json().catch(() => null);
    const list = Array.isArray(body?.models) ? body.models : Array.isArray(body?.data) ? body.data : [];
    return list
      .map(item => item?.name ?? item?.id)
      .filter(value => typeof value === "string")
      .map(value => value.replace(/^models\//, "").trim())
      .filter(Boolean);
  },

  async generate(token, { model, size, prompt }) {
    const response = await fetch(`${BASE}/v1beta/interactions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model, input: prompt, store: false, response_format: { type: "image", image_size: size } }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(await failure(response));
    const body = await response.json().catch(() => null);
    const image = (body?.steps ?? [])
      .flatMap(step => (Array.isArray(step?.content) ? step.content : []))
      .find(item => item?.type === "image");
    if (!image?.data) throw new Error("The answer contained no image.");
    return { data: image.data, mime: image.mime_type ?? "image/png" };
  },
};
