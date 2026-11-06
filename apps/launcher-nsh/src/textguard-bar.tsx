import { View, Text, signal, computed } from "nsh";
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
  return <Each of={MODES} key={value => value}>{value => <Button variant={props.mode === value ? "default" : "ghost"} className="h-7 px-2 text-xs" disabled={props.busy} onClick={() => props.onAction("mode", null, { mode: value })}><Text class="text-xs">{value === "on" ? "On" : value === "strict" ? "Strict" : "Off"}</Text></Button>}</Each>;
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
