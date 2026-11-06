import { View, Text, Scroll, signal, computed, effect } from "nsh";
import type { JSX, ScrollRef, ViewRef } from "nsh";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { ChatMarkdown } from "./chat-markdown";
import { MessageImage } from "./message-image";
import { WorkspaceContext } from "./workspace-context";
import type { ChatMessage, ChatProjection, ToolView } from "./chat-projection";
import { ToolRenderer } from "./tool-renderers";
import { ActivityStrip, isRichTool, type ActivityItem } from "./tool-renderers/tool-chip";
import { TurnFooter } from "./turn-footer";
import { TurnSummary } from "./turn-summary-card";
import { summarizeTurn } from "./turn-summary";

function messagePreview(message: ChatMessage) {
  const text = message.content.map(block => block.type === "text" ? block.text ?? "" : block.type === "thinking" ? block.thinking ?? "" : "").join(" ").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text || "Turn";
}

function turnStart(messages: ChatMessage[], end: number) {
  let start = end;
  while (start >= 0 && messages[start].role !== "user") start--;
  return start;
}
function turnPrompt(messages: ChatMessage[], end: number) {
  const start = turnStart(messages, end);
  return (messages[start]?.content ?? []).filter(block => block.type === "text").map(block => block.text ?? "").join("\n").trim();
}
function turnUsageAt(messages: ChatMessage[], end: number) {
  let start = end;
  while (start >= 0 && messages[start].role !== "user") start--;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (let index = Math.max(0, start); index <= end; index++) {
    const item = messages[index].usage;
    if (!item) continue;
    usage.input += item.input ?? 0;
    usage.output += item.output ?? 0;
    usage.cacheRead += item.cacheRead ?? 0;
    usage.cacheWrite += item.cacheWrite ?? 0;
    usage.total += item.total ?? item.totalTokens ?? (item.input ?? 0) + (item.output ?? 0) + (item.cacheRead ?? 0) + (item.cacheWrite ?? 0);
  }
  return { usage, startedAt: messages[start]?.timestamp };
}

type Part =
  | { type: "markdown"; text: string }
  | { type: "image"; source: string }
  | { type: "tool"; tool: ToolView }
  | { type: "unsupported"; blockType: string };

/**
 * Consecutive text tools become one row of icons. Rich results (images, Flow,
 * tasks, background work, subagents) keep their own card; nothing is dropped.
 */
function contentParts(message: ChatMessage, index: number, projection: ChatProjection) {
  const parts: Part[] = [];
  const activity: ActivityItem[] = [];
  message.content.forEach((block, position) => {
    if (block.type === "text") {
      parts.push({ type: "markdown", text: block.text ?? "" });
      return;
    }
    if (block.type === "thinking") {
      if (!(projection.running && projection.activeMessage === index)) {
        activity.push({ kind: "thinking", id: `thinking-${index}-${position}`, text: block.thinking ?? "", streaming: false });
      }
      return;
    }
    if (block.type === "image" && typeof block.data === "string" && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(block.mimeType ?? "")) {
      parts.push({ type: "image", source: `data:${block.mimeType};base64,${block.data}` });
      return;
    }
    if (block.type === "toolCall") {
      const tool = projection.tools[block.id ?? ""];
      if (!tool) {
        activity.push({
          kind: "tool",
          tool: {
            id: block.id ?? `pending-${index}-${position}`,
            name: block.name ?? "Tool call",
            args: block.arguments,
            phase: projection.running ? "running" : "complete",
          },
        });
      } else if (isRichTool(tool)) {
        parts.push({ type: "tool", tool });
      } else {
        activity.push({ kind: "tool", tool });
      }
      return;
    }
    parts.push({ type: "unsupported", blockType: block.type });
  });
  return { parts, activity };
}

