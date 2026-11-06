import { signal, Text, View } from "nsh";
import type { Signal } from "nsh";
import { invoke, errorText } from "../host/invoke";
import { Button } from "../ui/button";
import { Icon } from "../ui/icons";

/** One row of the System section: which copy a component uses, and what is still missing. */
export function ComponentSection(props: {
  title: string; status?: string; note?: string; tone?: "ok" | "missing";
  busy: boolean; error: string | null;
  install?: () => void; installLabel: string;
}) {
  return <View role="region" accessibilityLabel={props.title} class="flex-col gap-2 border-t border-border px-5 py-4">
    <View class="flex-col">
      <Text class="font-medium">{props.title}</Text>
      <If when={props.status}>
        <Text class={`mt-1 text-sm ${props.tone === "missing" ? "text-destructive" : "text-muted-foreground"}`}>{props.status}</Text>
      </If>
    </View>
    <View class="flex-row flex-wrap items-center gap-2">
      <View class="size-4 items-center justify-center">
        <If when={props.busy}>
          <Icon name="LoaderCircle" size={16} className="animate-spin" />
        </If>
      </View>
      {/* The action is always in the row: without an action it is disabled, so nothing the row shows
          arriving or leaving moves the layout. */}
      <Button disabled={props.busy || !props.install} onClick={props.install}>{props.installLabel}</Button>
    </View>
    <If when={props.note}>
      <Text class="text-xs text-muted-foreground">{props.note}</Text>
    </If>
    <If when={props.error}>
      <Text role="alert" class="text-xs text-destructive">{props.error}</Text>
    </If>
  </View>;
}

/** Joins what is known about a component, leaving out what is not. */
export const describe = (parts: (string | undefined)[]) => parts.filter(part => part).join(" · ");

/**
 * The signal port of the baseline ComponentApi: `state` becomes `value`, and
 * `refresh()` is the read the baseline ran from its mount effect. `busy`/`run`
 * stay because the rows' actions need them.
 */
export interface ComponentApi<State> {
  value: Signal<State | null>;
  busy: Signal<boolean>;
  error: Signal<string | null>;
  refresh(): Promise<void>;
  run: (call: () => Promise<State>) => Promise<void>;
}

/** Reads a component's state and keeps it in step with the actions its row offers. */
export function createComponent<State>(command: string): ComponentApi<State> {
  const value = signal<State | null>(null);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const refresh = async () => {
    try {
      const next = await invoke<State>(command);
      value.set(next && typeof next === "object" ? next : null);
    } catch (failure) { error.set(errorText(failure)); }
  };
  void refresh();
  const run = async (call: () => Promise<State>) => {
    busy.set(true); error.set(null);
    try {
      const next = await call();
      value.set(next && typeof next === "object" ? next : null);
    }
    catch (failure) { error.set(errorText(failure)); await refresh(); }
    finally { busy.set(false); }
  };
  return { value, busy, error, refresh, run };
}
