import { View, Text, signal, computed, token } from "nsh";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { ScrollArea } from "./ui/scroll-area";
import { ChatMarkdown } from "./chat-markdown";

export const TEXTGUARD_NOTICE = "JOUZU_TEXTGUARD ";

export type TextGuardItem = {
  id: string;
  withheld: boolean;
  ticket: string;
  source: string;
  digest: string;
  severity: string;
  review: {
    source: string;
    digest: string;
    scanner: string;
    status: string;
    severity?: Record<string, number>;
    reason?: string;
    findings?: Array<{ kind?: string; offset?: number }>;
  };
  snapshot?: { source?: string; body?: string };
};
export type TextGuardData = { ok: true; action: "inspect"; sessionId?: string; mode: string; items: TextGuardItem[] };

export function parseTextGuardNotice(message: string): TextGuardData | null {
  if (!message.startsWith(TEXTGUARD_NOTICE)) return null;
  try {
    const value = JSON.parse(message.slice(TEXTGUARD_NOTICE.length));
    return value?.ok === true && value.action === "inspect" && Array.isArray(value.items) ? value : null;
  } catch { return null; }
}
export function parseTextGuardResult(message: string): { ok: boolean; error?: string } | null {
  if (!message.startsWith(TEXTGUARD_NOTICE)) return null;
  try { return JSON.parse(message.slice(TEXTGUARD_NOTICE.length)); } catch { return null; }
}
export function textGuardMode(mode: string | undefined): "on" | "strict" | "off" {
  return mode === "strict" ? "strict" : mode === "off" ? "off" : "on";
}

