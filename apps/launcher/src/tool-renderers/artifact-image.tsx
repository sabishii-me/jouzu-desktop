import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Check, Copy, Download, FolderOpen, Maximize2, Quote } from "lucide-react";
import { Button } from "../components/ui/button";

export interface ArtifactImageData {
  mime: string;
  data: string;
  alt: string;
  path?: string;
  width?: number;
  height?: number;
}

const action = "size-7 shrink-0 p-0";

/**
 * One image result: the picture, a dimensions line and the artifact actions as
 * compact icon buttons. Used by the dedicated image renderer and by any generic
 * tool result that carries an image block.
 */
export function ArtifactImage({ image, caption, onUse }: { image: ArtifactImageData; caption?: string; onUse?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const src = `data:${image.mime};base64,${image.data}`;
  const name = image.path?.split(/[\\/]/u).pop() ?? "image.png";

  async function download() {
    if (!image.path) {
      const anchor = document.createElement("a");
      anchor.href = src;
      anchor.download = name;
      anchor.click();
      return;
    }
    // WebView2 ignores an anchor download, so pick a destination and copy the file.
    const target = await save({ defaultPath: name });
    if (target) await invoke("save_copy", { from: image.path, to: target });
  }

  return <figure className="space-y-1">
    <img src={src} alt={image.alt} className="max-h-80 w-full cursor-zoom-in rounded-md border border-border object-contain" onClick={() => setOpen(true)} />
    <figcaption className="flex flex-wrap items-center justify-between gap-2">
      {caption && <span className="text-[10px] text-muted-foreground">{caption}</span>}
      <div className="ml-auto flex flex-nowrap items-center justify-end gap-0.5">
        <Button variant="ghost" className={action} title="Open large image" aria-label="Open large image" onClick={() => setOpen(true)}><Maximize2 className="size-3.5" /></Button>
        <Button variant="ghost" className={action} title="Download" aria-label="Download" onClick={() => { void download().catch(() => {}); }}><Download className="size-3.5" /></Button>
        {image.path && <Button variant="ghost" className={action} title={copied ? "Path copied" : "Copy path"} aria-label="Copy path" onClick={async () => {
          try { await navigator.clipboard.writeText(image.path!); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { setCopied(false); }
        }}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button>}
        {image.path && <Button variant="ghost" className={action} title="Show in folder" aria-label="Show in folder" onClick={() => { void invoke("reveal_path", { path: image.path }).catch(() => {}); }}><FolderOpen className="size-3.5" /></Button>}
        {image.path && <Button variant="ghost" className={action} title="Use as attachment" aria-label="Use as attachment" onClick={() => { if (onUse) onUse(image.path!); else window.dispatchEvent(new CustomEvent("jouzu:use-artifact", { detail: image.path })); }}><Quote className="size-3.5" /></Button>}
      </div>
    </figcaption>
    {open && <div role="dialog" aria-label="Image preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setOpen(false)}><img src={src} alt={image.alt} className="max-h-full max-w-full rounded-lg" /></div>}
  </figure>;
}
