import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextGuardBar, type TextGuardData, type TextGuardItem } from "./textguard-bar";

const item: TextGuardItem = {
  id: "one",
  withheld: true,
  ticket: "ticket",
  source: "SKILL.md",
  digest: "a".repeat(64),
  severity: "error",
  review: {
    source: "SKILL.md",
    digest: "a".repeat(64),
    scanner: "test",
    status: "withheld",
    severity: { error: 1 },
  },
};

const emptyReview: TextGuardData = { ok: true, action: "inspect", sessionId: "session", mode: "on", items: [] };
const pendingReview: TextGuardData = { ...emptyReview, items: [item] };

function markup(data: TextGuardData | null, running: boolean, extra: { historical?: boolean; error?: string | null } = {}) {
  return renderToStaticMarkup(
    <TextGuardBar
      data={data}
      open={false}
      busy={false}
      running={running}
      error={extra.error ?? null}
      historical={extra.historical}
      onToggle={() => {}}
      onStop={() => {}}
      onAction={() => {}}
    />,
  );
}

describe("TextGuardBar actions", () => {
  it("drops Stop turn and Review once nothing is left, keeping the mode switchable", () => {
    const html = markup(emptyReview, true);
    expect(html).not.toContain("Stop turn");
    expect(html).not.toContain(">Review<");
    expect(html).toContain("TextGuard completed for this session");
    for (const mode of ["On", "Strict", "Off"]) expect(html).toContain(`>${mode}<`);
  });

  it("keeps Stop turn and Review while an item is waiting", () => {
    const html = markup(pendingReview, true);
    expect(html).toContain("Stop turn");
    expect(html).toContain(">Review<");
  });

  it("offers Review, not Stop turn, before the first payload arrives", () => {
    const html = markup(null, true);
    expect(html).toContain(">Review<");
    expect(html).not.toContain("Stop turn");
  });

  it("labels a transcript-only event historical and never completed", () => {
    const html = markup(null, false, { historical: true });
    expect(html).toContain("TextGuard withheld content in this session");
    expect(html).not.toContain("TextGuard completed");
    expect(html).toContain(">Review<");
  });

  it("hides Review once the historical review is known to be unavailable", () => {
    const html = markup(null, false, { historical: true, error: "This review is no longer available in the runtime." });
    expect(html).toContain("no longer available");
    expect(html).not.toContain(">Review<");
    expect(html).not.toContain("TextGuard completed");
  });
});
