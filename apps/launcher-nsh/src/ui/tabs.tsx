import { View, Text, context } from "nsh";
import { Tabs as BaseTabs, Tab } from "nsh/base";
import type { JSX } from "nsh";
import { cn } from "../lib";

interface TabsState {
  value: () => string;
  setValue: (value: string) => void;
}
const TabsContext = context<TabsState>({ value: () => "", setValue: () => {} });

/**
 * The baseline tabs API on nsh/base: Tabs owns the value, TabsTrigger names
 * one, TabsContent shows while its value is the current one. The context
 * holds an accessor so the value follows the parent's signal.
 */
export function Tabs(props: {
  value: string;
  onValueChange?: (value: string) => void;
  className?: string;
  orientation?: "horizontal" | "vertical";
  children?: JSX.Element;
}) {
  return (
    <TabsContext.Provider value={{ value: () => props.value, setValue: next => props.onValueChange?.(next) }}>
      <View class={cn("flex-col", props.className)}>{props.children}</View>
    </TabsContext.Provider>
  );
}

export function TabsList(props: { className?: string; "aria-label"?: string; children?: JSX.Element }) {
  return <BaseTabs class={cn("flex-row items-center gap-1 rounded-lg bg-muted p-1", props.className)}>{props.children}</BaseTabs>;
}

export function TabsTrigger(props: { value: string; className?: string; children?: JSX.Element }) {
  const tabs = TabsContext();
  return (
    <Tab
      class={cn(
        "flex-row items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground selected:bg-background selected:text-foreground hover:text-foreground",
        props.className,
      )}
      selected={tabs.value() === props.value}
      onPress={() => tabs.setValue(props.value)}
    >
      {typeof props.children === "string" ? <Text class="text-sm font-medium">{props.children}</Text> : props.children}
    </Tab>
  );
}

export function TabsContent(props: { value: string; className?: string; children?: JSX.Element }) {
  const tabs = TabsContext();
  return (
    <If when={tabs.value() === props.value}>
      <View class={cn("flex-col", props.className)}>{props.children}</View>
    </If>
  );
}