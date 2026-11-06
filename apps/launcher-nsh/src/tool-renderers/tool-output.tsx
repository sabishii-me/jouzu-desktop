import { View, Text, signal, computed, Clipboard } from "nsh";
import { writeFile } from "fs/promises";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Icon } from "../ui/icons";
import { ChatMarkdown } from "../chat-markdown";
import { invoke } from "../host/invoke";
import { savePath } from "../host/dialog";
import { copyPath, revealMessage, revealPath } from "../file-actions";
import { useWorkspaceRoot } from "../workspace-context";
import { cn } from "../lib";
import type { ToolView } from "../chat-projection";
import { classifyText, diffRows, prettyJson } from "./tool-format";
import { record, toolText } from "./types";
import { ArtifactImage } from "./artifact-image";
import { artifactPathFromText } from "./artifact-path";

const MAX_LINES = 2000;
export const MAX_TOOL_IMAGE_BYTES = 8 * 1024 * 1024;
const ANSI = new RegExp(String.fromCharCode(27) + "\\[([0-9;]*)m", "g");
const ANSI_COLORS: Record<number, string> = {
  30: "text-black", 31: "text-red-500", 32: "text-green-500", 33: "text-yellow-500",
  34: "text-blue-500", 35: "text-purple-500", 36: "text-cyan-500", 37: "text-foreground",
  90: "text-muted-foreground", 91: "text-red-400", 92: "text-green-400", 93: "text-yellow-400",
  94: "text-blue-400", 95: "text-purple-400", 96: "text-cyan-400", 97: "text-foreground",
};

interface AnsiState { color?: string; bold: boolean; dim: boolean; underline: boolean }
interface AnsiPart { text: string; state: AnsiState }
const plainState = (): AnsiState => ({ bold: false, dim: false, underline: false });

/** Convert the SGR subset Pi tools emit into text spans; never interpret other escapes. */
export function ansiParts(text: string): AnsiPart[] {
  const parts: AnsiPart[] = [];
  let state = plainState();
  let at = 0;
  for (const match of text.matchAll(ANSI)) {
    if (match.index! > at) parts.push({ text: text.slice(at, match.index), state: { ...state } });
    const codes = match[1] ? match[1].split(";").filter(Boolean).map(Number) : [0];
    for (const code of codes) {
      if (code === 0) state = plainState();
      else if (code === 1) state = { ...state, bold: true };
      else if (code === 2) state = { ...state, dim: true };
      else if (code === 4) state = { ...state, underline: true };
      else if (code === 22) state = { ...state, bold: false, dim: false };
      else if (code === 24) state = { ...state, underline: false };
      else if (code === 39) state = { ...state, color: undefined };
      else if (ANSI_COLORS[code]) state = { ...state, color: ANSI_COLORS[code] };
    }
    at = match.index! + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), state: { ...state } });
  return parts;
}

function AnsiPre(props: { text: string; expanded?: boolean }) {
  return <ScrollArea className={cn(props.expanded ? "max-h-[640px]" : "max-h-96")}>
    <Text class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
      <Each of={ansiParts(props.text)} key="index">{part => <Text class={cn(part().state.color, part().state.bold && "font-semibold", part().state.dim && "opacity-70", part().state.underline && "underline")}>{part().text}</Text>}</Each>
    </Text>
  </ScrollArea>;
}

function CopyButton(props: { text: string }) {
  const copied = signal(false);
  return <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => {
    void Clipboard.writeText(props.text).then(() => {
      copied.set(true);
      setTimeout(() => copied.set(false), 1200);
    }).catch(() => copied.set(false));
  }}><Icon name={copied() ? "Check" : "Copy"} size={12} /><Text class="text-[11px]">{copied() ? "Copied" : "Copy"}</Text></Button>;
}

