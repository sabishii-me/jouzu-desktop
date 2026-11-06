import { View, Text, Scroll, signal } from "nsh";
import { ChatMarkdown } from "./chat-markdown";
import { Icon } from "./ui/icons";
import { cn } from "./lib";

/**
 * One turn status line above the composer. It only carries turn state
 * (reasoning / working / interrupted / failed); tools stay in the activity strip.
 */
export function AgentAction(props: {
  thinking: string;
  label: string;
  running: boolean;
  elapsed?: string;
  settled?: "interrupted" | "failed";
}) {
  const open = signal(false);
  const text = () => props.thinking.trim();
  const lastLine = () => text().split(/\r?\n/u).filter(line => line.trim()).at(-1) ?? "";
  return (
    <If when={!props.running && !text() && !!props.settled} else={
      <If when={props.running || !!text()}>
        <If when={!!text()} else={
          <View class="min-h-6 flex-row items-center gap-2 px-1 py-1">
            <Icon name="LoaderCircle" size={14} className="animate-spin" />
            <Text class="text-[11px] text-muted-foreground">{props.label}</Text>
            <If when={!!props.elapsed}>
              <Text class="text-[11px] tabular-nums text-muted-foreground">{props.elapsed ?? ""}</Text>
            </If>
          </View>
        }>
          <View class="flex-col px-1 pb-1">
            <View
              class="w-full min-w-0 flex-row items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/40"
              role="button"
              onPress={() => open.update(value => !value)}
            >
              <Icon name="Brain" size={14} />
              <Text class="shrink-0 text-[11px] font-medium text-foreground">Reasoning</Text>
              <Text class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{lastLine()}</Text>
              <Icon name="ChevronDown" size={14} className={open() ? "rotate-180" : undefined} />
            </View>
            <If when={open()}>
              <Scroll class="max-h-40 rounded-md border border-border bg-background px-3 py-2">
                <ChatMarkdown text={text()} streaming={props.running} />
              </Scroll>
            </If>
          </View>
        </If>
      </If>
    }>
      <View class={cn("min-h-6 flex-row items-center gap-2 px-1 py-1", props.settled === "failed" ? "text-destructive" : "text-muted-foreground")}>
        <Icon name={props.settled === "failed" ? "AlertTriangle" : "Square"} size={14} />
        <Text class="text-[11px] font-medium">{props.settled === "failed" ? "Failed" : "Interrupted"}</Text>
      </View>
    </If>
  );
}