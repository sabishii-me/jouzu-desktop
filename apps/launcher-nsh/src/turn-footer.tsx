import { View, Text, Overlay, signal, computed, token, Clipboard } from "nsh";
import type { JSX, ViewRef } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { cn } from "./lib";
import type { ChatMessage } from "./chat-projection";

// Minimal local stand-ins for components/stat-popover (not ported in this stage):
// the same trigger + detail-card contract on a root Overlay.
function StatPopover(props: { label: JSX.Element; children: JSX.Element; align?: "left" | "right" }) {
  const open = signal(false);
  let trigger: ViewRef | undefined;
  return <View class="relative min-w-0">
    <BaseButton ref={node => { trigger = node; }} accessibilityState={{ expanded: open() }} onPress={() => open.update(value => !value)} class="flex-row min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted/60">{props.label}</BaseButton>
    <If when={open()}>
      <Overlay anchor={trigger ?? null} placement="top" align={props.align === "right" ? "end" : "start"} offset={8} margin={8} onPressOutside={() => open.set(false)} onCancel={() => open.set(false)}>
        <View class="w-72 flex-col rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-xl" role="dialog">{props.children}</View>
      </Overlay>
    </If>
  </View>;
}
function StatRow(props: { label: JSX.Element; value: JSX.Element; mono?: boolean }) {
  return <View class="flex-row items-start justify-between gap-3 py-1">
    <Text class="text-xs text-muted-foreground">{props.label}</Text>
    <Text class={cn("text-right text-xs", props.mono && "font-mono")} selectable>{props.value}</Text>
  </View>;
}
function StatCard(props: { title: JSX.Element; value?: JSX.Element; children: JSX.Element }) {
  return <View class="flex-col">
    <View class="flex-row items-start justify-between gap-3 border-b border-border pb-2">
      <Text class="text-xs font-medium">{props.title}</Text>
      <If when={props.value !== undefined}><Text class="text-xs font-medium tabular-nums" selectable>{props.value}</Text></If>
    </View>
    <View class="flex-col pt-1">{props.children}</View>
  </View>;
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}
function exact(value: number) {
  return value.toLocaleString("en-US");
}
function percentage(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
function providerLabel(provider?: string) {
  if (!provider) return "—";
  if (!provider.startsWith("catalog:")) return provider;
  const parts = provider.split(":");
  return parts[2] || parts[1] || provider;
}
function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function messageText(message: ChatMessage) {
  return message.content.filter(block => block.type === "text").map(block => block.text ?? "").join("\n").trim();
}
/** End-of-turn actions: copy, fork and the turn's own usage. Feedback is intentionally omitted. */
export function TurnFooter(props: { message: ChatMessage; usage?: ChatMessage["usage"]; startedAt?: number; onFork?: () => void; forkDisabled?: boolean }) {
  const copied = signal(false);
  const text = computed(() => messageText(props.message));
  const turnUsage = computed(() => props.usage ?? props.message.usage);
  const total = computed(() => {
    const usage = turnUsage();
    return usage ? (usage.total ?? usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)) : 0;
  });
  const cacheHit = computed(() => {
    const usage = turnUsage();
    const prompt = usage ? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) : 0;
    return prompt > 0 ? (usage!.cacheRead ?? 0) / prompt * 100 : null;
  });
  const elapsed = computed(() => props.message.endedAt && props.startedAt ? props.message.endedAt - props.startedAt : undefined);
  const usageLabel = computed(() => `Usage ${compact(total())} tok${elapsed() !== undefined && elapsed()! >= 0 ? ` · ${duration(elapsed()!)}` : ""}`);
  const copy = async () => {
    try {
      await Clipboard.writeText(text());
      copied.set(true);
      setTimeout(() => copied.set(false), 1500);
    } catch { /* Clipboard unavailable; leave the transcript unchanged. */ }
  };
  return <If when={!!text()}>
    <View role="group" accessibilityLabel="Turn actions" class="mt-2 flex-row items-center gap-1 text-muted-foreground">
      <Button variant="ghost" className="size-7 p-0" aria-label="Copy response" title="Copy response" onClick={() => void copy()}><Icon name={copied() ? "Check" : "Copy"} size={14} color={token("muted-foreground")} /></Button>
      <If when={!!props.onFork}><Button variant="ghost" className="size-7 p-0" aria-label="Branch into a new conversation" title={props.forkDisabled ? "Wait for the session to finish loading" : "Branch into a new conversation"} disabled={props.forkDisabled} onClick={() => props.onFork?.()}><Icon name="GitFork" size={14} color={token("muted-foreground")} /></Button></If>
      <If when={!!total()}><View class="ml-2"><StatPopover label={<View class="flex-row items-center gap-1.5"><Icon name="Database" size={14} color={token("muted-foreground")} /><Text class="text-[11px] text-muted-foreground">{usageLabel()}</Text></View>}>
        <StatCard title="Turn usage" value={`${exact(total())} tok`}>
          <StatRow label="Provider / model" value={`${providerLabel(props.message.provider)} / ${props.message.model ?? "—"}`} />
          <If when={cacheHit() !== null}><StatRow label="Cache hit" value={percentage(cacheHit()!)} /></If>
          <StatRow label="Uncached input" value={`${exact(turnUsage()?.input ?? 0)} tok`} />
          <StatRow label="Cache read" value={`${exact(turnUsage()?.cacheRead ?? 0)} tok`} />
          <StatRow label="Cache write" value={`${exact(turnUsage()?.cacheWrite ?? 0)} tok`} />
          <StatRow label="Output" value={`${exact(turnUsage()?.output ?? 0)} tok`} />
        </StatCard>
      </StatPopover></View></If>
      <If when={!total() && elapsed() !== undefined && elapsed()! >= 0}><Text class="ml-2 text-[11px] tabular-nums text-muted-foreground">{duration(elapsed()!)}</Text></If>
    </View>
  </If>;
}
