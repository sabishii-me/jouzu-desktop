import { computed } from "nsh";
import { ActivityRow } from "./activity-row";
import { object, type ToolView } from "../chat-projection";
import { ScrollArea } from "../ui/scroll-area";
import { Text } from "nsh";
import { toolText, type ToolRendererProps } from "./types";

function argsOf(tool: ToolView): Record<string, unknown> {
  if (object(tool.args)) return tool.args;
  if (typeof tool.args === "string") { try { const value = JSON.parse(tool.args); return object(value) ? value : {}; } catch { return {}; } }
  return {};
}
export function BackgroundRenderer(props: ToolRendererProps) {
  const command = computed(() => {
    const args = argsOf(props.tool);
    return typeof args.command === "string" ? args.command : undefined;
  });
  const text = computed(() => toolText(props.tool.result));
  const state = computed(() => props.tool.phase === "running" ? "running" as const : props.tool.phase === "error" ? "error" as const : "done" as const);
  return <ActivityRow title="Background task" summary={command()} state={state()} defaultOpen={!!text()}>
    <If when={!!text()}><ScrollArea className="max-h-72"><Text class="whitespace-pre-wrap text-[11px]" selectable>{text()}</Text></ScrollArea></If>
  </ActivityRow>;
}