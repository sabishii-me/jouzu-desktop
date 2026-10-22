import { describe, expect, it } from "vitest";
import { readableTextGuardSnapshot } from "./textguard-bar";

describe("readableTextGuardSnapshot", () => {
  it("extracts text blocks from a serialized message envelope", () => {
    const body = JSON.stringify({ content: [{ type: "text", text: "---\nname: node-runtime-security" }] });
    expect(readableTextGuardSnapshot(body)).toBe("---\nname: node-runtime-security");
  });

  it("leaves plain reviewed text untouched", () => {
    expect(readableTextGuardSnapshot("plain reviewed text")).toBe("plain reviewed text");
  });
});
