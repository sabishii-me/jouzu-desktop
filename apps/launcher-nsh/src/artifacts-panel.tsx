import { View, Text, Image, signal, effect, computed, token } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { invoke } from "./host/invoke";
import { confirm } from "./host/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { Dialog } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { ImageViewer } from "./components/image-viewer";
import { ChatMarkdown } from "./chat-markdown";
import type { OutputReference } from "./artifact-references";

interface ArtifactRecord {
  id: string;
  kind?: string;
  path?: string;
  originPath?: string;
  absolutePath?: string;
  prompt?: string;
  mimeType?: string;
  bytes?: number;
  createdAt?: string;
  dimensions?: { width?: number; height?: number };
  source?: { model?: string; provider?: string };
  /** A workspace original: visible in the panel, not frozen into the store. */
  reference?: boolean;
}

const isImage = (mime?: string) => !!mime && mime.startsWith("image/");
const isText = (mime?: string) => !!mime && (mime.startsWith("text/") || mime === "application/json" || mime.endsWith("+xml"));

const EXT_MIME: Record<string, [string, string]> = {
  png: ["image/png", "images"], jpg: ["image/jpeg", "images"], jpeg: ["image/jpeg", "images"],
  webp: ["image/webp", "images"], gif: ["image/gif", "images"],
  md: ["text/markdown", "documents"], mdx: ["text/markdown", "documents"], txt: ["text/plain", "documents"],
  json: ["application/json", "documents"], csv: ["text/csv", "documents"], pdf: ["application/pdf", "documents"],
  html: ["text/html", "documents"], htm: ["text/html", "documents"], xml: ["application/xml", "documents"],
};

function referenceRecord(reference: OutputReference): ArtifactRecord {
  const extension = reference.path.split(".").pop()?.toLowerCase() ?? "";
  const [mimeType, kind] = EXT_MIME[extension] ?? ["application/octet-stream", "data"];
  return { id: `reference:${reference.path}`, reference: true, kind, mimeType, path: reference.path, absolutePath: reference.path, prompt: reference.name };
}

const normalizePath = (path?: string) => (path ?? "").replaceAll("\\", "/").replace(/\/+/gu, "/").toLowerCase();

/** A stored file name, unless it is the digest-style name the store gives it. */
function displayName(item: ArtifactRecord): string {
  if (item.prompt?.trim()) return item.prompt.trim();
  const file = (item.absolutePath ?? item.path ?? "").split(/[\\/]/u).pop() ?? "";
  const stem = file.replace(/\.[^.]+$/u, "");
  if (stem && !/^[0-9a-f]{32,}$/iu.test(stem)) return file;
  return item.kind === "documents" ? "Text artifact" : `${item.kind ?? "Artifact"} ${item.id.slice(0, 8)}`;
}

