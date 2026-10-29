// Jouzu Desktop's image generation tool. Installed into the agent's extension
// directory by the desktop; it is not part of the runtime.
//
// Authorization is the runtime's: the credential is read through the runtime's
// own API, never from a file we parse, and this tool never refreshes or stores it.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { saveArtifact } from "./artifacts.mjs";
import shisa from "./providers/shisa.mjs";

const PROVIDERS = { [shisa.id]: shisa };
const SIZES = ["1K", "2K", "4K"];
const DEFAULT_PROVIDER = "shisa";
const DEFAULT_SIZE = "1K";
const DEFAULT_MAX_IMAGES = 3;
const DEFAULT_REVIEW = ["generate_image"];

export function home() {
  return process.env.JOUZU_HOME || join(process.env.LOCALAPPDATA || process.cwd(), "Shisa.ai", "JouzuDesktop", "data");
}

export function settingsPath() {
  return join(home(), "agent", "tools.json");
}

function maxImages(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(10, Math.max(1, Math.trunc(number))) : DEFAULT_MAX_IMAGES;
}

export async function settings() {
  try {
    const value = JSON.parse(await readFile(settingsPath(), "utf8"));
    return {
      image: {
        enabled: value?.image?.enabled !== false,
        provider: typeof value?.image?.provider === "string" ? value.image.provider : DEFAULT_PROVIDER,
        model: typeof value?.image?.model === "string" ? value.image.model : "",
        size: SIZES.includes(value?.image?.size) ? value.image.size : DEFAULT_SIZE,
        maxImages: maxImages(value?.image?.maxImages),
      },
      reviewTools: Array.isArray(value?.reviewTools) ? value.reviewTools.filter(item => typeof item === "string") : DEFAULT_REVIEW,
    };
  } catch {
    // Until the Tools page exists, the pre-Tools settings file still applies.
    try {
      const legacy = JSON.parse(await readFile(join(home(), "agent", "image-generation.json"), "utf8"));
      return {
        image: {
          enabled: true,
          provider: DEFAULT_PROVIDER,
          model: typeof legacy.model === "string" ? legacy.model : "",
          size: SIZES.includes(legacy.size) ? legacy.size : DEFAULT_SIZE,
          maxImages: DEFAULT_MAX_IMAGES,
        },
        reviewTools: DEFAULT_REVIEW,
      };
    } catch {
      return {
        image: { enabled: true, provider: DEFAULT_PROVIDER, model: "", size: DEFAULT_SIZE, maxImages: DEFAULT_MAX_IMAGES },
        reviewTools: DEFAULT_REVIEW,
      };
    }
  }
}

/**
 * Load a module from the runtime's installation. Node resolves bare imports
 * relative to this extension file, which is outside the app's node_modules, so
 * the runtime package is resolved from the app directory instead.
 */
async function runtimeModule(relative) {
  const roots = [];
  const bootstrap = process.argv[1];
  if (typeof bootstrap === "string" && /bootstrap\.mjs$/.test(bootstrap)) roots.push(dirname(bootstrap));
  roots.push(join(home(), "..", "app"));
  for (const root of roots) {
    const file = join(root, "node_modules", relative);
    if (existsSync(file)) return import(pathToFileURL(file).href);
  }
  throw new Error("The runtime's coding-agent package could not be found.");
}

/** The runtime's credential API. Injectable so the tests do not need the runtime. */
let credentialReader = async providerId => {
  // The runtime sets PI_CODING_AGENT_DIR; the CLI mode sets it from JOUZU_HOME.
  process.env.PI_CODING_AGENT_DIR ||= join(home(), "agent");
  const { readStoredCredential } = await runtimeModule("@earendil-works/pi-coding-agent/dist/index.js");
  return readStoredCredential(providerId);
};

export function setCredentialReader(reader) {
  credentialReader = reader;
}

export async function token(providerId) {
  const credential = await credentialReader(providerId);
  const value = credential?.access ?? credential?.key ?? credential?.apiKey;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(providerId === "shisa" ? "Sign in to Shisa.AI to generate images." : `No credential for ${providerId}.`);
  }
  return { token: value.trim(), type: credential?.type ?? "unknown" };
}

