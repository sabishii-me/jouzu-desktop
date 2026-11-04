import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolView } from "../chat-projection";
import { ToolChipGroup, isRichTool } from "./tool-chip";

function tool(overrides: Partial<ToolView>): ToolView {
  return { id: "call-1", name: "bash", args: { command: "ls" }, phase: "complete", result: { content: [{ type: "text", text: "a" }] }, ...overrides };
}

describe("tool chips", () => {
  it("renders a compact group without a full card", () => {
    const html = renderToStaticMarkup(<ToolChipGroup tools={[tool({ id: "a" }), tool({ id: "b", name: "read" })]} />);
    expect(html).toContain('aria-label="Tool calls"');
    expect(html).toContain('aria-label="bash · done"');
    expect(html).toContain('aria-label="read · done"');
    expect(html).not.toContain("Completed");
  });

  it("keeps rich results as cards and standard tools as chips", () => {
    expect(isRichTool(tool({ name: "generate_image" }))).toBe(true);
    expect(isRichTool(tool({ name: "TaskUpdate" }))).toBe(true);
    expect(isRichTool(tool({ name: "bg_task" }))).toBe(true);
    expect(isRichTool(tool({ name: "bash" }))).toBe(false);
    expect(isRichTool(tool({ name: "web_fetch" }))).toBe(false);
  });
});
