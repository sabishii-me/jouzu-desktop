import { View, Text, Overlay, signal, computed, token } from "nsh";
import type { ViewRef } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Icon } from "../ui/icons";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../lib";
import { ActivityRow } from "./activity-row";
import { FlowReportSummary } from "./flow-report";
import { backgroundStatusEntries, backgroundWidgetEntries, flowStatusEntries, flowWidgetEntries, subagentStatusEntries, subagentWidgetEntries, widgetLabel, type FlowBackground, type FlowState, type FlowSubagent, type FlowTask } from "./flow-state";
import type { FlowReportRecord } from "../chat-projection";

function TaskIcon(props: { status: FlowTask["status"] }) {
  return (
    <If when={props.status === "completed"} else={
      <If when={props.status === "in_progress"} else={
        <If when={props.status === "deleted"} else={<Icon name="Circle" size={14} className="mt-0.5" color={token("muted-foreground")} />}>
          <Icon name="CircleSlash" size={14} className="mt-0.5" color={token("muted-foreground")} />
        </If>}>
        <Icon name="LoaderCircle" size={14} className="mt-0.5 animate-spin" color={token("primary")} />
      </If>}>
      <Icon name="CheckCircle2" size={14} className="mt-0.5" color={token("primary")} />
    </If>
  );
}

