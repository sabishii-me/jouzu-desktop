import { View, Text, computed } from "nsh";
import { object } from "../chat-projection";
import { ToolFrame, ToolSection } from "./tool-frame";
import { ToolOutput } from "./tool-output";
import { toolText, type ToolRendererProps } from "./types";

/** Every tool gets a card, even when the runtime adds one we do not know yet. */
export function GenericRenderer(props: ToolRendererProps) {
  const text = computed(() => toolText(props.tool.result));
  const state = computed(() => props.tool.phase === "running" ? "running" as const : props.tool.phase === "error" ? "error" as const : "done" as const);
  const argumentText = computed(() => props.tool.args === undefined ? undefined : JSON.stringify(props.tool.args, null, 2));
  const hasStructuredResult = computed(() => !!object(props.tool.result));
  return <ToolFrame title={props.tool.name} subtitle="Tool call" state={state()}>
    <If when={props.tool.phase === "error" && !text()}><Text class="text-[11px] text-destructive" role="alert">This tool failed without an error message.</Text></If>
    <If when={!!text() || hasStructuredResult()}><ToolOutput tool={props.tool} /></If>
    <If when={argumentText() !== undefined}><ToolSection label="Arguments" copyText={argumentText()}>
      <Text class="whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-muted-foreground">{argumentText()}</Text>
    </ToolSection></If>
    <If when={argumentText() === undefined && !text() && !hasStructuredResult()}><Text class="text-[11px] text-muted-foreground">This tool returned no displayable output.</Text></If>
  </ToolFrame>;
}