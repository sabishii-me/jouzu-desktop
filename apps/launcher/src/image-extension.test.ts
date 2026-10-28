// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../../../packaging/launcher/extensions/jouzu-image/index.js";

type Tool = {
  name: string;
  parameters: { properties: Record<string, unknown>; required: string[] };
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<Record<string, string>> }>;
};

function load() {
  const tools: Tool[] = [];
  extension({ registerTool: (tool: Tool) => tools.push(tool) });
  return tools[0];
}

function homeWithSettings(settings: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "jouzu-image-"));
  mkdirSync(join(home, "agent"), { recursive: true });
  writeFileSync(join(home, "agent", "image-generation.json"), JSON.stringify(settings));
  return home;
}

describe("generate_image extension", () => {
  let home: string | null = null;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.SHISA_API_KEY;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
    delete process.env.JOUZU_HOME;
    delete process.env.SHISA_API_KEY;
  });

  it("registers one paid tool with an explicit confirm flag", () => {
    const tool = load();
    expect(tool.name).toBe("generate_image");
    expect(Object.keys(tool.parameters.properties)).toEqual(["prompt", "model", "size", "confirm"]);
    expect(tool.parameters.required).toEqual(["prompt", "confirm"]);
  });

  it("does nothing without the user's confirmation", async () => {
    const tool = load();
    const result = await tool.execute("call", { prompt: "a cat" });
    expect(result.content[0].text).toContain("Not generated");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the Control Center model and size, calls the service and saves the image", async () => {
    home = homeWithSettings({ model: "gemini-3-pro-image", size: "2K" });
    process.env.JOUZU_HOME = home;
    process.env.SHISA_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: Buffer.from("jpeg").toString("base64") }] }] }),
    } as Response);

    const result = await load().execute("call", { prompt: "a cat", confirm: true });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.model).toBe("gemini-3-pro-image");
    expect(body.response_format.image_size).toBe("2K");
    expect(body.store).toBe(false);
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    const saved = readdirSync(join(home, "artifacts", "images"));
    expect(saved).toHaveLength(1);
    expect(readFileSync(join(home, "artifacts", "images", saved[0])).toString()).toBe("jpeg");
  });

  it("keeps the upstream failure message local and does not save anything", async () => {
    home = homeWithSettings({ model: "gemini-3.1-flash-image", size: "1K" });
    process.env.JOUZU_HOME = home;
    process.env.SHISA_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 311 }) } as Response);
    await expect(load().execute("call", { prompt: "a cat", confirm: true })).rejects.toThrow("shisa/image");
  });
});
