import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Eye, FileText, FolderOpen, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { ImageViewer } from "./components/image-viewer";

interface ArtifactRecord {
  id: string;
  kind?: string;
  absolutePath?: string;
  prompt?: string;
  mimeType?: string;
  bytes?: number;
  createdAt?: string;
  dimensions?: { width?: number; height?: number };
  source?: { model?: string; provider?: string };
}

const isImage = (mime?: string) => !!mime && mime.startsWith("image/");
const isText = (mime?: string) => !!mime && (mime.startsWith("text/") || mime === "application/json" || mime.endsWith("+xml"));

function Thumb({ id, alt, onOpen }: { id: string; alt: string; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void invoke<{ mimeType: string; data: string }>("artifact_read", { id })
      .then(value => { if (alive) setSrc(`data:${value.mimeType};base64,${value.data}`); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return <button type="button" className="aspect-square w-full overflow-hidden rounded-md border border-border bg-muted/40" onClick={onOpen} title={alt}>
    {src ? <img src={src} alt={alt} loading="lazy" className="size-full object-cover" /> : null}
  </button>;
}

/** Everything the artifact store holds, newest first (0072). */
export function ArtifactsPanel({ sessionId }: { sessionId?: string } = {}) {
  const [items, setItems] = useState<ArtifactRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ src: string; title: string } | null>(null);
  const [viewingText, setViewingText] = useState<{ text: string; title: string } | null>(null);

  async function load() {
    try {
      const result = await invoke<{ artifacts: ArtifactRecord[] }>("artifact_list", sessionId ? { sessionId } : {});
      setItems(result.artifacts ?? []);
      setError(null);
    } catch (failure) {
      setError(String(failure));
      setItems([]);
    }
  }

  useEffect(() => { void load(); }, [sessionId]);

  async function view(item: ArtifactRecord) {
    try {
      const result = await invoke<{ mimeType: string; data: string }>("artifact_read", { id: item.id });
      const title = item.prompt?.slice(0, 120) || item.id;
      if (isImage(item.mimeType ?? result.mimeType)) {
        setViewing({ src: `data:${result.mimeType};base64,${result.data}`, title });
      } else if (isText(item.mimeType ?? result.mimeType)) {
        const bytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
        setViewingText({ text: new TextDecoder().decode(bytes), title });
      } else if (item.absolutePath) {
        await invoke("reveal_path", { path: item.absolutePath });
      } else {
        setError("This artifact has no preview.");
      }
    } catch (failure) {
      setError(String(failure));
    }
  }

  async function remove(item: ArtifactRecord) {
    const okay = await confirm("Delete this artifact? The file is removed from disk.", { title: "Delete artifact", kind: "warning" });
    if (!okay) return;
    try {
      await invoke("artifact_delete", { id: item.id });
      await load();
    } catch (failure) {
      setError(String(failure));
    }
  }

  return <Card className="border-border shadow-none">
    <CardHeader>
      <CardTitle>Artifacts</CardTitle>
      <CardDescription>{sessionId ? "Artifacts produced in this session." : "Generated files stored under the agent's artifacts folder, newest first."}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!items && !error && <p className="text-sm text-muted-foreground">Loading artifacts…</p>}
      {items && !items.length && <p className="text-sm text-muted-foreground">No artifacts yet. Generated files appear here.</p>}
      {items && items.length > 0 && <>
        <p className="text-xs text-muted-foreground">{items.length} artifact{items.length === 1 ? "" : "s"}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map(item => <div key={item.id} className="space-y-2">
            {isImage(item.mimeType)
              ? <Thumb id={item.id} alt={item.prompt ?? item.id} onOpen={() => void view(item)} />
              : <button type="button" className="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-muted/40" onClick={() => void view(item)} title={item.prompt ?? item.id}><FileText className="size-7 text-muted-foreground" /></button>}
            <p className="line-clamp-2 text-[11px] text-muted-foreground" title={item.prompt}>{item.prompt || item.id}</p>
            <p className="truncate text-[10px] text-muted-foreground">{[item.source?.model, item.dimensions?.width && item.dimensions?.height ? `${item.dimensions.width}×${item.dimensions.height}` : "", item.createdAt ? new Date(item.createdAt).toLocaleString() : ""].filter(Boolean).join(" · ")}</p>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void view(item)}><Eye className="size-3" />Open</Button>
              {item.absolutePath && <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => { void invoke("reveal_path", { path: item.absolutePath }).catch(() => {}); }}><FolderOpen className="size-3" />Reveal</Button>}
              <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px] text-destructive" onClick={() => void remove(item)}><Trash2 className="size-3" />Delete</Button>
            </div>
          </div>)}
        </div>
      </>}
    </CardContent>
    {viewing && <ImageViewer src={viewing.src} alt={viewing.title} title={viewing.title} onClose={() => setViewing(null)} />}
    {viewingText && <div role="dialog" aria-modal="true" aria-label={viewingText.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h3 className="min-w-0 truncate text-sm font-semibold">{viewingText.title}</h3>
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setViewingText(null)}>Close</Button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5">{viewingText.text}</pre>
      </div>
    </div>}
  </Card>;
}

