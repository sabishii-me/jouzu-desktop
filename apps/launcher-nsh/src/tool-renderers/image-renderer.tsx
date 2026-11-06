import { View, Text, computed } from "nsh";
import { ArtifactImage } from "./artifact-image";
import { ToolFrame } from "./tool-frame";
import { imageBlocks } from "./tool-output";
import { toolText, record, type ToolRendererProps } from "./types";
import { artifactPathFromText } from "./artifact-path";

/**
 * The image tool gets its own view: the picture is the result, so it stays
 * visible in the collapsed state instead of hiding behind a chevron.
 */
export function ImageRenderer(props: ToolRendererProps) {
  const view = computed(() => {
    const images = imageBlocks(props.tool.result);
    const details = record(record(props.tool.result)?.details);
    const prompt = typeof details?.prompt === "string" ? details.prompt : "";
    const model = typeof details?.model === "string" ? details.model : "";
    const size = typeof details?.size === "string" ? details.size : "";
    const metas = Array.isArray(details?.images) ? details.images : [];
    const fallbackPath = images.length === 1 ? artifactPathFromText(toolText(props.tool.result)) : undefined;
    const items = images.map((image, index) => {
      const meta = record(metas[index]);
      return {
        ...image,
        alt: prompt || image.alt,
        path: typeof meta?.path === "string" ? meta.path : fallbackPath,
        width: typeof meta?.width === "number" ? meta.width : undefined,
        height: typeof meta?.height === "number" ? meta.height : undefined,
      };
    });
    const summary = props.tool.phase === "running" ? "Generating…" : props.tool.phase === "error" ? "Failed" : `${items.length} image${items.length === 1 ? "" : "s"}${[model, size].filter(Boolean).length ? ` · ${[model, size].filter(Boolean).join(" · ")}` : ""}`;
    return { items, summary };
  });
  const state = computed(() => props.tool.phase === "running" ? "running" as const : props.tool.phase === "error" ? "error" as const : "done" as const);
  return <ToolFrame title="Generated image" subtitle={view().summary} state={state()} defaultOpen>
    <If when={view().items.length > 0} else={<Text class="text-xs text-muted-foreground">{props.tool.phase === "error" ? "The generation failed." : "Generating…"}</Text>}>
      <View class="flex-row flex-wrap gap-3">
        <Each of={view().items} key="index">{image => <View class="w-full max-w-96 flex-col"><ArtifactImage image={image()} caption={image().width && image().height ? `${image().width}×${image().height}` : undefined} /></View>}</Each>
      </View>
    </If>
  </ToolFrame>;
}