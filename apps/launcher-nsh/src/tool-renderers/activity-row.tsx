import type { JSX } from "nsh";
import { ToolFrame, type ToolState } from "./tool-frame";

export type ActivityState = ToolState;
export { StateDot } from "./tool-frame";

/** Compatibility wrapper: every renderer that used ActivityRow now shares the
 * same disclosure, status badge and header geometry as the rest of the chat. */
export function ActivityRow(props: {
  title: string;
  summary?: string | undefined;
  state: ActivityState;
  children?: JSX.Element;
  defaultOpen?: boolean;
}) {
  return <ToolFrame title={props.title} subtitle={props.summary} state={props.state} defaultOpen={props.defaultOpen ?? false}>
    {props.children}
  </ToolFrame>;
}