type Row =
  | { kind: "user"; key: string; index: number; message: ChatMessage }
  | { kind: "text"; key: string; index: number; parts: Part[] }
  | { kind: "activity"; key: string; index: number; items: ActivityItem[] }
  | { kind: "error"; key: string; index: number; text: string }
  | { kind: "footer"; key: string; index: number; message: ChatMessage; messages: ChatMessage[]; summary: ReturnType<typeof summarizeTurn> };

export interface ChatConversationProps {
  projection: ChatProjection;
  workspace?: string;
  busy?: boolean;
  pendingUser?: string;
  onFork?: (prompt: string, index: number) => void;
  onOpenArtifacts?: () => void;
}

export function ChatConversation(props: ChatConversationProps) {
  const showLatest = signal(false);
  const limit = signal(30);
  const activeTurn = signal(0);
  let scroll: ScrollRef | null = null;
  let following = true;
  let lastOffsetY = 0;
  const articleRefs = new Map<number, ViewRef>();
  let pendingJump: number | null = null;

  const visible = computed(() => props.projection.messages.flatMap((message, index) => message.role === "user" || message.role === "assistant" ? [{ message, index }] : []));
  const shown = computed(() => visible().slice(-limit()));
  const turnMarkers = computed(() => visible().flatMap((item, position) => {
    if (item.message.role !== "user") return [];
    const all = visible();
    const nextUser = all.findIndex((candidate, candidatePosition) => candidatePosition > position && candidate.message.role === "user");
    const response = all.slice(position + 1, nextUser < 0 ? all.length : nextUser).find(candidate => candidate.message.role === "assistant");
    return [{ index: item.index, prompt: messagePreview(item.message), response: response ? messagePreview(response.message) : "" }];
  }));
  const loadedIndexes = computed(() => new Set(shown().map(item => item.index)));
  const lastTurn = computed(() => Math.max(0, turnMarkers().length - 1));

  const rows = computed<Row[]>(() => {
    const projection = props.projection;
    const busy = props.busy === true;
    const list = shown();
    const result: Row[] = [];
    for (let cursor = 0; cursor < list.length;) {
      const group = [list[cursor]];
      cursor += 1;
      while (cursor < list.length && list[cursor].message.role !== "user") {
        group.push(list[cursor]);
        cursor += 1;
      }
      const user = group.find(item => item.message.role === "user");
      if (user) result.push({ kind: "user", key: `user-${user.index}`, index: user.index, message: user.message });
      const parts: Part[] = [];
      const activity: ActivityItem[] = [];
      let last: (typeof list)[number] | undefined;
      for (const item of group) {
        if (item.message.role === "user") continue;
        const split = contentParts(item.message, item.index, projection);
        parts.push(...split.parts);
        activity.push(...split.activity);
        last = item;
      }
      if (parts.length) result.push({ kind: "text", key: `text-${group[0].index}`, index: group[0].index, parts });
      if (activity.length) result.push({ kind: "activity", key: `activity-${group[0].index}`, index: group[0].index, items: activity });
      if (last) {
        const nextMessage = projection.messages[last.index + 1];
        const turnEnd = !nextMessage || nextMessage.role === "user";
        if (last.message.errorMessage) result.push({ kind: "error", key: `error-${last.index}`, index: last.index, text: last.message.errorMessage });
        if (turnEnd && !projection.running && !busy && !last.message.content.some(block => block.type === "toolCall") && last.message.stopReason !== "toolUse") {
          result.push({ kind: "footer", key: `footer-${last.index}`, index: last.index, message: last.message, messages: projection.messages, summary: summarizeTurn(projection.messages, projection.tools, last.index) });
        }
      }
    }
    return result;
  });

  const pinToBottom = () => {
    if (following && scroll) scroll.scrollToEnd({ animated: false });
  };
  // New projection content keeps the newest turn visible while the reader
  // follows; content that grows after layout pins again from onLayout,
  // replacing the baseline's ResizeObserver.
  effect(() => {
    void props.projection;
    if (following) requestAnimationFrame(pinToBottom);
  });
  effect(() => {
    const last = lastTurn();
    if (following) activeTurn.set(last);
  });
  effect(() => {
    void rows();
    if (pendingJump === null) return;
    const target = articleRefs.get(pendingJump);
    if (!target) return;
    const index = pendingJump;
    pendingJump = null;
    void scrollToArticle(index);
  });

  async function scrollToArticle(index: number) {
    const target = articleRefs.get(index);
    if (!target || !scroll) return;
    const measured = await target.measure();
    const frame = await scroll.measure();
    if (!measured || !frame) return;
    following = false;
    scroll.scrollTo({ y: Math.max(0, lastOffsetY + measured.pagePosition.y - frame.pagePosition.y), animated: true });
    showLatest.set(true);
  }

  function jumpToTurn(index: number) {
    const position = turnMarkers().findIndex(turn => turn.index === index);
    if (position < 0) return;
    activeTurn.set(position);
    if (articleRefs.has(index)) {
      void scrollToArticle(index);
      return;
    }
    pendingJump = index;
    limit.set(Math.max(limit(), visible().length - position + 1));
  }

  const setArticleRef = (index: number) => (ref: ViewRef) => {
    articleRefs.set(index, ref);
  };

  const renderPart = (part: Part): JSX.Element => (
    <If when={part.type === "markdown"} else={
      <If when={part.type === "image"} else={
        <If when={part.type === "tool"} else={
          <Text class="text-xs text-muted-foreground">{`Unsupported content: ${part.type === "unsupported" ? part.blockType : ""}`}</Text>
        }>
          {part.type === "tool" ? <ToolRenderer tool={part.tool} /> : <View />}
        </If>
      }>
        <MessageImage kind="block" source={part.type === "image" ? part.source : ""} alt="Conversation attachment" />
      </If>
    }>
      <ChatMarkdown text={part.type === "markdown" ? part.text : ""} />
    </If>
  );

  const renderFooter = (row: Row): JSX.Element => {
    if (row.kind !== "footer") return <View />;
    const metrics = turnUsageAt(row.messages, row.index);
    return (
      <View class="flex-col">
        <TurnSummary data={row.summary} workspace={props.workspace} onOpenArtifacts={props.onOpenArtifacts} />
        <TurnFooter
          message={row.message}
          usage={metrics.usage}
          startedAt={metrics.startedAt}
          onFork={props.onFork ? () => props.onFork?.(turnPrompt(row.messages, row.index), row.index) : undefined}
          forkDisabled={props.busy === true}
        />
      </View>
    );
  };

  return (
    <WorkspaceContext.Provider value={props.workspace}>
      <View class="relative min-h-0 min-w-0 flex-1 flex-col" accessibilityLabel="Conversation">
        <Scroll
          class="min-h-0 flex-1 px-4 py-5 sm:px-8"
          ref={ref => { scroll = ref; requestAnimationFrame(pinToBottom); }}
          onScroll={event => {
            lastOffsetY = event.offset.y;
            following = event.contentSize.height - event.offset.y - event.size.height < 80;
            showLatest.set(!following);
            const markers = turnMarkers();
            if (markers.length) {
              const max = event.contentSize.height - event.size.height;
              const ratio = max > 0 ? Math.min(1, Math.max(0, event.offset.y / max)) : 0;
              activeTurn.set(Math.min(markers.length - 1, Math.round(ratio * (markers.length - 1))));
            }
          }}
        >
          <If when={visible().length === 0}>
            <View class="mx-auto max-w-xl items-center py-16">
              <Text class="text-xl font-semibold">What would you like to work on?</Text>
              <Text class="mt-3 text-center text-sm text-muted-foreground">Ask Jouzu to explore your workspace, explain code, or make a change.</Text>
            </View>
          </If>
          <If when={visible().length > shown().length}>
            <View class="mx-auto mb-4 w-full max-w-3xl flex-row justify-center">
              <Button variant="outline" className="h-7 px-3" onClick={() => limit.update(value => value + 50)}>
                <Text class="text-xs">{`Show ${visible().length - shown().length} earlier message${visible().length - shown().length === 1 ? "" : "s"}`}</Text>
              </Button>
            </View>
          </If>
          <View class="mx-auto w-full max-w-3xl gap-3" onLayout={() => { if (following) requestAnimationFrame(pinToBottom); }}>
            <Each of={rows()} key={row => row.key}>
              {(row) => (
                <View class="flex-col">
                  <If when={row().kind === "user"}>
                    <View
                      class="ml-6 flex-col rounded-xl border border-border bg-muted/50 px-4 py-2 text-left"
                      accessibilityLabel="user message"
                      ref={setArticleRef(row().index)}
                    >
                      <Text class="mb-2 text-xs font-medium text-muted-foreground">You</Text>
                      <Each of={row().kind === "user" ? (row() as Extract<Row, { kind: "user" }>).message.content : []} key="index">
                        {(block) => (
                          <If when={block().type === "text"}>
                            <ChatMarkdown text={block().text ?? ""} />
                          </If>
                        )}
                      </Each>
                    </View>
                  </If>
                  <If when={row().kind === "text"}>
                    <View class="flex-col gap-2" accessibilityLabel="assistant message" ref={setArticleRef(row().index)}>
                      <Each of={row().kind === "text" ? (row() as Extract<Row, { kind: "text" }>).parts : []} key="index">
                        {(part) => renderPart(part())}
                      </Each>
                    </View>
                  </If>
                  <If when={row().kind === "activity"}>
                    <ActivityStrip items={row().kind === "activity" ? (row() as Extract<Row, { kind: "activity" }>).items : []} />
                  </If>
                  <If when={row().kind === "error"}>
                    <Text class="select-text text-sm text-destructive">{row().kind === "error" ? (row() as Extract<Row, { kind: "error" }>).text : ""}</Text>
                  </If>
                  <If when={row().kind === "footer"}>
                    {renderFooter(row())}
                  </If>
                </View>
              )}
            </Each>
            <If when={(props.pendingUser ?? "") !== ""}>
              <View class="ml-6 flex-col rounded-xl border border-border bg-muted/50 px-4 py-2 text-left opacity-70" accessibilityLabel="user message">
                <Text class="mb-2 text-xs font-medium text-muted-foreground">You</Text>
                <ChatMarkdown text={props.pendingUser ?? ""} />
              </View>
            </If>
          </View>
        </Scroll>
        <If when={showLatest()}>
          <View class="absolute bottom-4 right-8">
            <Button variant="outline" className="shadow" onClick={() => { following = true; scroll?.scrollToEnd({ animated: true }); showLatest.set(false); }}>
              <Icon name="ArrowDown" />
              <Text class="text-sm font-medium">Latest</Text>
            </Button>
          </View>
        </If>
        <If when={turnMarkers().length >= 2}>
          <Scroll class="absolute right-3 top-1/2 max-h-[420px] w-7 -translate-y-1/2 py-1.5" scrollbar={false}>
            <Each of={turnMarkers()} key={turn => turn.index}>
              {(turn, position) => (
                <View
                  class="h-2.5 w-7 flex-row items-center justify-end"
                  role="button"
                  accessibilityLabel={`Jump to turn ${position() + 1}: ${turn().prompt}`}
                  onPress={() => jumpToTurn(turn().index)}
                >
                  <View class={cnRail(position() === activeTurn(), loadedIndexes().has(turn().index))} />
                </View>
              )}
            </Each>
          </Scroll>
        </If>
      </View>
    </WorkspaceContext.Provider>
  );
}

function cnRail(active: boolean, loaded: boolean): string {
  if (active) return "h-0.5 w-5 rounded-sm bg-foreground";
  if (loaded) return "h-0.5 w-3 rounded-sm bg-border";
  return "h-0.5 w-2 rounded-sm bg-border opacity-60";
}