import { useState } from "react";
import { Brain, ChevronDown, LoaderCircle } from "lucide-react";
import { ChatMarkdown } from "./chat-markdown";
import type { ToolView } from "./chat-projection";

function preview(tool: ToolView): string {
  const args = tool.args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const value = record.command ?? record.path ?? record.url ?? record.query ?? record.pattern ?? record.subject;
  return typeof value === "string" ? value : "";
}

/**
 * One status line above the composer. Reasoning, the current tool and the
 * generic Working label are mutually exclusive; only one of them is visible.
 */
export function AgentAction({ thinking, label, running, elapsed, tools = [] }: {
  thinking: string;
  label: string;
  running: boolean;
  elapsed?: string;
  tools?: ToolView[];
}) {
  const [open, setOpen] = useState(false);
  const text = thinking.trim();
  const tool = tools.at(-1);
  if (!running && !text) return null;
  if (!text && tool) return <div className="px-1 pb-1">
    <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/40" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
      <span className="shrink-0 font-medium text-foreground">{tool.name}</span>
      {tools.length > 1 && <span className="shrink-0 text-[10px]">+{tools.length - 1}</span>}
      <span className="min-w-0 flex-1 truncate font-mono">{preview(tool)}</span>
      <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-[10px] text-muted-foreground">{JSON.stringify(tool.args, null, 2)}</pre>}
  </div>;
  if (!text) return <div role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 px-1 py-1 text-[11px] text-muted-foreground">
    <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
    <span>{label}</span>
    {elapsed && <span className="tabular-nums">{elapsed}</span>}
  </div>;
  const last = text.split(/\r?\n/u).filter(line => line.trim()).at(-1) ?? "";
  return <div className="px-1 pb-1">
    <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/40" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Brain className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium text-foreground">Reasoning</span>
      <span className="min-w-0 flex-1 truncate">{last}</span>
      <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <div className="max-h-40 overflow-auto rounded-md border border-border bg-background px-3 py-2 text-xs"><ChatMarkdown text={text} /></div>}
  </div>;
}

/** Kept for callers that only want the running tool; same visual line. */
export function CurrentTool({ tools }: { tools: ToolView[] }) {
  return <AgentAction thinking="" label="Working…" running tools={tools} />;
}