function DownloadButton(props: { text: string }) {
  return <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => {
    void (async () => {
      const target = await savePath("tool-output.txt");
      if (target) await writeFile(target, props.text);
    })().catch(() => {});
  }}><Text class="text-[11px]">Download</Text></Button>;
}

function truncatedLines(text: string) {
  const lines = text.split("\n");
  return { lines: lines.slice(0, MAX_LINES), truncated: lines.length > MAX_LINES, total: lines.length };
}

function CodeLines(props: { text: string; expanded?: boolean }) {
  const view = computed(() => truncatedLines(props.text));
  return <ScrollArea className={cn(props.expanded ? "max-h-[640px]" : "max-h-96", "rounded-md border border-border/60 bg-background")}>
    <View class="flex-col font-mono text-[11px] leading-5">
      <Each of={view().lines} key="index">{(line, index) => <View class="flex-row">
        <Text class="w-10 shrink-0 select-none border-r border-border/60 px-2 text-right text-muted-foreground/70">{index() + 1}</Text>
        <Text class="min-w-0 flex-1 whitespace-pre-wrap break-words px-3">{line() || " "}</Text>
      </View>}</Each>
      <If when={view().truncated}><Text class="border-t border-border/60 px-3 py-1 text-[10px] text-muted-foreground">Showing first {MAX_LINES} of {view().total} lines.</Text></If>
    </View>
  </ScrollArea>;
}

function markdownPath(args: unknown): boolean {
  const value = record(args);
  const path = typeof value?.path === "string" ? value.path : "";
  return /\.(?:md|mdx|markdown)$/iu.test(path);
}

function readPath(args: unknown): string | undefined {
  const value = record(args);
  return typeof value?.path === "string" ? value.path : undefined;
}

export interface ToolImageBlock {
  mime: string;
  data: string;
  alt: string;
  bytes: number;
  tooLarge: boolean;
}

/**
 * Keep every image block a tool returned, including an oversized or unsupported
 * one: the image component renders a card explaining why it is not inline.
 */
export function imageBlocks(result: unknown): ToolImageBlock[] {
  const value = record(result);
  const blocks = value && Array.isArray(value.content) ? value.content : [];
  return blocks.flatMap(block => {
    const item = record(block);
    if (item?.type !== "image" || typeof item.data !== "string") return [];
    const mime = typeof item.mimeType === "string" ? item.mimeType : "";
    const bytes = Math.floor(item.data.length * 0.75);
    return [{ mime, data: item.data, alt: typeof item.alt === "string" ? item.alt : "Tool output image", bytes, tooLarge: bytes > MAX_TOOL_IMAGE_BYTES }];
  });
}

/** Local stand-in for the baseline ../reveal-path (not ported in this stage). */
function RevealPath(props: { path: string; compact?: boolean; label?: string }) {
  const error = signal<string | null>(null);
  const copied = signal(false);
  const name = props.path.split(/[\\/]/u).pop() ?? props.path;
  return <View class="flex-row min-w-0 flex-wrap items-center gap-1">
    <Button variant={props.compact ? "ghost" : "outline"} className={props.compact ? "h-7 gap-1 px-2 text-[11px]" : "h-8 gap-1 px-2 text-xs"} title={`Reveal ${name}`} aria-label={props.label ?? "Reveal"} onClick={() => {
      void revealPath(props.path, useWorkspaceRoot()).then(() => error.set(null)).catch(failure => error.set(failure instanceof Error ? failure.message : revealMessage(undefined)));
    }}><Icon name="FolderOpen" size={12} /><Text class="text-[11px]">{props.label ?? "Reveal"}</Text></Button>
    <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" title="Copy path" onClick={() => {
      void copyPath(props.path).then(ok => { copied.set(ok); setTimeout(() => copied.set(false), 1200); });
    }}><Icon name={copied() ? "Check" : "Copy"} size={12} /><Text class="text-[11px]">{copied() ? "Copied" : "Copy path"}</Text></Button>
    <If when={error()}><Text class="text-[11px] text-destructive">{error()}.</Text></If>
  </View>;
}

