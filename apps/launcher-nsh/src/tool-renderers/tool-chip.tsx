import { View, Text, signal, computed, token } from "nsh";
import { Button as BaseButton } from "nsh/base";
import type { ToolView } from "../chat-projection";
import { ChatMarkdown } from "../chat-markdown";
import { cn } from "../lib";
import { Icon, type IconName } from "../ui/icons";
import { ToolRenderer } from "./index";
import { ToolDetailContext, type ToolState } from "./tool-frame";

export type ActivityItem =
  | { kind: "tool"; tool: ToolView }
  | { kind: "thinking"; id: string; text: string; streaming: boolean };

/** Images need their visual result in the transcript; everything else is a chip. */
export function isRichTool(tool: ToolView): boolean {
  return tool.name === "generate_image";
}

export function toolState(tool: ToolView): ToolState {
  return tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done";
}

const ICONS: Record<string, IconName> = {
  bash: "Terminal",
  powershell: "Terminal",
  read: "FileText",
  write: "FileText",
  edit: "PencilLine",
  multiedit: "PencilLine",
  apply_patch: "PencilLine",
  grep: "Search",
  find: "Search",
  ls: "FolderOpen",
  web_fetch: "Compass",
  batch_web_fetch: "Compass",
  "tff-search_web": "Search",
  compact_context: "ListTodo",
  schedule_prompt: "ListTodo",
};

function stateDot(state: ToolState) {
  return state === "running" ? "animate-pulse bg-primary"
    : state === "error" ? "bg-destructive"
      : state === "warning" ? "bg-amber-500"
        : "bg-emerald-500";
}

function itemKey(item: ActivityItem) {
  return item.kind === "tool" ? item.tool.id : item.id;
}

function itemLabel(item: ActivityItem) {
  if (item.kind === "thinking") return item.streaming ? "Thinking · running" : "Thinking · done";
  return `${item.tool.name} · ${toolState(item.tool) === "error" ? "failed" : toolState(item.tool)}`;
}

function itemState(item: ActivityItem): ToolState {
  return item.kind === "thinking" ? (item.streaming ? "running" : "done") : toolState(item.tool);
}

function itemIcon(item: ActivityItem): IconName {
  return item.kind === "thinking" ? "Brain" : ICONS[item.tool.name] ?? "Wrench";
}

function itemColor(item: ActivityItem): string {
  const state = itemState(item);
  return state === "running" ? token("primary") : state === "error" ? token("destructive") : token("muted-foreground");
}

function detailTitle(item: ActivityItem) {
  return item.kind === "thinking" ? "Thinking" : item.tool.name;
}

function thinkingText(item: ActivityItem) {
  return item.kind === "thinking" ? item.text : "";
}

function asToolItem(item: ActivityItem): Extract<ActivityItem, { kind: "tool" }> | null {
  return item.kind === "tool" ? item : null;
}
/** Thinking and tool calls share one 32 px activity strip; only the expanded
 * item takes vertical space. */
export function ActivityStrip(props: { items: ActivityItem[] }) {
  const openId = signal<string | null>(null);
  const open = computed(() => {
    const id = openId();
    return id ? props.items.find(item => itemKey(item) === id) : undefined;
  });
  return <View class="my-1.5 flex-col gap-1.5">
    <View class="flex-row flex-wrap items-center gap-1.5" role="group" accessibilityLabel="Activity">
      <Each of={props.items} key={itemKey}>{item => <BaseButton
        accessibilityLabel={itemLabel(item())}
        onPress={() => { const id = itemKey(item()); openId.set(id === openId() ? null : id); }}
        class={cn("relative size-8 items-center justify-center rounded-md border",
          itemState(item()) === "running" ? "border-primary/50 text-primary"
            : itemState(item()) === "error" ? "border-destructive/50 text-destructive"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          itemKey(item()) === openId() ? "bg-muted text-foreground" : "bg-muted/20")}
      >
        <Icon name={itemIcon(item())} size={16} color={itemColor(item())} />
        <View class={cn("absolute -right-0.5 -top-0.5 size-2 rounded-full border border-background", stateDot(itemState(item())))} accessibilityElementsHidden />
      </BaseButton>}</Each>
    </View>
    <If when={open()}>{value => <View class="flex-col rounded-lg border border-border bg-background/60">
      <View class="flex-row items-center justify-between border-b border-border px-2 py-1">
        <Text class="truncate text-[11px] font-medium">{detailTitle(value())}</Text>
        <BaseButton class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" accessibilityLabel="Close activity details" onPress={() => openId.set(null)}><Icon name="X" size={12} color={token("muted-foreground")} /></BaseButton>
      </View>
      <View class="p-2 text-xs">
        <If when={value().kind === "thinking"} else={
          <If when={asToolItem(value())}>{toolItem => <ToolDetailContext.Provider value={true}><ToolRenderer tool={toolItem().tool} /></ToolDetailContext.Provider>}</If>
        }>
          <ChatMarkdown text={thinkingText(value())} />
        </If>
      </View>
    </View>}</If>
  </View>;
}

/** Small compatibility wrapper for callers that only have tools. */
export function ToolChipGroup(props: { tools: ToolView[] }) {
  return <ActivityStrip items={props.tools.map(tool => ({ kind: "tool" as const, tool }))} />;
}