/** Some reviews snapshot a serialized message envelope. Show the text it carries, not the JSON. */
export function readableTextGuardSnapshot(body: string | undefined): string {
  if (!body) return "";
  let value: unknown;
  try { value = JSON.parse(body); } catch { return body; }
  for (let depth = 0; depth < 2; depth += 1) {
    if (typeof value === "string") { try { value = JSON.parse(value); continue; } catch { return String(value); } }
    if (value && typeof value === "object") {
      const record = value as { content?: unknown; text?: unknown };
      if (Array.isArray(record.content)) {
        const text = record.content
          .flatMap(block => block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string" ? [(block as { text: string }).text] : [])
          .join("\n\n");
        if (text) return text;
      }
      if (typeof record.text === "string") return record.text;
    }
    return body;
  }
  return body;
}

const MODES = ["on", "strict", "off"] as const;
type GuardAction = (action: "approve" | "dismiss" | "mode", item: TextGuardItem | null, extra?: Record<string, unknown>) => void;

function ModeButtons(props: { mode: "on" | "strict" | "off"; busy: boolean; onAction: GuardAction }) {
  return <Each of={MODES} key={mode => mode}>{mode => <Button variant={props.mode === mode() ? "default" : "ghost"} className="h-7 px-2 text-xs" disabled={props.busy} onClick={() => props.onAction("mode", null, { mode: mode() })}><Text class="text-xs">{mode() === "on" ? "On" : mode() === "strict" ? "Strict" : "Off"}</Text></Button>}</Each>;
}

/** Sits directly above the composer; it never opens a dialog. */
export function TextGuardBar(props: {
  data: TextGuardData | null;
  open: boolean;
  busy: boolean;
  running: boolean;
  error: string | null;
  historical?: boolean;
  onToggle: () => void;
  onStop: () => void;
  onAction: GuardAction;
}) {
  const selected = signal<string | null>(null);
  const items = computed(() => props.data?.items ?? []);
  const item = computed(() => {
    const id = selected();
    return id ? items().find(entry => entry.id === id) : undefined;
  });
  const withheld = computed(() => items().filter(entry => entry.withheld).length);
  const clear = computed(() => !!props.data && items().length === 0);
  const accent = computed(() => clear()
    ? { border: "rgba(34, 197, 94, 0.72)", background: "rgba(34, 197, 94, 0.10)", icon: "#22c55e" }
    : { border: "rgba(245, 158, 11, 0.72)", background: "rgba(245, 158, 11, 0.11)", icon: "#f59e0b" });
  const mode = computed(() => textGuardMode(props.data?.mode));
  const pending = computed(() => items().length);
  const reviewable = computed(() => pending() > 0 || (!props.data && !(props.historical && props.error)));
  const label = computed(() => props.data
    ? withheld()
      ? `TextGuard withheld ${withheld()} item${withheld() === 1 ? "" : "s"} from the model`
      : items().length
        ? `TextGuard has ${items().length} finding${items().length === 1 ? "" : "s"} to review`
        : "TextGuard completed for this session"
    : props.historical
      ? "TextGuard withheld content in this session"
      : "TextGuard withheld content from the model");
  const subtitle = computed(() => !props.data
    ? props.running
      ? "The turn is still running. Review this content when it settles."
      : props.historical
        ? props.error
          ? "The content is still withheld. Re-run the request to create a new review."
          : "The transcript shows withheld content. Click Review to inspect this session."
        : "Click Review to inspect the current session."
    : items().length === 0
      ? "No items are waiting for a decision. You can still change the scanning mode."
      : "The content was not injected into the model. Review it before retrying.");
  return <View role="region" accessibilityLabel="TextGuard" class="mb-2 w-full flex-col rounded-xl border" style={{ borderColor: accent().border, backgroundColor: accent().background }}>
    <View class="flex-row items-center gap-2 px-3 py-2">
      <Icon name="ShieldAlert" size={16} color={accent().icon} />
      <View class="min-w-0 flex-1 flex-col">
        <Text class="truncate text-xs font-medium">{label()}</Text>
        <Text class="truncate text-[11px] text-muted-foreground">{subtitle()}</Text>
      </View>
      <If when={props.running && pending() > 0}><Button variant="outline" className="h-7 shrink-0 border-destructive/50 px-2 text-xs" onClick={() => props.onStop()}><Text class="text-xs text-destructive">Stop turn</Text></Button></If>
      <If when={reviewable()}><Button variant="outline" className="h-7 shrink-0 px-2 text-xs" disabled={props.busy && !!props.data} onClick={() => props.onToggle()}><Icon name={props.open ? "ChevronUp" : "ChevronDown"} size={14} /><Text class="text-xs">{props.open ? "Hide" : "Review"}</Text></Button></If>
    </View>
    <If when={!!props.data && pending() === 0}><View class="flex-row items-center gap-1.5 border-t border-border px-3 py-1.5">
      <Text class="mr-auto text-[10px] uppercase tracking-wide text-muted-foreground">Scanning mode</Text>
      <ModeButtons mode={mode()} busy={props.busy} onAction={props.onAction} />
    </View></If>
    <If when={!!props.error}><Text role="alert" class="border-t border-amber-500/20 px-3 py-1.5 text-xs text-destructive">{props.error}</Text></If>
    <If when={props.open && !!props.data && pending() > 0}><ScrollArea className="max-h-80 border-t border-amber-500/20 px-3 py-2">
      <If when={item()} else={
        <View class="flex-col">
          <View class="flex-col gap-1.5">
            <Each of={items()} key={entry => entry.id}>{entry => <View class="flex-col rounded-md border border-border p-2">
              <View class="flex-row items-center gap-2">
                <Icon name="ShieldAlert" size={14} color={entry().withheld ? token("destructive") : token("muted-foreground")} />
                <Text class="min-w-0 flex-1 truncate text-xs font-medium" tooltip={<Text>{entry().source}</Text>}>{entry().source}</Text>
                <Text class="text-[10px] uppercase text-muted-foreground">{entry().withheld ? "withheld" : "report"}</Text>
              </View>
              <Text class="mt-1 text-[11px] text-muted-foreground">{entry().severity} · {entry().digest.slice(0, 12)}…</Text>
              <Button variant="outline" className="mt-1.5 h-7 px-2 text-xs" disabled={props.busy} onClick={() => selected.set(entry().id)}><Text class="text-xs">Review</Text></Button>
            </View>}</Each>
          </View>
          <View class="mt-2 flex-row items-center gap-1.5 border-t border-border pt-2">
            <Text class="mr-auto text-[10px] uppercase tracking-wide text-muted-foreground">Scanning mode</Text>
            <ModeButtons mode={mode()} busy={props.busy} onAction={props.onAction} />
          </View>
        </View>
      }>{entry => <View class="flex-col">
        <View class="mb-2 flex-row items-center gap-2">
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => selected.set(null)}><Text class="text-xs">Back</Text></Button>
          <Text class="ml-auto text-[10px] uppercase text-muted-foreground">{entry().withheld ? "withheld" : "report"}</Text>
        </View>
        <View class="flex-col gap-1 text-[11px]">
          <View class="flex-row gap-2"><Text class="w-22 shrink-0 text-[11px] text-muted-foreground">Source</Text><Text class="min-w-0 flex-1 break-all text-[11px]">{entry().review.source}</Text></View>
          <View class="flex-row gap-2"><Text class="w-22 shrink-0 text-[11px] text-muted-foreground">SHA-256</Text><Text class="min-w-0 flex-1 break-all font-mono text-[11px]">{entry().review.digest}</Text></View>
          <View class="flex-row gap-2"><Text class="w-22 shrink-0 text-[11px] text-muted-foreground">Findings</Text><Text class="min-w-0 flex-1 text-[11px]">{entry().review.severity?.error ?? 0} error · {entry().review.severity?.warn ?? 0} warning · {entry().review.severity?.info ?? 0} info{entry().review.reason ? ` · ${entry().review.reason}` : ""}</Text></View>
        </View>
        <If when={!!entry().review.findings?.length}><View class="mt-2 flex-col gap-1">
          <Each of={entry().review.findings ?? []} key="index">{finding => <Text class="rounded border border-border px-2 py-1 text-xs">{finding().kind ?? "finding"}{typeof finding().offset === "number" ? ` · character ${finding().offset}` : ""}</Text>}</Each>
        </View></If>
        <If when={entry().snapshot?.body !== undefined}><ScrollArea className="mt-2 max-h-40 rounded border border-border bg-background p-2"><ChatMarkdown text={readableTextGuardSnapshot(entry().snapshot?.body)} /></ScrollArea></If>
        <View class="mt-2 flex-row flex-wrap justify-end gap-2">
          <If when={entry().withheld} else={<Button variant="outline" disabled={props.busy} onClick={() => props.onAction("dismiss", entry())}><Text class="text-sm">Dismiss report</Text></Button>}>
            <Button variant="outline" disabled={props.busy} onClick={() => props.onAction("approve", entry(), { persist: false })}><Text class="text-sm">Allow for this session</Text></Button>
            <Button disabled={props.busy} onClick={() => props.onAction("approve", entry(), { persist: true })}><Text class="text-sm">Always allow this content</Text></Button>
          </If>
        </View>
      </View>}</If>
    </ScrollArea></If>
  </View>;
}
