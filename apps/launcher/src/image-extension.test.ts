// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension, { setCredentialReader } from "../../../packaging/launcher/extensions/jouzu-image/index.js";

function load() {
  const tools = [];
  const handlers = new Map();
  extension({
    registerTool: tool => tools.push(tool),
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  });
  return { tool: tools[0], handlers };
}

function homeWith(settings) {
  const home = mkdtempSync(join(tmpdir(), "jouzu-image-"));
  mkdirSync(join(home, "agent"), { recursive: true });
  if (settings) writeFileSync(join(home, "agent", "tools.json"), JSON.stringify(settings));
  return home;
}

// A PNG header is enough for the artifact dimension reader.
function png(width, height, payload = "x") {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(height, 4);
  return Buffer.concat([header, size, Buffer.from(payload)]);
}

const bytes = png(2816, 1536);
const imageBody = () => ({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: bytes.toString("base64") }] }] });
const ok = body => ({ ok: true, status: 200, json: async () => body });

describe("generate_image extension", () => {
  let home = null;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    setCredentialReader(async () => ({ type: "oauth", access: "test-token" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
    delete process.env.JOUZU_HOME;
  });

  it("registers one tool with a count, and a review handler", () => {
    const { tool, handlers } = load();
    expect(tool.name).toBe("generate_image");
    expect(Object.keys(tool.parameters.properties)).toEqual(["prompt", "count", "provider", "model", "size"]);
    expect(handlers.get("tool_call")).toHaveLength(1);
  });

  it("blocks a reviewed call when denied, and never reaches the provider", async () => {
    home = homeWith({ image: { provider: "shisa", model: "m1", size: "1K" }, reviewTools: ["generate_image"] });
    process.env.JOUZU_HOME = home;
    const { handlers } = load();
    const ctx = { ui: { select: vi.fn().mockResolvedValue("Deny") } };
    const result = await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "a cat" } }, ctx);
    expect(result).toMatchObject({ block: true });
    expect(fetch).not.toHaveBeenCalled();
    // Denying again simply asks again; the user may refuse as often as they like.
    await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "a cat" } }, ctx);
    expect(ctx.ui.select).toHaveBeenCalledTimes(2);
  });

  it("names the prompt and the number of paid generations in the review", async () => {
    home = homeWith({ image: { provider: "shisa", model: "gemini-3-pro-image", size: "2K" } });
    process.env.JOUZU_HOME = home;
    const { handlers } = load();
    const select = vi.fn().mockResolvedValue("Deny");
    await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "三只猫", count: 3 } }, { ui: { select } });
    const title = select.mock.calls[0][0];
    const body = JSON.parse(title.split("\n")[1]);
    expect(body.images).toBe(3);
    expect(body.prompt).toBe("三只猫");
    expect(body.provider).toBe("shisa");
  });

  it("remembers 'approve for this session' until the session restarts", async () => {
    home = homeWith({ reviewTools: ["generate_image"] });
    process.env.JOUZU_HOME = home;
    const { handlers } = load();
    const select = vi.fn().mockResolvedValue("Approve for this session");
    const ctx = { ui: { select } };
    await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "a cat" } }, ctx);
    await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "a cat" } }, ctx);
    expect(select).toHaveBeenCalledTimes(1);
    await handlers.get("session_start")[0]({}, {});
    await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "a cat" } }, ctx);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("saves one artifact with its prompt and dimensions, and returns the image", async () => {
    home = homeWith({ image: { provider: "shisa", model: "gemini-3-pro-image", size: "2K" } });
    process.env.JOUZU_HOME = home;
    vi.mocked(fetch).mockResolvedValue(ok(imageBody()));
    const { tool } = load();
    const result = await tool.execute("call-1", { prompt: "a cat" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
    expect(body.model).toBe("gemini-3-pro-image");
    expect(body.response_format.image_size).toBe("2K");
    expect(result.content.filter(block => block.type === "image")).toHaveLength(1);
    expect(result.content[0].text).toContain('Prompt: "a cat"');
    expect(result.details).toMatchObject({ prompt: "a cat", provider: "shisa", model: "gemini-3-pro-image", size: "2K", usage: null });
    expect(result.details.images).toHaveLength(1);
    const image = result.details.images[0];
    expect(image.width).toBe(2816);
    expect(image.height).toBe(1536);
    expect(image.path.endsWith(`${image.id}.png`)).toBe(true);
    const sidecar = JSON.parse(readFileSync(join(home, "artifacts", "images", `${image.id}.json`), "utf8"));
    expect(sidecar).toMatchObject({ kind: "images", prompt: "a cat", prompts: ["a cat"], mimeType: "image/png" });
    expect(sidecar.source.tool).toBe("generate_image");
  });

  it("defaults to the provider's first model instead of failing on an unset model", async () => {
    home = homeWith({ image: { provider: "shisa", model: "", size: "1K" } });
    process.env.JOUZU_HOME = home;
    vi.mocked(fetch).mockResolvedValueOnce(ok({ models: [{ name: "models/first-model" }] })).mockResolvedValueOnce(ok(imageBody()));
    const { tool } = load();
    await tool.execute("call", { prompt: "a cat" });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1].body).model).toBe("first-model");
  });

  it("generates the requested count and caps it by the settings", async () => {
    home = homeWith({ image: { provider: "shisa", model: "m1", size: "1K", maxImages: 2 } });
    process.env.JOUZU_HOME = home;
    vi.mocked(fetch).mockResolvedValue(ok(imageBody()));
    const { tool } = load();
    const result = await tool.execute("call", { prompt: "a cat", count: 5 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.details.images).toHaveLength(2);
    expect(result.content.filter(block => block.type === "image")).toHaveLength(2);
  });

  it("reuses the artifact id for identical bytes and appends the prompt", async () => {
    home = homeWith({ image: { provider: "shisa", model: "m1", size: "1K" } });
    process.env.JOUZU_HOME = home;
    vi.mocked(fetch).mockResolvedValue(ok(imageBody()));
    const { tool } = load();
    const first = await tool.execute("call-1", { prompt: "a cat" });
    const second = await tool.execute("call-2", { prompt: "a cat again" });
    expect(second.details.images[0].id).toBe(first.details.images[0].id);
    const files = readdirSync(join(home, "artifacts", "images")).filter(name => name.endsWith(".png"));
    expect(files).toHaveLength(1);
    const sidecar = JSON.parse(readFileSync(join(home, "artifacts", "images", `${first.details.images[0].id}.json`), "utf8"));
    expect(sidecar.prompts).toEqual(["a cat", "a cat again"]);
  });

  it("reports a missing runtime credential as a sign-in problem", async () => {
    home = homeWith({ image: { provider: "shisa", model: "m1", size: "1K" } });
    process.env.JOUZU_HOME = home;
    setCredentialReader(async () => undefined);
    const { tool } = load();
    await expect(tool.execute("call", { prompt: "a cat" })).rejects.toThrow("Sign in to Shisa.AI");
  });
});
