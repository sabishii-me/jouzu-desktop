import { View, Text, computed } from "nsh";
import { ActivityRow, type ActivityState } from "./activity-row";
import { object, type ToolView } from "../chat-projection";
import { toolText, type ToolRendererProps } from "./types";

function argsOf(tool: ToolView): Record<string, unknown> {
  if (object(tool.args)) return tool.args;
  if (typeof tool.args === "string") { try { const value = JSON.parse(tool.args); return object(value) ? value : {}; } catch { return {}; } }
  return {};
}
export function WaitRenderer(props: ToolRendererProps) {
  const view = computed(() => {
    const args = argsOf(props.tool);
    const handles = Array.isArray(args.on) ? args.on.flatMap(value => { const item = object(value) ? value : {}; return typeof item.handle === "string" ? [item.handle] : []; }) : [];
    const summary = typeof args.reason === "string" ? args.reason : typeof args.deadline === "string" ? `Deadline ${args.deadline}` : undefined;
    return { handles, summary };
  });
  const state = computed((): ActivityState => props.tool.phase === "running" ? "running" : props.tool.phase === "error" ? "error" : "done");
  const text = computed(() => toolText(props.tool.result));
  return <ActivityRow title={props.tool.name === "agent_wait_cancel" ? "Wait released" : "Waiting for dependencies"} summary={view().summary} state={state()} defaultOpen={!!text()}>
    <If when={view().handles.length > 0}><View class="mb-1 flex-col gap-1">
      <Each of={view().handles} key={handle => handle}>{handle => <Text class="truncate font-mono text-[11px] text-muted-foreground">{handle()}</Text>}</Each>
    </View></If>
    <If when={!!text()}><Text class="whitespace-pre-wrap" selectable>{text()}</Text></If>
  </ActivityRow>;
}