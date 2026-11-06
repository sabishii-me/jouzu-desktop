import { View, Text, signal, effect, token } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { invoke } from "./host/invoke";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { ScrollArea } from "./ui/scroll-area";

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

function parentOf(path: string) {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const at = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return at > 2 ? trimmed.slice(0, at) : trimmed;
}

/** Browse the session workspace from the pane. */
export function FilesPanel(props: { path: string }) {
  const current = signal(props.path);
  const entries = signal<Entry[] | null>(null);
  const error = signal<string | null>(null);

  async function load(target: string) {
    try {
      error.set(null);
      const result = await invoke<{ entries: Entry[] }>("workspace_list", { path: target });
      entries.set(result.entries ?? []);
      current.set(target);
    } catch (failure) {
      error.set(String(failure));
      entries.set([]);
    }
  }

  effect(() => {
    const path = props.path;
    current.set(path);
    void load(path);
  });

  return <View class="flex h-full flex-col">
    <View class="flex-row items-center gap-2 border-b border-border pb-2">
      <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label="Up one folder" title="Up one folder" onClick={() => { const parent = parentOf(current()); if (parent !== current()) void load(parent); }}><Icon name="ArrowUp" size={14} /></Button>
      <Text class="min-w-0 flex-1 truncate text-xs text-muted-foreground" tooltip={<Text>{current()}</Text>}>{current()}</Text>
      <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label="Refresh files" title="Refresh" onClick={() => void load(current())}><Icon name="RefreshCw" size={14} /></Button>
    </View>
    <If when={error()}><Text role="alert" class="p-2 text-xs text-destructive">{error()}</Text></If>
    <ScrollArea className="min-h-0 flex-1 py-1">
      <If when={entries()}>{list => <View class="flex-col">
        <Each of={list()} key={entry => entry.path}>{entry => <BaseButton
          class="flex-row w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
          onPress={() => { if (entry().isDir) void load(entry().path); else void invoke("reveal_path", { path: entry().path }).catch(() => {}); }}
        >
          <Icon name={entry().isDir ? "Folder" : "File"} size={16} color={token("muted-foreground")} />
          <Text class="min-w-0 flex-1 truncate text-sm">{entry().name}</Text>
          <If when={!entry().isDir}><Text class="shrink-0 text-[10px] text-muted-foreground">{Math.round(entry().size / 1024)} KB</Text></If>
        </BaseButton>}</Each>
        <If when={!list().length}><Text class="px-2 py-2 text-xs text-muted-foreground">This folder is empty.</Text></If>
      </View>}</If>
      <If when={!entries() && !error()}><Text class="px-2 py-2 text-xs text-muted-foreground">Loading…</Text></If>
    </ScrollArea>
  </View>;
}