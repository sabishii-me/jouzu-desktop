import { computed } from "nsh";
import { BackgroundRenderer } from "./background-renderer";
import { FlowReportRenderer, flowReport } from "./flow-report";
import { GenericRenderer } from "./generic-renderer";
import { ImageRenderer } from "./image-renderer";
import { isNamedTool, NamedRenderer } from "./named-renderer";
import { isSimpleTool, SimpleToolRenderer } from "./simple-renderers";
import { TaskRenderer } from "./task-renderer";
import { WaitRenderer } from "./wait-renderer";
import { toolText, type ToolRendererProps } from "./types";

const taskTools = /^Task(CreateMany|Create|Update|List|Get|Execute|Output|Stop|Reorder)$/u;
const waitTools = /^(agent_wait|agent_wait_cancel)$/u;
const backgroundTools = /^bg_/u;

/** One dispatch point for every tool card. New native tools add a renderer here,
 * not another branch inside the conversation component. The kind is computed
 * so a result that becomes a flow report switches renderers as it arrives. */
export function ToolRenderer(props: ToolRendererProps) {
  const kind = computed(() => {
    const tool = props.tool;
    if (flowReport(toolText(tool.result))) return "flow";
    if (taskTools.test(tool.name)) return "task";
    if (waitTools.test(tool.name)) return "wait";
    if (backgroundTools.test(tool.name)) return "background";
    if (tool.name === "generate_image") return "image";
    if (isSimpleTool(tool.name)) return "simple";
    if (isNamedTool(tool.name)) return "named";
    return "generic";
  });
  return (
    <If when={kind() === "flow"} else={
      <If when={kind() === "task"} else={
        <If when={kind() === "wait"} else={
          <If when={kind() === "background"} else={
            <If when={kind() === "image"} else={
              <If when={kind() === "simple"} else={
                <If when={kind() === "named"} else={<GenericRenderer tool={props.tool} />}>
                  <NamedRenderer tool={props.tool} />
                </If>}>
                <SimpleToolRenderer tool={props.tool} />
              </If>}>
              <ImageRenderer tool={props.tool} />
            </If>}>
            <BackgroundRenderer tool={props.tool} />
          </If>}>
          <WaitRenderer tool={props.tool} />
        </If>}>
        <TaskRenderer tool={props.tool} />
      </If>}>
      <FlowReportRenderer tool={props.tool} />
    </If>
  );
}
export { ActivityRow, StateDot } from "./activity-row";
export { BackgroundMenu, FlowMenu, SubagentMenu } from "./flow-panel";
export { deriveFlow, deriveSubagents, flowWidgetEntries, hasFlow, latestFlowError, parseTaskLines, widgetLabel } from "./flow-state";
export type { FlowState, FlowTask, FlowWait, FlowBackground, FlowSubagent, TaskStatus } from "./flow-state";