export function SubagentMenu(props: { agents: readonly FlowSubagent[]; widgets?: Record<string, string[]>; statuses?: Record<string, string> }) {
  const open = signal(false);
  let trigger: ViewRef | undefined;
  const widgetEntries = computed(() => subagentWidgetEntries(props.widgets ?? {}));
  const statusEntries = computed(() => subagentStatusEntries(props.statuses ?? {}));
  const total = computed(() => props.agents.length + widgetEntries().length + statusEntries().length);
  const active = computed(() => props.agents.filter(agent => agent.state === "running").length);
  return <If when={total() > 0}>
    <View class="relative">
      <BaseButton ref={node => { trigger = node; }} onPress={() => open.update(value => !value)} accessibilityLabel={`Subagents (${total()})`} accessibilityState={{ expanded: open() }} class={cn("flex-row h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted/50", active() ? "border-primary/40 bg-primary/5" : "border-border")}>
        <If when={active() > 0} else={<Icon name="Bot" size={14} color={token("muted-foreground")} />}><Icon name="LoaderCircle" size={14} className="animate-spin" color={token("primary")} /></If>
        <Text class="whitespace-nowrap text-xs text-muted-foreground">{total()} subagent{total() === 1 ? "" : "s"}</Text>
        <View style={{ transform: [{ rotate: open() ? "180deg" : "0deg" }] }}><Icon name="ChevronDown" size={12} color={token("muted-foreground")} /></View>
      </BaseButton>
      <If when={open()}>
        <Overlay anchor={trigger ?? null} placement="bottom" align="end" offset={4} margin={8} onPressOutside={() => open.set(false)} onCancel={() => open.set(false)}>
          <View class="w-80 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl" role="dialog" accessibilityLabel="Subagents">
            <View class="border-b border-border px-3 py-2"><Text class="text-xs font-semibold">Subagents</Text></View>
            <ScrollArea className="max-h-96 px-3 py-2">
              <Each of={props.agents} key={agent => agent.id}>{agent => <ActivityRow title={agent().title} summary={agent().state === "running" ? "Running" : agent().state === "error" ? "Failed" : "Completed"} state={agent().state} />}</Each>
              <Each of={widgetEntries()} key={entry => entry[0]}>{entry => <View class="mb-2 flex-col">
                <Text class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{widgetLabel(entry()[0])}</Text>
                <View class="flex-col gap-0.5"><Each of={entry()[1].slice(0, 12)} key="index">{line => <Text class="truncate whitespace-pre text-[11px] text-muted-foreground">{line()}</Text>}</Each></View>
              </View>}</Each>
              <Each of={statusEntries()} key={entry => entry[0]}>{entry => <Text class="mb-1 text-[11px] text-muted-foreground">{entry()[1]}</Text>}</Each>
            </ScrollArea>
          </View>
        </Overlay>
      </If>
    </View>
  </If>;
}
export function BackgroundMenu(props: { jobs: readonly FlowBackground[]; widgets?: Record<string, string[]>; statuses?: Record<string, string> }) {
  const open = signal(false);
  let trigger: ViewRef | undefined;
  const widgetEntries = computed(() => backgroundWidgetEntries(props.widgets ?? {}));
  const statusEntries = computed(() => backgroundStatusEntries(props.statuses ?? {}));
  const total = computed(() => props.jobs.length + widgetEntries().length + statusEntries().length);
  const active = computed(() => props.jobs.filter(job => job.state === "running").length);
  return <If when={total() > 0}>
    <View class="relative">
      <BaseButton ref={node => { trigger = node; }} onPress={() => open.update(value => !value)} accessibilityLabel={`Background jobs (${total()})`} accessibilityState={{ expanded: open() }} class={cn("flex-row h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted/50", active() ? "border-primary/40 bg-primary/5" : "border-border")}>
        <If when={active() > 0} else={<Icon name="Terminal" size={14} color={token("muted-foreground")} />}><Icon name="LoaderCircle" size={14} className="animate-spin" color={token("primary")} /></If>
        <Text class="whitespace-nowrap text-xs text-muted-foreground">{total()} background job{total() === 1 ? "" : "s"}</Text>
        <View style={{ transform: [{ rotate: open() ? "180deg" : "0deg" }] }}><Icon name="ChevronDown" size={12} color={token("muted-foreground")} /></View>
      </BaseButton>
      <If when={open()}>
        <Overlay anchor={trigger ?? null} placement="bottom" align="end" offset={4} margin={8} onPressOutside={() => open.set(false)} onCancel={() => open.set(false)}>
          <View class="w-80 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl" role="dialog" accessibilityLabel="Background jobs">
            <View class="border-b border-border px-3 py-2"><Text class="text-xs font-semibold">Background jobs</Text></View>
            <ScrollArea className="max-h-96 px-3 py-2">
              <Each of={props.jobs} key="index">{job => <ActivityRow title="Background task" summary={job().command} state={job().state} />}</Each>
              <Each of={widgetEntries()} key={entry => entry[0]}>{entry => <View class="mb-2 flex-col">
                <Text class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{widgetLabel(entry()[0])}</Text>
                <View class="flex-col gap-0.5"><Each of={entry()[1].slice(0, 12)} key="index">{line => <Text class="truncate whitespace-pre text-[11px] text-muted-foreground">{line()}</Text>}</Each></View>
              </View>}</Each>
              <Each of={statusEntries()} key={entry => entry[0]}>{entry => <Text class="mb-1 text-[11px] text-muted-foreground">{entry()[1]}</Text>}</Each>
            </ScrollArea>
          </View>
        </Overlay>
      </If>
    </View>
  </If>;
}

const FLOW_COMMANDS: Array<[string, string]> = [["/flow", "Status"], ["/flow pause", "Pause"], ["/flow resume", "Resume"], ["/flow clear", "Clear"], ["/flow runtime", "Runtime"]];

/** Session status chip in the header. Its trigger is layout-stable; task/report
 * changes only affect the popover, never the conversation layout. */
