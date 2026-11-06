import { View, Text, computed } from "nsh";
import { ActivityRow, type ActivityState } from "./activity-row";
import { object, type ToolView } from "../chat-projection";
import type { ToolRendererProps } from "./types";

function argsOf(tool: ToolView): Record<string, unknown> {
  if (object(tool.args)) return tool.args;
  if (typeof tool.args === "string") { try { const value = JSON.parse(tool.args); return object(value) ? value : {}; } catch { return {}; } }
  return {};
}

/** Task mutations are summarized here only. The authoritative task list is the
 * session-scoped Flow dock, so the transcript never renders a second todo list. */
export function TaskRenderer(props: ToolRendererProps) {
  const view = computed(() => {
    const tool = props.tool;
    const args = argsOf(tool);
    const tasks = Array.isArray(args.tasks) ? args.tasks.flatMap(value => object(value) ? [value] : []) : [];
    const count = tasks.length || (typeof args.subject === "string" ? 1 : 0);
    const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
    const title = tool.name === "TaskCreateMany" || tool.name === "TaskCreate" ? "Tasks updated"
      : tool.name === "TaskUpdate" ? "Task updated"
        : tool.name === "TaskExecute" ? "Task execution" : "Tasks";
    const summary = taskId ? `#${taskId}${typeof args.status === "string" ? ` · ${args.status.replaceAll("_", " ")}` : ""}`
      : count ? `${count} task${count === 1 ? "" : "s"}` : undefined;
    const detail = tasks.slice(0, 8).map(task => [typeof task.subject === "string" ? task.subject : "", typeof task.status === "string" ? task.status.replaceAll("_", " ") : ""].filter(Boolean).join(" · ")).filter(Boolean);
    const subject = typeof args.subject === "string" ? args.subject : undefined;
    return { title, summary, detail, subject, taskId };
  });
  const phase = computed((): ActivityState => props.tool.phase === "running" ? "running" : props.tool.phase === "error" ? "error" : "done");
  return <ActivityRow title={view().title} summary={view().summary} state={phase()}>
    <View class="flex-col gap-1 text-[11px] text-muted-foreground">
      <If when={view().subject !== undefined}><Text class="text-[11px] text-foreground">{view().subject}</Text></If>
      <Each of={view().detail} key="index">{line => <Text class="truncate text-[11px] text-muted-foreground">{line()}</Text>}</Each>
      <If when={!view().detail.length && !view().taskId}><Text class="text-[11px] text-muted-foreground">No task details were returned.</Text></If>
    </View>
  </ActivityRow>;
}