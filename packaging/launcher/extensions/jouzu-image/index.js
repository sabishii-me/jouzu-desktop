// Jouzu Desktop's image generation tool. Installed into the agent's extension
// directory by the desktop; it is not part of the runtime.
//
// Authorization is the runtime's: the credential is read through the runtime's
// own API, never from a file we parse, and this tool never refreshes or stores it.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import shisa from "./providers/shisa.mjs";

const PROVIDERS = { [shisa.id]: shisa };
const SIZES = ["1K", "2K", "4K"];
const DEFAULT_PROVIDER = "shisa";
const DEFAULT_SIZE = "1K";
const DEFAULT_REVIEW = ["generate_image"];

export function home() {
  return process.env.JOUZU_HOME || join(process.env.LOCALAPPDATA || process.cwd(), "Shisa.ai", "JouzuDesktop", "data");
}

export function settingsPath() {
  return join(home(), "agent", "tools.json");
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
        },
        reviewTools: DEFAULT_REVIEW,
      };
    } catch {
      return { image: { enabled: true, provider: DEFAULT_PROVIDER, model: "", size: DEFAULT_SIZE }, reviewTools: DEFAULT_REVIEW };
    }
  }
}

/** The runtime's credential API. Injectable so the tests do not need the runtime. */
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

function extensionFor(mime) {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
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

export async function generate({ provider: requested, model, size, prompt }) {
  const current = await settings();
  if (!current.image.enabled) throw new Error("Image generation is disabled in Settings → Tools.");
  const provider = chooseProvider(current.image.provider, requested);
  const { token: value } = await token(provider.id);
  const chosenModel = await chooseModel(provider, model || current.image.model, value);
  const chosenSize = SIZES.includes(size) ? size : current.image.size;
  const result = await provider.generate(value, { model: chosenModel, size: chosenSize, prompt });
  const directory = join(home(), "artifacts", "images");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `image-${Date.now()}.${extensionFor(result.mime)}`);
  await writeFile(file, Buffer.from(result.data, "base64"));
  return { file, data: result.data, mime: result.mime, provider: provider.id, model: chosenModel, size: chosenSize };
}

export default function jouzuImage(pi) {
  const approved = new Set();

  pi.on("session_start", () => { approved.clear(); });

  pi.on("tool_call", async (event, ctx) => {
    const current = await settings();
    if (!current.reviewTools.includes(event.toolName) || approved.has(event.toolName)) return undefined;
    const choice = await ctx.ui.select("Review tool call", ["Approve", "Approve for this session", "Deny"], { timeout: 120_000 });
    if (choice === "Approve") return undefined;
    if (choice === "Approve for this session") { approved.add(event.toolName); return undefined; }
    return { block: true, reason: choice === "Deny" ? "The user declined this tool call." : "No response; the tool call was declined." };
  });

  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description:
      "Generate one image from a text prompt with the configured image provider. " +
      "The provider, model and size come from Settings → Tools unless passed here.",
    promptSnippet: "Generate an image from a prompt with the configured image provider",
    promptGuidelines: [
      "Use this when the user asks for an image.",
      "The user reviews this call before it runs; do not ask for approval in the message.",
      "The image is saved under the agent's artifacts/images directory and its path is returned.",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw." },
        provider: { type: "string", description: "Optional image provider id; defaults to Settings → Tools." },
        model: { type: "string", description: "Optional model; defaults to Settings → Tools or the provider's first model." },
        size: { type: "string", enum: SIZES, description: "Optional provider size setting." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params) {
      const result = await generate({
        provider: params.provider,
        model: params.model,
        size: params.size,
        prompt: String(params.prompt ?? "").trim(),
      });
      return {
        content: [
          { type: "text", text: `Generated an image (${result.provider}, ${result.model}, ${result.size}) and saved it to ${result.file}` },
          { type: "image", data: result.data, mimeType: result.mime },
        ],
        details: { file: result.file, provider: result.provider, model: result.model, size: result.size },
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
