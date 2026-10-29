import { useState } from "react";
import { Image as ImageIcon, PencilLine } from "lucide-react";
import { ImageViewer } from "./components/image-viewer";
import type { TurnArtifact, TurnSummaryData } from "./turn-summary";

/**
 * The turn-end summary: what the turn produced, so images and edited files are
 * visible without scrolling back through the transcript.
 */
export function TurnSummary({ data }: { data: TurnSummaryData }) {
  const [open, setOpen] = useState<TurnArtifact | null>(null);
  if (!data.artifacts.length && !data.files.length) return null;
  return <section aria-label="Turn summary" className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {data.artifacts.length > 0 && <span className="flex items-center gap-1.5"><ImageIcon className="size-3.5" aria-hidden="true" />{data.artifacts.length} image{data.artifacts.length === 1 ? "" : "s"}</span>}
      {data.files.length > 0 && <span className="flex items-center gap-1.5"><PencilLine className="size-3.5" aria-hidden="true" />{data.files.length} file{data.files.length === 1 ? "" : "s"} edited</span>}
    </div>
    {data.artifacts.length > 0 && <div className="mt-2 flex flex-wrap gap-2">
      {data.artifacts.map(artifact => artifact.data
        ? <button key={artifact.id} type="button" className="overflow-hidden rounded-md border border-border" title={artifact.prompt ?? artifact.path ?? "Generated image"} aria-label={artifact.prompt ?? "Generated image"} onClick={() => setOpen(artifact)}>
          <img src={`data:${artifact.mime};base64,${artifact.data}`} alt={artifact.prompt ?? "Generated image"} className="size-20 object-cover" />
        </button>
        : <span key={artifact.id} className="max-w-48 truncate rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">{artifact.path ?? "image"}</span>)}
    </div>}
    {data.files.length > 0 && <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={data.files.join("\n")}>{data.files.slice(0, 3).join(" · ")}{data.files.length > 3 ? ` · +${data.files.length - 3}` : ""}</p>}
    {open && <ImageViewer src={`data:${open.mime};base64,${open.data}`} alt={open.prompt ?? ""} title={open.path?.split(/[\\/]/u).pop() ?? "Image"} onClose={() => setOpen(null)} />}
  </section>;
}
