import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolReviewDialog } from "./tool-review-dialog";

describe("tool review dialog", () => {
  it("renders the review body and the options the runtime sent", () => {
    const html = renderToStaticMarkup(<ToolReviewDialog title="Review tool call" body={"generate_image · 1 image\nThis runs 1 paid image generation."} options={["Approve", "Approve for this session", "Deny"]} disabled={false} onSelect={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Review tool call");
    expect(html).toContain("generate_image · 1 image");
    expect(html).toContain("1 paid image generation");
    expect(html).toContain("Approve");
    expect(html).toContain("Approve for this session");
    expect(html).toContain("Deny");
    expect(html).toContain("Cancel");
  });

  it("disables every action while the runtime is busy", () => {
    const html = renderToStaticMarkup(<ToolReviewDialog title="Review tool call" body="" options={["Deny"]} disabled onSelect={() => {}} onCancel={() => {}} />);
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
