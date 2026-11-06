import { Overlay, signal, Text, View, token } from "nsh";
import type { ViewRef } from "nsh";
import { invoke, errorText } from "./host/invoke";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";

interface McpServer {
  name: string;
  transport: string;
}
interface McpConfig {
  path: string;
  exists: boolean;
  servers: McpServer[];
}

/** Header status only: configured MCP servers and their transport. Editing is
 * intentionally left to the agent and the config file, not a desktop JSON editor.
 * The baseline's document pointerdown/keydown listeners become the Overlay's
 * onPressOutside/onCancel, which report the same two ways of closing. */
export function McpMenu(props: { onReload: () => void; onAsk?: () => void }) {
  const open = signal(false);
  const config = signal<McpConfig | null>(null);
  const loading = signal(false);
  const error = signal("");
  let trigger: ViewRef | null = null;

  async function load() {
    loading.set(true);
    error.set("");
    try { config.set(await invoke<McpConfig>("mcp_config")); }
    catch (failure) { error.set(errorText(failure)); }
    finally { loading.set(false); }
  }
  void load();

  const count = () => config()?.servers?.length ?? 0;
  const toggle = () => {
    const next = !open();
    open.set(next);
    if (next) void load();
  };

  return <If when={loading() || count() > 0}>
    <View class="relative">
      <View
        ref={node => { trigger = node; }}
        role="button"
        onPress={toggle}
        accessibilityLabel={`MCP servers (${count()})`}
        accessibilityState={{ expanded: open() }}
        class={`flex h-7 flex-row items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted/50 ${count() ? "border-primary/40 bg-primary/5" : "border-border"}`}
      >
        <Icon name="Plug" size={14} />
        <Text class="whitespace-nowrap text-xs text-muted-foreground">{count()} MCP</Text>
        <Icon name="ChevronDown" size={12} className={`transition-transform ${open() ? "rotate-180" : ""}`} />
      </View>
      <If when={open()}>
        <Overlay
          anchor={trigger}
          placement="bottom"
          align="end"
          offset={4}
          onPressOutside={() => open.set(false)}
          onCancel={() => open.set(false)}
        >
          <View role="group" accessibilityLabel="MCP servers" class="w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <View class="flex-row items-center gap-2 border-b border-border px-3 py-2">
              <Icon name="Plug" size={16} color={token("muted-foreground")} />
              <Text class="text-xs font-semibold">MCP servers</Text>
            </View>
            <If when={loading()}>
              <View class="flex-row items-center gap-2 px-3 py-3">
                <Icon name="LoaderCircle" size={14} className="animate-spin" />
                <Text class="text-xs text-muted-foreground">Loading…</Text>
              </View>
            </If>
            <If when={error()}>
              <Text role="alert" class="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">{error()}</Text>
            </If>
            <If when={!loading() && !error()}>
              <View class="max-h-[min(24rem,60vh)] flex-col overflow-y-auto px-3 py-2">
                <Each of={config()?.servers ?? []} key={server => server.name}>{server => (
                  <View class="flex-row items-center gap-2 border-b border-border py-1.5 last:border-0">
                    <Icon name="Circle" size={10} color={token("primary")} />
                    <Text class="min-w-0 flex-1 truncate text-xs">{server().name}</Text>
                    <Text class="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{server().transport}</Text>
                  </View>
                )}</Each>
              </View>
            </If>
            <View class="flex-row items-center justify-end gap-2 border-t border-border px-2 py-2">
              <If when={props.onAsk}>
                <Button variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => { open.set(false); props.onAsk?.(); }}>Ask Jouzu</Button>
              </If>
              <Button variant="outline" className="h-7 shrink-0 gap-1.5 px-2 text-[11px]" onClick={() => { open.set(false); props.onReload(); }}>
                <Icon name="RefreshCw" size={12} />
                <Text class="text-[11px] font-medium">Reload</Text>
              </Button>
            </View>
          </View>
        </Overlay>
      </If>
    </View>
  </If>;
}
