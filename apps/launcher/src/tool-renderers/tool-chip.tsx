import { useId, useState } from "react";
import {
  FilePenLine, FilePlus2, FileText, FolderOpen, Globe, ListChecks,
  LoaderCircle, Search, Terminal, Wrench, X,
} from "lucide-react";
import type { ToolView } from "../chat-projection";
import { flowReport } from "./flow-report";
import { ToolRenderer } from "./index";
import { ToolDetailContext, type ToolState } from "./tool-frame";
import { toolText } from "./types";

const RICH = /^(generate_image|Task|bg_|agent_wait|subagent)/u;

/** A tool whose result needs its own card stays a card; everything else is a chip. */
export function isRichTool(tool: ToolView): boolean {
  return RICH.test(tool.name) || !!flowReport(toolText(tool.result));
}

export function toolState(tool: ToolView): ToolState {
  return tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done";
}

const ICONS: Record<string, typeof Wrench> = {
  bash: Terminal,
  powershell: Terminal,
  read: FileText,
  write: FilePlus2,
  edit: FilePenLine,
  multiedit: FilePenLine,
  apply_patch: FilePenLine,
  grep: Search,
  find: Search,
  ls: FolderOpen,
  web_fetch: Globe,
  batch_web_fetch: Globe,
  "tff-search_web": Search,
  compact_context: ListChecks,
  schedule_prompt: ListChecks,
};

function Chip({ tool, open, onToggle, bodyId }: { tool: ToolView; open: boolean; onToggle: () => void; bodyId: string }) {
  const state = toolState(tool);
  const Icon = ICONS[tool.name] ?? Wrench;
  const label = `${tool.name} · ${state === "running" ? "running" : state === "error" ? "failed" : "done"}`;
  return <button
    type="button"
    aria-label={label}
    aria-expanded={open}
    aria-controls={open ? bodyId : undefined}
    title={label}
    onClick={onToggle}
    className={`relative inline-flex size-8 items-center justify-center rounded-md border transition-colors ${
      state === "running" ? "border-primary/50 text-primary"
        : state === "error" ? "border-destructive/50 text-destructive"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
    } ${open ? "bg-muted text-foreground" : "bg-muted/20"}`}
  >
    <Icon className="size-4" aria-hidden="true" />
    <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full border border-background ${
      state === "running" ? "animate-pulse bg-primary"
        : state === "error" ? "bg-destructive"
          : "bg-emerald-500"
    }`} aria-hidden="true" />
    {state === "running" && <LoaderCircle className="absolute size-3 animate-spin opacity-0" aria-hidden="true" />}
  </button>;
}

/**
 * Settled tools collapse to a row of icons. One click opens the same body the
 * old full-width card used, without keeping every card open in the transcript.
 */
export function ToolChipGroup({ tools }: { tools: ToolView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const detailId = useId();
  const open = openId ? tools.find(tool => tool.id === openId) : undefined;
  return <div className="my-1.5 space-y-1.5">
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tool calls">
      {tools.map(tool => <Chip key={tool.id} tool={tool} open={tool.id === openId} onToggle={() => setOpenId(tool.id === openId ? null : tool.id)} bodyId={detailId} />)}
    </div>
    {open && <div id={detailId} className="rounded-lg border border-border bg-background/60">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="truncate text-[11px] font-medium">{open.name}</span>
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close tool details" onClick={() => setOpenId(null)}><X className="size-3" /></button>
      </div>
      <div className="p-2">
        <ToolDetailContext.Provider value>
          <ToolRenderer tool={open} />
        </ToolDetailContext.Provider>
      </div>
    </div>}
  </div>;
}
