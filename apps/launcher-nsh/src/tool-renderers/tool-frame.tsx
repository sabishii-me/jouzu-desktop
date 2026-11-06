import { View, Text, signal, computed, context, token, Clipboard } from "nsh";
import type { JSX } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { cn } from "../lib";
import { Icon } from "../ui/icons";
import { ScrollArea } from "../ui/scroll-area";

/** Chips render the same body without a second header/border. */
export const ToolDetailContext = context(false);

export type ToolState = "running" | "done" | "error" | "warning" | "idle";

const DOT: Record<ToolState, string> = {
  running: "bg-primary animate-pulse",
  done: "bg-emerald-500",
  error: "bg-destructive",
  warning: "bg-amber-500",
  idle: "bg-muted-foreground/50",
};

const STATUS: Record<ToolState, string> = {
  running: "Running",
  done: "Completed",
  error: "Failed",
  warning: "Warning",
  idle: "Pending",
};

export function StateDot(props: { state: ToolState }) {
  return <View class={cn("size-2 shrink-0 rounded-full", DOT[props.state])} accessibilityElementsHidden />;
}

/** Running and failed tools are useful immediately; finished text is not. */
export function defaultOpenFor(state: ToolState): boolean {
  return state === "running" || state === "error" || state === "warning";
}

/**
 * The one disclosure used by every tool card. The whole header is the button and
 * the body is never nested inside a second disclosure.
 */
export function ToolFrame(props: {
  title: JSX.Element;
  subtitle?: JSX.Element;
  state: ToolState;
  defaultOpen?: boolean;
  actions?: JSX.Element;
  children?: JSX.Element;
  icon?: JSX.Element;
  className?: string;
  /** Tools open while running; a thinking disclosure does not. */
  autoOpen?: boolean;
  statusLabel?: string;
}) {
  const manual = signal<boolean | null>(null);
  const embedded = ToolDetailContext();
  const expandable = props.children !== undefined;
  const open = computed(() => {
    const autoOpen = props.autoOpen ?? true;
    const initial = (autoOpen ? defaultOpenFor(props.state) : props.state === "error" || props.state === "warning") || props.defaultOpen === true;
    return expandable && (manual() ?? initial);
  });
  return (
    <If when={embedded} else={
      <View class={cn("my-1.5 flex-col overflow-hidden rounded-lg border border-border bg-muted/20", props.className)}>
        <View class="flex-row items-center gap-2 px-2.5 py-2">
          <BaseButton
            class="flex-row min-w-0 flex-1 items-center gap-2 text-left text-xs disabled:opacity-100"
            onPress={() => { if (expandable) manual.set(!open()); }}
            disabled={!expandable}
          >
            {props.icon ?? <StateDot state={props.state} />}
            <View class="min-w-0 flex-1 flex-col">
              <Text class="truncate text-xs font-medium">{props.title}</Text>
              <If when={props.subtitle !== undefined && props.subtitle !== ""}>
                <Text class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{props.subtitle}</Text>
              </If>
            </View>
            <Text class={cn("shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
              props.state === "running" ? "border-primary/40 text-primary"
                : props.state === "error" ? "border-destructive/40 text-destructive"
                  : props.state === "warning" ? "border-amber-500/40 text-amber-600"
                    : "border-border text-muted-foreground")}>{props.statusLabel ?? STATUS[props.state]}</Text>
            <If when={expandable}>
              <View style={{ transform: [{ rotate: open() ? "180deg" : "0deg" }] }}>
                <Icon name="ChevronDown" size={14} color={token("muted-foreground")} />
              </View>
            </If>
          </BaseButton>
          <If when={props.actions !== undefined}>
            <View class="flex-row shrink-0 items-center gap-1">{props.actions}</View>
          </If>
        </View>
        <If when={open()}>
          <View class="flex-col gap-2 border-t border-border px-3 py-2 text-xs">{props.children}</View>
        </If>
      </View>
    }>
      <View class="flex-col gap-2 text-xs">{props.children}</View>
    </If>
  );
}

/** One body section. The optional copy button is the only copy affordance. */
export function ToolSection(props: {
  label: string;
  copyText?: string;
  children: JSX.Element;
  maxHeight?: string;
}) {
  const copied = signal(false);
  return <View class="flex-col gap-1">
    <View class="flex-row items-center justify-between gap-2">
      <Text class="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{props.label}</Text>
      <If when={props.copyText !== undefined}>
        <BaseButton
          class="flex-row items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onPress={() => {
            const text = props.copyText;
            if (text === undefined) return;
            void Clipboard.writeText(text).then(() => {
              copied.set(true);
              setTimeout(() => copied.set(false), 1200);
            }).catch(() => copied.set(false));
          }}
        >
          <Icon name={copied() ? "Check" : "Copy"} size={12} color={token("muted-foreground")} />
          <Text class="text-[10px]">{copied() ? "Copied" : "Copy"}</Text>
        </BaseButton>
      </If>
    </View>
    <ScrollArea className={cn(props.maxHeight ?? "max-h-96")}>{props.children}</ScrollArea>
  </View>;
}