function Thumb(props: { id: string; alt: string; onOpen: () => void }) {
  const src = signal<string | null>(null);
  effect(() => {
    const id = props.id;
    let alive = true;
    void invoke<{ mimeType: string; data: string }>("artifact_read", { id })
      .then(value => { if (alive) src.set(`data:${value.mimeType};base64,${value.data}`); })
      .catch(() => {});
    return () => { alive = false; };
  });
  return <BaseButton class="w-full overflow-hidden rounded-md border border-border bg-muted/40" style={{ aspectRatio: 1 }} accessibilityLabel={props.alt} onPress={() => props.onOpen()}>
    <If when={src()}>{value => <Image src={value()} accessibilityLabel={props.alt} class="size-full object-cover" />}</If>
  </BaseButton>;
}
/** Stored artifacts plus the turn's in-place outputs; Save freezes a copy. */
export function ArtifactsPanel(props: { sessionId?: string; references?: readonly OutputReference[]; workspace?: string; embedded?: boolean } = {}) {
  const items = signal<ArtifactRecord[] | null>(null);
  const error = signal<string | null>(null);
  const saving = signal<string | null>(null);
  const viewing = signal<{ src: string; title: string } | null>(null);
  const viewingText = signal<{ text: string; title: string; markdown: boolean } | null>(null);

  async function load() {
    try {
      const result = await invoke<{ artifacts: ArtifactRecord[] }>("artifact_list", props.sessionId ? { sessionId: props.sessionId } : {});
      items.set(result.artifacts ?? []);
      error.set(null);
    } catch (failure) {
      error.set(String(failure));
      items.set([]);
    }
  }

  effect(() => {
    const sessionId = props.sessionId;
    void sessionId;
    void load();
  });

  async function save(reference: OutputReference) {
    if (!props.workspace || saving()) return;
    saving.set(reference.path);
    try {
      await invoke("artifact_store_copy", { workspace: props.workspace, path: reference.path, ...(props.sessionId ? { sessionId: props.sessionId } : {}), prompt: reference.name });
      await load();
      error.set(null);
    } catch (failure) {
      error.set(String(failure));
    } finally {
      saving.set(null);
    }
  }

  const visible = computed(() => {
    const stored = items() ?? [];
    const storedOrigins = new Set(stored.map(item => normalizePath(item.originPath)).filter(Boolean));
    const referencesOnly = (props.references ?? []).filter(reference => !storedOrigins.has(normalizePath(reference.path))).map(referenceRecord);
    return [...stored, ...referencesOnly];
  });

  async function view(item: ArtifactRecord) {
    try {
      const result = await invoke<{ mimeType: string; data: string }>("artifact_read", { id: item.id });
      const title = displayName(item);
      if (isImage(item.mimeType ?? result.mimeType)) {
        viewing.set({ src: `data:${result.mimeType};base64,${result.data}`, title });
      } else if (isText(item.mimeType ?? result.mimeType)) {
        const bytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0));
        const mime = item.mimeType ?? result.mimeType;
        const markdown = mime === "text/markdown" || /\.mdx?$/iu.test(item.absolutePath ?? item.path ?? "");
        viewingText.set({ text: new TextDecoder().decode(bytes), title, markdown });
      } else if (item.absolutePath) {
        await invoke("reveal_path", { path: item.absolutePath });
      } else {
        error.set("This artifact has no preview.");
      }
    } catch (failure) {
      error.set(String(failure));
    }
  }

  async function remove(item: ArtifactRecord) {
    const okay = await confirm("Delete this artifact? The file is removed from disk.", { title: "Delete artifact", kind: "warning" });
    if (!okay) return;
    try {
      await invoke("artifact_delete", { id: item.id });
      await load();
    } catch (failure) {
      error.set(String(failure));
    }
  }

  function metaLabel(item: ArtifactRecord): string {
    if (item.reference) return "Not saved · workspace reference";
    return [item.source?.model, item.dimensions?.width && item.dimensions?.height ? `${item.dimensions.width}×${item.dimensions.height}` : "", item.createdAt ? new Date(item.createdAt).toLocaleString() : ""].filter(Boolean).join(" · ");
  }

  return <Card className={props.embedded ? "border-0 bg-transparent shadow-none" : "border-border shadow-none"}>
    <If when={!props.embedded}><CardHeader>
      <CardTitle>Artifacts</CardTitle>
      <CardDescription>{props.sessionId ? "AI outputs for this session. Save freezes a copy into the artifact store; unsaved items stay in the workspace." : "Saved artifacts, newest first."}</CardDescription>
    </CardHeader></If>
    <CardContent className={props.embedded ? "gap-4 p-0" : "gap-4"}>
      <If when={error()}><Text role="alert" class="text-xs text-destructive">{error()}</Text></If>
      <If when={!items() && !error()}><Text class="text-sm text-muted-foreground">Loading artifacts…</Text></If>
      <If when={!!items() && !visible().length}><Text class="text-sm text-muted-foreground">No AI outputs in this session yet.</Text></If>
      <If when={!!items() && visible().length > 0}>
        <Text class="text-xs text-muted-foreground">{visible().length} artifact{visible().length === 1 ? "" : "s"}</Text>
        <View class="flex-row flex-wrap gap-3">
          <Each of={visible()} key={item => item.id}>{item => <View class="w-[47%] grow flex-col gap-2">
            <If when={isImage(item().mimeType) && !item().reference} else={
              <BaseButton class="w-full items-center justify-center rounded-md border border-border bg-muted/40" style={{ aspectRatio: 1 }} accessibilityLabel={displayName(item())} onPress={() => { if (!item().reference) void view(item()); }}>
                <Icon name="FileText" size={28} color={token("muted-foreground")} />
              </BaseButton>
            }>
              <Thumb id={item().id} alt={displayName(item())} onOpen={() => void view(item())} />
            </If>
            <Text class="line-clamp-2 text-[11px] text-muted-foreground" tooltip={<Text>{displayName(item())}</Text>}>{displayName(item())}</Text>
            <Text class="truncate text-[10px] text-muted-foreground">{metaLabel(item())}</Text>
            <View class="flex-row flex-wrap gap-1">
              <If when={item().reference} else={
                <View class="flex-row flex-wrap gap-1">
                  <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void view(item())}><Icon name="Eye" size={12} /><Text class="text-[11px]">Open</Text></Button>
                  <If when={!!item().absolutePath}><Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => { void invoke("reveal_path", { path: item().absolutePath }).catch(() => {}); }}><Icon name="FolderOpen" size={12} /><Text class="text-[11px]">Reveal</Text></Button></If>
                  <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void remove(item())}><Icon name="Trash2" size={12} color={token("destructive")} /><Text class="text-[11px] text-destructive">Delete</Text></Button>
                </View>
              }>
                <If when={!!props.workspace}><Button variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={saving() === item().path} onClick={() => { const reference = (props.references ?? []).find(value => normalizePath(value.path) === normalizePath(item().path)); if (reference) void save(reference); }}><Icon name="FileText" size={12} /><Text class="text-[11px]">{saving() === item().path ? "Saving…" : "Save"}</Text></Button></If>
                <Button variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => { void invoke("reveal_path", { path: item().absolutePath }).catch(() => {}); }}><Icon name="FolderOpen" size={12} /><Text class="text-[11px]">Reveal</Text></Button>
              </If>
            </View>
          </View>}</Each>
        </View>
      </If>
    </CardContent>
    <If when={viewing()}>{value => <ImageViewer src={value().src} alt={value().title} title={value().title} onClose={() => viewing.set(null)} />}</If>
    <If when={viewingText()}>{value => <Dialog open onOpenChange={open => { if (!open) viewingText.set(null); }} className="max-w-3xl gap-0 p-0">
      <View class="flex-row items-center justify-between border-b border-border px-4 py-2">
        <Text class="min-w-0 truncate text-sm font-semibold">{value().title}</Text>
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => viewingText.set(null)}><Text class="text-xs">Close</Text></Button>
      </View>
      <ScrollArea className="max-h-[480px] min-h-40 p-4">
        <If when={value().markdown} else={<Text class="whitespace-pre-wrap break-words font-mono text-xs leading-5">{value().text}</Text>}>
          <ChatMarkdown text={value().text} />
        </If>
      </ScrollArea>
    </Dialog>}</If>
  </Card>;
}