export function FlowMenu(props: {
  flow: FlowState;
  widgets: Record<string, string[]>;
  statuses: Record<string, string>;
  reports?: readonly FlowReportRecord[];
  notice?: string;
  error?: string;
  onCommand?: (command: string) => void;
  busy?: boolean;
}) {
  const open = signal(false);
  const target = signal("");
  const page = signal("");
  const resetArmed = signal(false);
  let trigger: ViewRef | undefined;
  const tasks = computed(() => props.flow.tasks.filter(task => task.status !== "deleted"));
  const completed = computed(() => tasks().filter(task => task.status === "completed").length);
  const running = computed(() => tasks().filter(task => task.status === "in_progress").length);
  const pending = computed(() => tasks().filter(task => task.status === "pending").length);
  const waiting = computed(() => props.flow.waits.filter(wait => wait.state === "running").length);
  const summary = computed(() => {
    const active = tasks().find(task => task.status === "in_progress");
    return [
      active ? active.subject : tasks().length ? `${completed()}/${tasks().length} tasks` : "",
      running() ? `${running()} running` : "",
      pending() ? `${pending()} pending` : "",
      waiting() ? `${waiting()} waiting` : "",
    ].filter(Boolean).join(" · ") || "Session activity";
  });
  const live = computed(() => tasks().some(task => task.status !== "completed") || waiting() > 0);
  const reports = computed(() => (props.reports ?? []).filter((report, index, all) => all.findIndex(item => item.text === report.text) === index).slice(-3));
  const widgetEntries = computed(() => flowWidgetEntries(props.widgets));
  const statusEntries = computed(() => flowStatusEntries(props.statuses));
  const hasContent = computed(() => tasks().length > 0 || props.flow.waits.length > 0 || reports().length > 0 || !!props.notice || !!props.error || widgetEntries().length > 0 || statusEntries().length > 0);
  const send = (command: string) => { open.set(false); props.onCommand?.(command); };
  return <If when={hasContent()}>
    <View class="relative">
      <BaseButton ref={node => { trigger = node; }} onPress={() => open.update(value => !value)} accessibilityLabel="Flow" accessibilityState={{ expanded: open() }} class={cn("flex-row h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted/50", live() ? "border-primary/40 bg-primary/5" : "border-border")}>
        <If when={live()} else={<Icon name="ListTodo" size={14} color={token("muted-foreground")} />}><Icon name="LoaderCircle" size={14} className="animate-spin" color={token("primary")} /></If>
        <Text class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary()}</Text>
        <View style={{ transform: [{ rotate: open() ? "180deg" : "0deg" }] }}><Icon name="ChevronDown" size={12} color={token("muted-foreground")} /></View>
      </BaseButton>
      <If when={open()}>
        <Overlay anchor={trigger ?? null} placement="bottom" align="end" offset={4} margin={8} onPressOutside={() => open.set(false)} onCancel={() => open.set(false)}>
          <View class="w-80 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl" role="dialog" accessibilityLabel="Flow details">
            <View class="flex-row items-center gap-2 border-b border-border px-3 py-2">
              <Icon name="ListTodo" size={16} color={token("muted-foreground")} />
              <Text class="text-xs font-semibold">Tasks</Text>
              <If when={tasks().length > 0}><Text class="text-[11px] tabular-nums text-muted-foreground">{completed()}/{tasks().length}</Text></If>
              <Text class="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">{summary()}</Text>
            </View>
            <If when={!!props.notice}><View class="border-b border-border bg-amber-500/10 px-3 py-2" role="status"><Text class="text-[11px] text-amber-700 dark:text-amber-300">{props.notice}</Text></View></If>
            <If when={!!props.error}><View class="flex-col gap-1 border-b border-destructive/30 bg-destructive/10 px-3 py-2" role="alert">
              <Text class="text-[11px] font-medium text-destructive">Flow state needs recovery</Text>
              <Text class="break-words text-[11px] text-destructive">{props.error}</Text>
              <Text class="text-[11px] text-muted-foreground">Reset flow state after the current turn is idle.</Text>
            </View></If>
            <If when={!!props.onCommand}><View class="flex-col gap-2 border-b border-border px-2 py-2" accessibilityLabel="Flow commands">
              <View class="flex-row flex-wrap gap-1">
                <Each of={FLOW_COMMANDS} key={entry => entry[0]}>{entry => <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={props.busy} onClick={() => send(entry()[0])}><Text class="text-[10px]">{entry()[1]}</Text></Button>}</Each>
              </View>
              <View class="flex-row flex-wrap items-center gap-1">
                <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={props.busy} onClick={() => send("/flow off")}><Text class="text-[10px]">Off</Text></Button>
                <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={props.busy} onClick={() => send("/flow on")}><Text class="text-[10px]">On</Text></Button>
                <Input aria-label="Flow details page" placeholder="Page" value={page()} onChange={event => page.set(event.target.value.replace(/[^\d]/gu, ""))} className="h-6 w-14 rounded border border-border bg-background px-1 text-[10px]" />
                <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={props.busy} onClick={() => send(`/flow details${page() ? ` ${page()}` : ""}`)}><Text class="text-[10px]">Details</Text></Button>
              </View>
              <View class="flex-row flex-wrap items-center gap-1">
                <Input aria-label="Flow request or token" placeholder="Request / token" value={target()} onChange={event => target.set(event.target.value)} className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[10px]" />
                <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={props.busy || !target().trim()} onClick={() => send(`/flow retry ${target().trim()}`)}><Text class="text-[10px]">Retry</Text></Button>
                <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={props.busy || !target().trim()} onClick={() => send(`/flow cancel ${target().trim()}`)}><Text class="text-[10px]">Cancel</Text></Button>
              </View>
              <Button variant={resetArmed() ? "default" : "outline"} className="h-6 px-2 text-[10px]" disabled={props.busy} onClick={() => { if (!resetArmed()) { resetArmed.set(true); return; } resetArmed.set(false); send("/flow reset confirm"); }}><Text class="text-[10px]">{resetArmed() ? "Confirm reset" : "Reset…"}</Text></Button>
            </View></If>
            <ScrollArea className="max-h-96 px-3 py-2">
              <If when={tasks().length > 0}><View class="flex-col gap-1" accessibilityLabel="Session tasks">
                <Each of={tasks()} key={task => task.id}>{task => <View class="flex-row items-start gap-2 rounded-md px-1 py-1 text-xs">
                  <TaskIcon status={task().status} />
                  <View class="min-w-0 flex-1 flex-col">
                    <Text class={cn("break-words text-xs", task().status === "completed" && "text-muted-foreground line-through")}>{task().subject}</Text>
                    <Text class="text-[10px] text-muted-foreground">#{task().id}{task().status === "in_progress" ? " · in progress" : ""}{task().blockedBy.length ? ` · blocked by #${task().blockedBy.join(", #")}` : ""}</Text>
                  </View>
                </View>}</Each>
              </View></If>
              <Each of={props.flow.waits} key="index">{wait => <ActivityRow title="Waiting" summary={wait().reason} state={wait().state} defaultOpen={wait().handles.length > 0}>
                <If when={wait().handles.length > 0}><View class="flex-col gap-0.5">
                  <Each of={wait().handles} key={handle => handle}>{handle => <Text class="truncate font-mono text-[10px] text-muted-foreground">{handle()}</Text>}</Each>
                </View></If>
              </ActivityRow>}</Each>
              <Each of={reports()} key={report => `${report.timestamp ?? 0}-${report.kind}`}>{report => <FlowReportSummary text={report().text} />}</Each>
              <Each of={widgetEntries()} key={entry => entry[0]}>{entry => <View class="mb-2 flex-col">
                <Text class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{widgetLabel(entry()[0])}</Text>
                <View class="flex-col gap-0.5"><Each of={entry()[1].slice(0, 12)} key="index">{line => <Text class="truncate whitespace-pre text-[11px] text-muted-foreground">{line()}</Text>}</Each></View>
              </View>}</Each>
              <Each of={statusEntries()} key={entry => entry[0]}>{entry => <Text class="mb-1 text-[11px] text-muted-foreground">{entry()[1]}</Text>}</Each>
              <If when={!tasks().length && !props.flow.waits.length && !reports().length && !widgetEntries().length && !statusEntries().length}><Text class="py-2 text-xs text-muted-foreground">No flow activity in this session yet.</Text></If>
            </ScrollArea>
          </View>
        </Overlay>
      </If>
    </View>
  </If>;
}