function SearchOutput(props: { text: string; pattern?: string; expanded?: boolean }) {
  const view = computed(() => truncatedLines(props.text));
  const safe = computed(() => props.pattern ? props.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "");
  return <ScrollArea className={cn(props.expanded ? "max-h-[640px]" : "max-h-96", "rounded-md border border-border/60 bg-background p-2")}>
    <View class="flex-col font-mono text-[11px] leading-5">
      <Each of={view().lines} key="index">{line => <Text class="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
        <If when={safe()} else={<Text>{line() || " "}</Text>}>
          <Each of={line().split(new RegExp(`(${safe()})`, "giu"))} key="index">{piece => <If when={piece().toLowerCase() === props.pattern?.toLowerCase()} else={<Text>{piece()}</Text>}><Text class="rounded bg-primary/20 text-foreground">{piece()}</Text></If>}</Each>
        </If>
      </Text>}</Each>
      <If when={view().truncated}><Text class="mt-1 text-[10px] text-muted-foreground">Showing first {MAX_LINES} of {view().total} lines.</Text></If>
    </View>
  </ScrollArea>;
}

function diffClass(kind: string): string {
  return kind === "add" ? "bg-green-500/10 text-green-600 dark:text-green-400"
    : kind === "remove" ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : kind === "hunk" ? "bg-primary/10 text-primary"
        : kind === "header" ? "text-muted-foreground" : "";
}

function DiffOutput(props: { text: string; expanded?: boolean }) {
  const view = computed(() => truncatedLines(diffRows(props.text).map(row => row.text).join("\n")));
  return <ScrollArea className={cn(props.expanded ? "max-h-[640px]" : "max-h-96", "rounded-md border border-border/60 bg-background py-1")}>
    <View class="flex-col font-mono text-[11px] leading-5">
      <Each of={view().lines} key="index">{line => <Text class={cn("whitespace-pre-wrap break-words px-2 font-mono text-[11px] leading-5", diffClass(diffRows(line())[0]?.kind ?? "context"))}>{line() || " "}</Text>}</Each>
      <If when={view().truncated}><Text class="px-2 py-1 text-[10px] text-muted-foreground">Showing first {MAX_LINES} of {view().total} lines.</Text></If>
    </View>
  </ScrollArea>;
}

function JsonOutput(props: { text: string; expanded?: boolean }) {
  return <AnsiPre text={prettyJson(props.text) ?? props.text} expanded={props.expanded} />;
}

function MarkdownOutput(props: { text: string; expanded?: boolean }) {
  const rendered = signal(true);
  return <View class="flex-col rounded-md border border-border/60 bg-background">
    <View class="flex-row justify-end border-b border-border/60 px-2 py-1">
      <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => rendered.update(value => !value)}><Text class="text-[11px]">{rendered() ? "Source" : "Markdown"}</Text></Button>
    </View>
    <ScrollArea className={cn(props.expanded ? "max-h-[640px]" : "max-h-96", "p-3")}>
      <If when={rendered()} else={<AnsiPre text={props.text} expanded={props.expanded} />}>
        <ChatMarkdown text={props.text} />
      </If>
    </ScrollArea>
  </View>;
}

function resultMeta(result: unknown) {
  const value = record(result);
  if (!value) return [];
  const meta: string[] = [];
  if (typeof value.exitCode === "number") meta.push(`exit ${value.exitCode}`);
  if (typeof value.durationMs === "number") meta.push(`${value.durationMs} ms`);
  if (typeof value.truncated === "boolean" && value.truncated) meta.push("truncated");
  return meta;
}

