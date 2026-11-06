import { View, Text, Overlay, signal, computed, token } from "nsh";
import type { JSX, ViewRef } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { Icon } from "./ui/icons";
import { cn } from "./lib";
import type { SessionStats, SessionTiming } from "./chat-connection";

// Minimal local stand-ins for components/stat-popover (not ported in this stage).
function StatPopover(props: { label: JSX.Element; children: JSX.Element; align?: "left" | "right" }) {
  const open = signal(false);
  let trigger: ViewRef | undefined;
  return <View class="relative min-w-0">
    <BaseButton ref={node => { trigger = node; }} onPress={() => open.update(value => !value)} class="flex-row min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-muted/60">{props.label}</BaseButton>
    <If when={open()}>
      <Overlay anchor={trigger ?? null} placement="top" align={props.align === "right" ? "end" : "start"} offset={8} margin={8} onPressOutside={() => open.set(false)} onCancel={() => open.set(false)}>
        <View class="w-72 flex-col rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-xl">{props.children}</View>
      </Overlay>
    </If>
  </View>;
}
function StatRow(props: { label: JSX.Element; value: JSX.Element; mono?: boolean }) {
  return <View class="flex-row items-start justify-between gap-3 py-1">
    <Text class="text-xs text-muted-foreground">{props.label}</Text>
    <Text class={cn("text-right text-xs", props.mono && "font-mono")}>{props.value}</Text>
  </View>;
}
function StatCard(props: { title: JSX.Element; value?: JSX.Element; children: JSX.Element }) {
  return <View class="flex-col">
    <View class="flex-row items-start justify-between gap-3 border-b border-border pb-2">
      <Text class="text-xs font-medium">{props.title}</Text>
      <If when={props.value !== undefined}><Text class="text-xs font-medium tabular-nums">{props.value}</Text></If>
    </View>
    <View class="flex-col pt-1">{props.children}</View>
  </View>;
}

function compact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}
function exact(value: number) {
  return value.toLocaleString("en-US");
}
function formatDuration(ms: number) {
  if (ms <= 0) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}
/** Whole-session counters and their DSH-style detail cards; no wall-clock session timer. */
export function SessionStatsBar(props: { stats?: SessionStats; timing?: SessionTiming }) {
  const view = computed(() => {
    const stats = props.stats;
    const timing = props.timing;
    if (!stats) return null;
    const tokens = stats.tokens ?? {};
    const total = Number.isFinite(tokens.total) ? tokens.total! : (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
    const prompt = (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
    const cached = prompt > 0 ? Math.round((tokens.cacheRead ?? 0) / prompt * 100) : null;
    const turns = stats.userMessages ?? timing?.turns ?? 0;
    const steps = stats.assistantMessages ?? timing?.steps ?? 0;
    const percent = stats.contextUsage?.percent;
    const speed = timing && timing.modelMs > 0 ? timing.outputTokens / (timing.modelMs / 1000) : null;
    if (!total && !steps && percent == null) return null;
    return { tokens, total, cached, turns, steps, percent, speed };
  });
  return <If when={view()}>{value => <View accessibilityLabel="Session usage" class="mx-auto flex-row max-w-3xl flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-[11px] text-muted-foreground">
    <If when={value().steps > 0}><StatPopover label={<View class="flex-row items-center gap-1.5"><Icon name="Gauge" size={14} color={token("muted-foreground")} /><Text class="text-[11px] text-muted-foreground">{value().turns} turns · {value().steps} steps{value().speed !== null ? ` · ${compact(value().speed!)} tok/s` : ""}</Text></View>}>
      <StatCard title="Session stats">
        <StatRow label="Model time" value={formatDuration(props.timing?.modelMs ?? 0)} />
        <StatRow label="Tool time" value={formatDuration(props.timing?.toolMs ?? 0)} />
        <StatRow label="First token avg (TTFT)" value="—" />
        <StatRow label="Output speed (TPS)" value={value().speed !== null ? `${compact(value().speed!)} tok/s` : "—"} />
      </StatCard>
    </StatPopover></If>
    <If when={!!value().total}><StatPopover label={<View class="flex-row items-center gap-1.5"><Icon name="Database" size={14} color={token("muted-foreground")} /><Text class="text-[11px] text-muted-foreground">{compact(value().total)} tok{value().cached !== null ? ` · ${value().cached}% cached` : ""}</Text></View>}>
      <StatCard title="Token usage" value={`${exact(value().total)} tok`}>
        <If when={value().cached !== null}><StatRow label="Cache hit" value={`${value().cached}%`} /></If>
        <StatRow label="Uncached input" value={`${exact(value().tokens.input ?? 0)} tok`} />
        <StatRow label="Cache read" value={`${exact(value().tokens.cacheRead ?? 0)} tok`} />
        <If when={!!value().tokens.cacheWrite}><StatRow label="Cache write" value={`${exact(value().tokens.cacheWrite!)} tok`} /></If>
        <StatRow label="Output" value={`${exact(value().tokens.output ?? 0)} tok`} />
      </StatCard>
    </StatPopover></If>
    <If when={value().percent != null}><StatPopover align="right" label={<View class="flex-row items-center gap-1.5"><Icon name="CircleGauge" size={14} color={token("muted-foreground")} /><Text class="text-[11px] text-muted-foreground">{Math.round(value().percent!)}%</Text></View>}>
      <StatCard title="Context used" value={`~${compact(props.stats?.contextUsage?.tokens ?? 0)} / ${compact(props.stats?.contextUsage?.contextWindow ?? 0)}`}>
        <View class="pt-2"><View class="h-1.5 overflow-hidden rounded-full bg-muted"><View class="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value().percent!))}%` }} /></View></View>
      </StatCard>
    </StatPopover></If>
  </View>}</If>;
}
