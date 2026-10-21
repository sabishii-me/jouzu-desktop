import { memo, useEffect, useRef, useState } from "react";
import { ArrowDown, Brain } from "lucide-react";
import { Button } from "./components/ui/button";
import { JouzuLoader } from "./components/ui/jouzu-loader";
import { ChatMarkdown } from "./chat-markdown";
import type { ChatMessage, ChatProjection } from "./chat-projection";
import { ToolRenderer } from "./tool-renderers";
import { TurnFooter } from "./turn-footer";

function messagePreview(message: ChatMessage) {
  const text = message.content.map(block => block.type === "text" ? block.text ?? "" : block.type === "thinking" ? block.thinking ?? "" : "").join(" ").replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text || "Turn";
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
function FinalTurnFooter({ messages, index, message }: { messages: ChatMessage[]; index: number; message: ChatMessage }) {
  const metrics = turnUsageAt(messages, index);
  return <TurnFooter message={message} usage={metrics.usage} startedAt={metrics.startedAt} />;
}
function ThinkingRow({ thinking, streaming }: { thinking: string; streaming: boolean }) {
  const preview = thinking.split(/\r?\n/).find(line => line.trim())?.replace(/\s+/g, " ").trim() ?? "";
  return <details className="my-1.5 rounded-lg border border-border bg-muted/20">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
      <Brain className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium text-foreground">Thinking</span>
      <span className="shrink-0" aria-hidden="true">·</span>
      <span className="min-w-0 flex-1 truncate">{preview || "…"}</span>
      {streaming && <JouzuLoader className="jouzu-loader-sm shrink-0" />}
    </summary>
    <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground"><ChatMarkdown text={thinking} /></div>
  </details>;
}

function ChatConversationView({ projection, pending = false, startedAt, opening = false }: { projection: ChatProjection; pending?: boolean; startedAt?: number; opening?: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [limit, setLimit] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const working = projection.running || pending || opening;
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [projection]);
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [working]);
  const elapsed = working && (projection.turnStartedAt ?? startedAt) ? Math.max(0, Math.floor((now - (projection.turnStartedAt ?? startedAt)!) / 1000)) : null;
  const hasVisibleHistory = projection.messages.some(message => message.role === "user" || message.role === "assistant");
  const showWorking = working && !(opening && hasVisibleHistory);
  const visible = projection.messages.flatMap((message, index) => message.role === "user" || message.role === "assistant" ? [{ message, index }] : []);
  const shown = visible.slice(-limit);
  const lastAssistantIndex = visible.filter(item => item.message.role === "assistant").at(-1)?.index;
  const turnMarkers = visible.flatMap((item, position) => {
    if (item.message.role !== "user") return [];
    const nextUser = visible.findIndex((candidate, candidatePosition) => candidatePosition > position && candidate.message.role === "user");
    const response = visible.slice(position + 1, nextUser < 0 ? visible.length : nextUser).find(candidate => candidate.message.role === "assistant");
    return [{ index: item.index, prompt: messagePreview(item.message), response: response ? messagePreview(response.message) : "" }];
  });
  const loadedIndexes = new Set(shown.map(item => item.index));
  const lastTurn = Math.max(0, turnMarkers.length - 1);
  const [activeTurn, setActiveTurn] = useState(0);
  const articleRefs = useRef(new Map<number, HTMLElement>());
  const railRef = useRef<HTMLElement>(null);
  const pendingJump = useRef<number | null>(null);
  useEffect(() => { if (following.current) setActiveTurn(lastTurn); }, [lastTurn]);
  useEffect(() => {
    const rail = railRef.current;
    const mark = rail?.querySelector<HTMLElement>(`[data-turn-index="${activeTurn}"]`);
    if (!rail || !mark) return;
    if (mark.offsetTop < rail.scrollTop) rail.scrollTop = mark.offsetTop;
    else if (mark.offsetTop + mark.offsetHeight > rail.scrollTop + rail.clientHeight) rail.scrollTop = mark.offsetTop + mark.offsetHeight - rail.clientHeight;
  }, [activeTurn]);
  useEffect(() => {
    if (pendingJump.current === null) return;
    const element = articleRefs.current.get(pendingJump.current);
    if (!element) return;
    pendingJump.current = null;
    following.current = false;
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    setShowLatest(true);
  }, [shown]);
  function jumpToTurn(index: number) {
    const position = turnMarkers.findIndex(turn => turn.index === index);
    if (position < 0) return;
    const element = articleRefs.current.get(index);
    if (element) {
      following.current = false;
      element.scrollIntoView({ block: "start", behavior: "smooth" });
      setActiveTurn(position);
      setShowLatest(true);
      return;
    }
    pendingJump.current = index;
    setActiveTurn(position);
    setLimit(value => Math.max(value, visible.length - position + 1));
  }
  return <section aria-label="Conversation" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" onScroll={event => { const view = event.currentTarget; following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80; setShowLatest(!following.current); if (turnMarkers.length) { const max = view.scrollHeight - view.clientHeight; const ratio = max > 0 ? Math.min(1, Math.max(0, view.scrollTop / max)) : 0; setActiveTurn(Math.min(turnMarkers.length - 1, Math.round(ratio * (turnMarkers.length - 1)))); } }}>
      {!visible.length && <div className="mx-auto max-w-xl py-16 text-center"><h2 className="text-xl font-semibold">What would you like to work on?</h2><p className="mt-3 text-sm text-muted-foreground">Ask Jouzu to explore your workspace, explain code, or make a change.</p></div>}
      {visible.length > shown.length && <div className="mx-auto mb-4 flex max-w-3xl justify-center"><Button variant="outline" className="h-7 px-3 text-xs" onClick={() => setLimit(value => value + 50)}>Show {visible.length - shown.length} earlier message{visible.length - shown.length === 1 ? "" : "s"}</Button></div>}
      <div className="mx-auto max-w-3xl space-y-6">{shown.map(({ message, index }) => <article key={index} ref={node => { if (node) articleRefs.current.set(index, node); else articleRefs.current.delete(index); }} aria-label={`${message.role} message`} className={`[content-visibility:auto] [contain-intrinsic-size:auto_160px] ${message.role === "user" ? "ml-6 rounded-xl border border-border bg-muted/50 px-4 py-2" : "min-w-0"}`}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "assistant" ? "Jouzu" : "You"}</div>
        {message.content.map((block, position) => block.type === "text" ? <ChatMarkdown key={position} text={block.text ?? ""} /> : block.type === "thinking" ? <ThinkingRow key={position} thinking={block.thinking ?? ""} streaming={projection.running && index === lastAssistantIndex} /> : block.type === "toolCall" ? projection.tools[block.id ?? ""] ? <ToolRenderer key={position} tool={projection.tools[block.id!]} /> : <p key={position} className="text-xs text-muted-foreground">{block.name ?? "Tool call"}</p> : block.type === "image" && typeof block.data === "string" && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(block.mimeType ?? "") ? <img key={position} className="my-2 max-h-80 rounded-lg" src={`data:${block.mimeType};base64,${block.data}`} alt="Conversation attachment" /> : <p key={position} className="text-xs text-muted-foreground">Unsupported content: {block.type}</p>)}
        {message.errorMessage && <p role="alert" className="select-text text-sm text-destructive">{message.errorMessage}</p>}
        {message.role === "assistant" && !message.content.some(block => block.type === "toolCall") && message.stopReason !== "toolUse" && <FinalTurnFooter messages={projection.messages} index={index} message={message} />}
      </article>)}
        {showWorking && <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground"><JouzuLoader className="jouzu-loader-sm" /><span>{opening ? "Opening session…" : "Working…"}</span>{!opening && elapsed !== null && <span className="tabular-nums">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}</div>}
      </div>
      {showLatest && <div className="pointer-events-none sticky bottom-0 flex justify-end pt-3"><Button variant="outline" className="pointer-events-auto shadow" onClick={() => { following.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setShowLatest(false); }}><ArrowDown />Latest</Button></div>}
    </div>
    {turnMarkers.length >= 2 && <nav ref={railRef} aria-label="Conversation turns" className="absolute right-3 top-1/2 z-10 max-h-[min(420px,calc(100%_-_4rem))] w-7 -translate-y-1/2 overflow-y-auto overscroll-contain py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {turnMarkers.map((turn, position) => {
        const active = position === activeTurn;
        const loaded = loadedIndexes.has(turn.index);
        return <button key={turn.index} type="button" data-turn-index={position} title={`Turn ${position + 1}: ${turn.prompt}${turn.response ? `\n${turn.response}` : ""}`} aria-label={`Jump to turn ${position + 1}: ${turn.prompt}`} aria-current={active ? "true" : undefined} onClick={() => jumpToTurn(turn.index)} className="group/turn flex h-2.5 w-7 shrink-0 items-center justify-end">
          <span className={`block h-0.5 origin-right rounded-sm transition-[transform,background-color,opacity] duration-150 ${active ? "w-5 scale-x-100 bg-foreground" : loaded ? "w-5 scale-x-[.6] bg-border group-hover/turn:scale-x-[.9] group-hover/turn:bg-muted-foreground" : "w-5 scale-x-[.4] bg-border opacity-60"}`} />
        </button>;
      })}
    </nav>}
  </section>;
}
export const ChatConversation = memo(ChatConversationView);