export function ToolOutput(props: { tool: ToolView }) {
  const expanded = signal(false);
  const text = computed(() => toolText(props.tool.result));
  const images = computed(() => {
    const blocks = imageBlocks(props.tool.result);
    const details = record(record(props.tool.result)?.details);
    const prompt = typeof details?.prompt === "string" ? details.prompt : "";
    const model = typeof details?.model === "string" ? details.model : "";
    const size = typeof details?.size === "string" ? details.size : "";
    const metas = Array.isArray(details?.images) ? details.images : [];
    const fallbackPath = blocks.length === 1 ? artifactPathFromText(text()) : undefined;
    return blocks.map((image, index) => {
      const meta = record(metas[index]);
      const width = typeof meta?.width === "number" ? meta.width : undefined;
      const height = typeof meta?.height === "number" ? meta.height : undefined;
      return {
        ...image,
        alt: prompt || image.alt,
        path: typeof meta?.path === "string" ? meta.path : fallbackPath,
        width,
        height,
        caption: [model, size, width && height ? `${width}×${height}` : ""].filter(Boolean).join(" · "),
      };
    });
  });
  const path = computed(() => readPath(props.tool.args));
  const kind = computed(() => classifyText(text()));
  const meta = computed(() => resultMeta(props.tool.result));
  const long = computed(() => text().length > 2000 || text().split("\n").length > 40);
  const pattern = computed(() => {
    const value = record(props.tool.args)?.pattern;
    return typeof value === "string" ? value : undefined;
  });
  const variant = computed(() => {
    const name = props.tool.name;
    if (name === "bash") return "ansi";
    if (name === "read" && markdownPath(props.tool.args)) return "markdown";
    if (name === "read" && kind() === "json") return "json";
    if (name === "read" && kind() === "diff") return "diff";
    if (name === "read") return "code";
    if (name === "grep") return "search";
    if (kind() === "json") return "json";
    if (kind() === "diff") return "diff";
    return "ansi";
  });
  const header = computed(() => `${props.tool.name === "read" && path() ? path() : "Output"}${meta().length ? ` · ${meta().join(" · ")}` : ""}`);
  const failure = computed(() => `Tool failed${meta().length ? ` (${meta().join(", ")})` : ""}`);
  return (
    <If when={images().length > 0} else={
      <If when={text()} else={<Text class="text-xs text-muted-foreground">No text output.</Text>}>
        <View class="flex-col gap-1">
          <View class="flex-row items-center justify-between gap-2">
            <View class="flex-row min-w-0 items-center gap-2">
              <Text class="min-w-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground">{header()}</Text>
              <If when={props.tool.name === "read" && !!path()}><RevealPath path={path()!} compact label="Reveal" /></If>
            </View>
            <View class="flex-row shrink-0">
              <CopyButton text={text()} />
              <DownloadButton text={text()} />
              <If when={long()}><Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => expanded.update(value => !value)}><Text class="text-[11px]">{expanded() ? "Collapse" : "Expand"}</Text></Button></If>
            </View>
          </View>
          <If when={props.tool.phase === "error"}><Text class="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{failure()}</Text></If>
          <If when={variant() === "markdown"} else={
            <If when={variant() === "json"} else={
              <If when={variant() === "diff"} else={
                <If when={variant() === "code"} else={
                  <If when={variant() === "search"} else={<AnsiPre text={text()} expanded={expanded()} />}>
                    <SearchOutput text={text()} pattern={pattern()} expanded={expanded()} />
                  </If>}>
                  <CodeLines text={text()} expanded={expanded()} />
                </If>}>
                <DiffOutput text={text()} expanded={expanded()} />
              </If>}>
              <JsonOutput text={text()} expanded={expanded()} />
            </If>}>
            <MarkdownOutput text={text()} expanded={expanded()} />
          </If>
        </View>
      </If>
    }>
      <View class="flex-col gap-3">
        <Each of={images()} key="index">{image => <ArtifactImage image={image()} caption={image().caption} />}</Each>
        <If when={text()}><AnsiPre text={text()} expanded={expanded()} /></If>
      </View>
    </If>
  );
}
