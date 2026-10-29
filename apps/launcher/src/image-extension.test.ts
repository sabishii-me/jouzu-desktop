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

const imageBody = () => ({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: Buffer.from("jpeg").toString("base64") }] }] });

describe("generate_image extension", () => {
  let home = null;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.SHISA_API_KEY;
    setCredentialReader(async () => ({ type: "oauth", access: "test-token" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
    delete process.env.JOUZU_HOME;
  });

  it("registers one tool and a review handler, without asking in the tool text", () => {
    const { tool, handlers } = load();
    expect(tool.name).toBe("generate_image");
    expect(Object.keys(tool.parameters.properties)).toEqual(["prompt", "provider", "model", "size"]);
    expect(tool.parameters.required).toEqual(["prompt"]);
    expect(handlers.get("tool_call")).toHaveLength(1);
  });

  it("blocks a reviewed call when the user denies it, and never reaches the provider", async () => {
    home = homeWith({ image: { provider: "shisa", model: "m1", size: "1K" }, reviewTools: ["generate_image"] });
    process.env.JOUZU_HOME = home;
    const { handlers } = load();
    const ctx = { ui: { select: vi.fn().mockResolvedValue("Deny") } };
    const result = await handlers.get("tool_call")[0]({ toolName: "generate_image", input: { prompt: "a cat" } }, ctx);
    expect(result).toMatchObject({ block: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("remembers 'approve for this session' until the session restarts", async () => {
    home = homeWith({ reviewTools: ["generate_image"] });
    process.env.JOUZU_HOME = home;
    const { handlers } = load();
    const select = vi.fn().mockResolvedValue("Approve for this session");
    const ctx = { ui: { select } };
    expect(await handlers.get("tool_call")[0]({ toolName: "generate_image" }, ctx)).toBeUndefined();
    expect(await handlers.get("tool_call")[0]({ toolName: "generate_image" }, ctx)).toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);
    await handlers.get("session_start")[0]();
    expect(await handlers.get("tool_call")[0]({ toolName: "generate_image" }, ctx)).toBeUndefined();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("uses the configured model, calls the provider and saves the image", async () => {
    home = homeWith({ image: { provider: "shisa", model: "gemini-3-pro-image", size: "2K" } });
    process.env.JOUZU_HOME = home;
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => imageBody() } as Response);
    const { tool } = load();
    const result = await tool.execute("call", { prompt: "a cat" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
    expect(body.model).toBe("gemini-3-pro-image");
    expect(body.response_format.image_size).toBe("2K");
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    const saved = readdirSync(join(home, "artifacts", "images"));
    expect(saved).toHaveLength(1);
    expect(readFileSync(join(home, "artifacts", "images", saved[0])).toString()).toBe("jpeg");
  });

  it("defaults to the provider's first model instead of failing on an unset model", async () => {
    home = homeWith({ image: { provider: "shisa", model: "", size: "1K" } });
    process.env.JOUZU_HOME = home;
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ models: [{ name: "models/first-model" }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => imageBody() } as Response);
    const { tool } = load();
    await tool.execute("call", { prompt: "a cat" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1].body);
    expect(body.model).toBe("first-model");
  });

  it("reports a missing runtime credential as a sign-in problem", async () => {
    home = homeWith({ image: { provider: "shisa", model: "m1", size: "1K" } });
    process.env.JOUZU_HOME = home;
    setCredentialReader(async () => undefined);
    const { tool } = load();
    await expect(tool.execute("call", { prompt: "a cat" })).rejects.toThrow("Sign in to Shisa.AI");
  });
});
