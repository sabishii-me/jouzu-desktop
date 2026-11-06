import { View, Text, computed } from "nsh";
import { ActivityRow, type ActivityState } from "./activity-row";
import { record, toolText, type ToolRendererProps } from "./types";

export interface FlowResultRow { title: string; state: ActivityState; reference?: string; warnings: string[] }
export type FlowReport =
  | { kind: "result"; rows: FlowResultRow[]; omitted: number }
  | { kind: "work" | "alert"; title: string; state: ActivityState }
  | { kind: "wait"; state: ActivityState; reason?: string; observations: string[] };
export function flowReport(text: string): FlowReport | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const envelope = record(parsed);
  if (!envelope || typeof envelope.kind !== "string") return undefined;
  const content = record(envelope.content);
  if (envelope.kind === "result" && content && Array.isArray(content.sample)) {
    const rows = content.sample.flatMap(value => {
      const item = record(value);
      if (!item) return [];
      return [{
        title: typeof item.title === "string" ? item.title : "Result",
        state: (item.status === "success" ? "done" : item.status === "failure" ? "error" : "idle") as ActivityState,
        reference: typeof item.reference === "string" ? item.reference : undefined,
        warnings: Array.isArray(item.warnings) ? item.warnings.filter((warning): warning is string => typeof warning === "string") : [],
      }];
    });
    return { kind: "result" as const, rows, omitted: typeof content.omitted === "number" ? content.omitted : 0 };
  }
  if ((envelope.kind === "work" || envelope.kind === "alert") && typeof envelope.content === "string") {
    return { kind: envelope.kind, title: envelope.content, state: (envelope.kind === "alert" ? "warning" : "idle") as ActivityState };
  }
  const wait = record(content?.wait);
  if (envelope.kind === "wait" && wait) {
    return {
      kind: "wait" as const,
      state: (wait.state === "resolved" ? "done" : wait.state === "failed" ? "error" : "idle") as ActivityState,
      reason: typeof wait.reason === "string" ? wait.reason : undefined,
      observations: Array.isArray(wait.observations) ? wait.observations.flatMap(value => {
        const item = record(value);
        const text = [item?.handle, item?.state, item?.health].filter(value => typeof value === "string").join(" · ");
        return text ? [text] : [];
      }) : [],
    };
  }
  return undefined;
}
function asResult(report: FlowReport): Extract<FlowReport, { kind: "result" }> | null {
  return report.kind === "result" ? report : null;
}
function asWait(report: FlowReport): Extract<FlowReport, { kind: "wait" }> | null {
  return report.kind === "wait" ? report : null;
}
function workTitle(report: FlowReport): string {
  return report.kind === "work" || report.kind === "alert" ? report.title : "";
}

export function FlowReportSummary(props: { text: string }) {
  const report = computed(() => flowReport(props.text));
  return <If when={report()}>{r => (
    <If when={asResult(r())} else={
      <If when={asWait(r())} else={
        <ActivityRow title={r().kind === "alert" ? "Flow alert" : "Flow work"} summary={workTitle(r())} state={r().state} />
      }>{wait => <ActivityRow title="Waiting" summary={wait().reason} state={wait().state} defaultOpen={wait().observations.length > 0}>
        <View class="flex-col gap-1"><Each of={wait().observations} key="index">{observation => <Text class="truncate text-xs text-muted-foreground">{observation()}</Text>}</Each></View>
      </ActivityRow>}</If>
    }>{result => <View class="flex-col gap-1" role="region" accessibilityLabel="Flow results">
      <Each of={result().rows} key="index">{row => <ActivityRow title={row().title} state={row().state} defaultOpen={row().warnings.length > 0}>
        <If when={row().reference !== undefined}><Text class="text-xs text-muted-foreground">Log: {row().reference}</Text></If>
        <Each of={row().warnings} key="index">{warning => <Text class="text-xs text-destructive" role="alert">{warning()}</Text>}</Each>
      </ActivityRow>}</Each>
      <If when={result().omitted > 0}><Text class="px-1 text-[11px] text-muted-foreground">{result().omitted} more omitted</Text></If>
    </View>}</If>
  )}</If>;
}
export function FlowReportRenderer(props: ToolRendererProps) {
  return <FlowReportSummary text={toolText(props.tool.result)} />;
}