/** The provider the tool uses: explicit argument, settings, then the only one. */
export function chooseProvider(configured, requested) {
  const id = requested || configured || DEFAULT_PROVIDER;
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown image provider: ${id}`);
  return provider;
}

/** A model is always chosen when the provider lists one; only an empty list fails. */
export async function chooseModel(provider, configured, tokenValue) {
  if (configured) return configured;
  const models = await provider.listModels(tokenValue);
  if (!models.length) throw new Error("The provider lists no image models.");
  return models[0];
}

export function reviewBody({ toolName, input, image }) {
  const count = Math.min(maxImages(image.maxImages), Math.max(1, Math.trunc(Number(input?.count ?? 1)) || 1));
  const lines = [
    `${toolName} · ${count} image${count === 1 ? "" : "s"}`,
    `Prompt: ${input?.prompt ?? ""}`,
    `Provider: ${input?.provider || image.provider} · Model: ${input?.model || image.model || "(provider default)"} · Size: ${input?.size || image.size}`,
    `This runs ${count} paid image generation${count === 1 ? "" : "s"}.`,
  ];
  return { count, text: lines.join("\n") };
}

export async function generate({ provider: requested, model, size, prompt, count, sessionId, toolCallId }) {
  const current = await settings();
  if (!current.image.enabled) throw new Error("Image generation is disabled in Settings → Tools.");
  const provider = chooseProvider(current.image.provider, requested);
  const { token: value } = await token(provider.id);
  const chosenModel = await chooseModel(provider, model || current.image.model, value);
  const chosenSize = SIZES.includes(size) ? size : current.image.size;
  const total = Math.min(maxImages(current.image.maxImages), Math.max(1, Math.trunc(Number(count ?? 1)) || 1));
  const images = [];
  for (let index = 0; index < total; index += 1) {
    const result = await provider.generate(value, { model: chosenModel, size: chosenSize, prompt });
    const bytes = Buffer.from(result.data, "base64");
    const artifact = await saveArtifact({
      home: home(),
      kind: "images",
      mimeType: result.mime,
      bytes,
      prompt,
      source: { tool: "generate_image", provider: provider.id, model: chosenModel, sessionId, toolCallId },
    });
    images.push({
      id: artifact.id,
      data: result.data,
      mimeType: artifact.mimeType,
      path: join(home(), "artifacts", artifact.path),
      bytes: artifact.bytes,
      width: artifact.dimensions?.width ?? null,
      height: artifact.dimensions?.height ?? null,
    });
  }
  return { provider: provider.id, model: chosenModel, size: chosenSize, images };
}

export default function jouzuImage(pi) {
  const approved = new Set();
  let sessionId = "";

  pi.on("session_start", (_event, ctx) => {
    approved.clear();
    try { sessionId = ctx?.sessionManager?.getSessionId?.() ?? ""; } catch { sessionId = ""; }
  });

  pi.on("tool_call", async (event, ctx) => {
    const current = await settings();
    if (!current.reviewTools.includes(event.toolName) || approved.has(event.toolName)) return undefined;
    const { text } = reviewBody({ toolName: event.toolName, input: event.input, image: current.image });
    const choice = await ctx.ui.select(`Review tool call\n${text}`, ["Approve", "Approve for this session", "Deny"], { timeout: 120_000 });
    if (choice === "Approve") return undefined;
    if (choice === "Approve for this session") { approved.add(event.toolName); return undefined; }
    return { block: true, reason: choice === "Deny" ? "The user declined this tool call." : "No response; the tool call was declined." };
  });

  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate one to a few images from a text prompt with the configured image provider. " +
      "The provider, model and size come from Settings → Tools unless passed here.",
    promptSnippet: "Generate images from a prompt with the configured image provider",
    promptGuidelines: [
      "Use this when the user asks for an image.",
      "The user reviews this call before it runs; do not ask for approval in the message.",
      "Each image is stored as an artifact and its path is returned.",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw." },
        count: { type: "integer", minimum: 1, description: "How many images; defaults to 1, capped by Settings → Tools." },
        provider: { type: "string", description: "Optional image provider id; defaults to Settings → Tools." },
        model: { type: "string", description: "Optional model; defaults to Settings → Tools or the provider's first model." },
        size: { type: "string", enum: SIZES, description: "Optional provider size setting." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(toolCallId, params) {
      const prompt = String(params.prompt ?? "").trim();
      const result = await generate({
        provider: params.provider,
        model: params.model,
        size: params.size,
        count: params.count,
        prompt,
        sessionId,
        toolCallId,
      });
      const lines = result.images.map((image, index) => `${index + 1}. ${image.path}`).join("\n");
      return {
        content: [
          { type: "text", text: `Generated ${result.images.length} image${result.images.length === 1 ? "" : "s"}.\nPrompt: "${prompt}"\nProvider: ${result.provider} · Model: ${result.model} · Size: ${result.size}\n${lines}` },
          ...result.images.map(image => ({ type: "image", data: image.data, mimeType: image.mimeType })),
        ],
        details: {
          prompt,
          provider: result.provider,
          model: result.model,
          size: result.size,
          images: result.images.map(({ data: _data, ...image }) => image),
          usage: null,
        },
      };
    },
  });
}

// CLI entry for the desktop's Tools page: node index.js --providers | --models <id>
const invoked = typeof process.argv[1] === "string" && /index\.(m?js)$/.test(process.argv[1]);
if (invoked && process.argv[2]?.startsWith("--")) {
  const command = process.argv[2];
  try {
    if (command === "--providers") {
      const list = Object.values(PROVIDERS).map(provider => ({ id: provider.id, label: provider.label ?? provider.id }));
      process.stdout.write(`${JSON.stringify({ providers: list })}\n`);
    } else if (command === "--models") {
      const provider = chooseProvider(process.argv[3] || DEFAULT_PROVIDER);
      const { token: value } = await token(provider.id);
      const models = await provider.listModels(value);
      process.stdout.write(`${JSON.stringify({ models })}\n`);
    } else {
      process.stderr.write(`Unknown command: ${command}\n`);
      process.exitCode = 2;
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error?.message ?? error) })}\n`);
    process.exitCode = 1;
  }
}
