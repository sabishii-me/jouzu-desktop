import { View, Text, signal, effect, computed, token, Clipboard } from "nsh";
import { invoke } from "./host/invoke";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { Dialog } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { ChatMarkdown } from "./chat-markdown";

interface Preview {
  binary: boolean;
  truncated: boolean;
  bytes: number;
  text: string;
}

const MARKDOWN = /\.(?:md|mdx|markdown)$/iu;

function fileName(path: string) {
  return path.split(/[\\/]/u).pop() ?? path;
}

function formatBytes(bytes: number) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * One workspace file opened from the turn summary (0080). Text renders, Markdown
 * renders as Markdown, and anything unreadable offers the folder instead of a
 * broken view.
 */
export function FilePreview(props: { path: string; workspace?: string; onClose: () => void }) {
  const preview = signal<Preview | null>(null);
  const error = signal<string | null>(null);
  const revealError = signal<string | null>(null);
  const name = computed(() => fileName(props.path));
  const isMarkdown = computed(() => MARKDOWN.test(props.path));

  effect(() => {
    const path = props.path;
    const workspace = props.workspace;
    let alive = true;
    preview.set(null);
    error.set(null);
    if (!workspace) {
      error.set("The workspace folder is unavailable.");
      return () => { alive = false; };
    }
    void invoke<Preview>("workspace_read", { path, workspace })
      .then(value => { if (alive) preview.set(value); })
      .catch(failure => { if (alive) error.set(String(failure)); });
    return () => { alive = false; };
  });

  async function reveal() {
    try {
      await invoke("reveal_path", { path: props.path });
      revealError.set(null);
    } catch (failure) {
      revealError.set(String(failure));
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }} className="max-w-4xl gap-0 p-0">
    <View class="flex-row items-center justify-between gap-3 border-b border-border px-4 py-2">
      <View class="flex-row min-w-0 items-center gap-2">
        <Icon name="FileText" size={16} color={token("muted-foreground")} />
        <Text class="min-w-0 truncate text-sm font-semibold" tooltip={<Text>{props.path}</Text>}>{name()}</Text>
      </View>
      <View class="flex-row shrink-0 items-center gap-1">
        <Button variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => void reveal()}><Icon name="FolderOpen" size={12} /><Text class="text-xs">Reveal</Text></Button>
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => { void Clipboard.writeText(props.path).catch(() => {}); }}><Text class="text-xs">Copy path</Text></Button>
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => props.onClose()}><Text class="text-xs">Close</Text></Button>
      </View>
    </View>
    <Text class="truncate border-b border-border px-4 py-1 font-mono text-[10px] text-muted-foreground" tooltip={<Text>{props.path}</Text>}>{props.path}</Text>
    <If when={revealError()}><Text role="alert" class="border-b border-border px-4 py-1 text-xs text-destructive">{revealError()}</Text></If>
    <ScrollArea className="max-h-[480px] min-h-40 p-4">
      <If when={!preview() && !error()}><Text class="text-sm text-muted-foreground">Opening…</Text></If>
      <If when={error()}><Text role="alert" class="text-sm text-destructive">{error()}</Text></If>
      <If when={preview()?.binary}><Text class="text-sm text-muted-foreground">This file is not text. Use Reveal to open it in its own application.</Text></If>
      <If when={preview()?.truncated}><Text class="text-sm text-muted-foreground">This file is {formatBytes(preview()?.bytes ?? 0)}; too large to preview. Use Reveal to open it.</Text></If>
      <If when={preview() && !preview()!.binary && !preview()!.truncated}>
        <If when={isMarkdown()} else={<View selectable><Text class="whitespace-pre-wrap break-words font-mono text-xs leading-5">{preview()?.text}</Text></View>}>
          <ChatMarkdown text={preview()?.text ?? ""} />
        </If>
      </If>
    </ScrollArea>
  </Dialog>;
}