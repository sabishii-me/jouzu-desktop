import { ArtifactImage } from "./artifact-image";
import { StateDot } from "./activity-row";
import { imageBlocks } from "./tool-output";
import { record, type ToolRendererProps } from "./types";

/**
 * The image tool gets its own view: the picture is the result, so it stays
 * visible in the collapsed state instead of hiding behind a chevron.
 */
export function ImageRenderer({ tool }: ToolRendererProps) {
  const images = imageBlocks(tool.result);
  const details = record(record(tool.result)?.details);
  const prompt = typeof details?.prompt === "string" ? details.prompt : "";
  const model = typeof details?.model === "string" ? details.model : "";
  const size = typeof details?.size === "string" ? details.size : "";
  const metas = Array.isArray(details?.images) ? details.images : [];
  const items = images.map((image, index) => {
    const meta = record(metas[index]);
    return {
      ...image,
      alt: prompt || image.alt,
      path: typeof meta?.path === "string" ? meta.path : undefined,
      width: typeof meta?.width === "number" ? meta.width : undefined,
      height: typeof meta?.height === "number" ? meta.height : undefined,
    };
  });
  const summary = tool.phase === "running" ? "Generating…" : tool.phase === "error" ? "Failed" : `${items.length} image${items.length === 1 ? "" : "s"}${[model, size].filter(Boolean).length ? ` · ${[model, size].filter(Boolean).join(" · ")}` : ""}`;
  return <section aria-label="Generated image" className="overflow-hidden rounded-lg border border-border bg-card">
    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
      <StateDot state={tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done"} />
      <span className="text-xs font-medium">generate_image</span>
      <span className="min-w-0 truncate text-[10px] text-muted-foreground">{summary}</span>
    </header>
    {items.length ? <div className="grid gap-3 p-3 sm:grid-cols-2">
      {items.map((image, index) => <ArtifactImage key={index} image={image} caption={[model, size, image.width && image.height ? `${image.width}×${image.height}` : ""].filter(Boolean).join(" · ")} />)}
    </div> : <p className="p-3 text-xs text-muted-foreground">{tool.phase === "error" ? "The generation failed." : "Generating…"}</p>}
  </section>;
}
