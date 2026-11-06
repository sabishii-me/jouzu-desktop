import { computed } from "nsh";
import { ActivityRow } from "./activity-row";
import { ToolOutput } from "./tool-output";
import { record, toolText, type ToolRendererProps } from "./types";

const named = {
  compact_context: { title: "Context compaction", summary: "Requested for the next turn" },
  subagent: { title: "Subagent", summary: "Delegated work" },
  schedule_prompt: { title: "Scheduled prompt", summary: "Queued for a later time" },
  agent_no_reply: { title: "No reply", summary: "Notification-only turn" },
} as const;
export type NamedTool = keyof typeof named;
export function isNamedTool(name: string): name is NamedTool { return name in named; }
export function NamedRenderer(props: ToolRendererProps) {
  const definition = named[props.tool.name as NamedTool];
  const detail = computed(() => {
    const args = record(props.tool.args) ?? {};
    return props.tool.name === "subagent"
      ? [args.op, args.role, args.task].filter(value => typeof value === "string").join(" · ")
      : props.tool.name === "schedule_prompt" && typeof args.prompt === "string" ? args.prompt : undefined;
  });
  const text = computed(() => toolText(props.tool.result));
  const state = computed(() => props.tool.phase === "running" ? "running" as const : props.tool.phase === "error" ? "error" as const : "done" as const);
  return <ActivityRow title={definition.title} summary={detail() || definition.summary} state={state()} defaultOpen={!!text()}>
    <If when={!!text()}><ToolOutput tool={props.tool} /></If>
  </ActivityRow>;
}