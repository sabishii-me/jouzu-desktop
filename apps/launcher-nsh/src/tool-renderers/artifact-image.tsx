import { View, Text, signal, computed, Clipboard } from "nsh";
import type { JSX } from "nsh";
import { writeFile } from "fs/promises";
import { invoke } from "../host/invoke";
import { savePath } from "../host/dialog";
import { Button } from "../ui/button";
import { Icon } from "../ui/icons";
import { ImageViewer, type ViewerAction } from "../components/image-viewer";
import { MAX_TOOL_IMAGE_BYTES, MessageImage } from "../message-image";
import { quoteArtifact } from "../artifact-bus";

export interface ArtifactImageData {
  mime: string;
  data: string;
  alt: string;
  path?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

const SUPPORTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const action = "size-7 shrink-0 p-0";

/**
 * One image result: the picture, a dimensions line and the artifact actions.
 * Opening the picture uses the shared top-level ImageViewer, and the viewer's
 * toolbar is the same action list as the inline one.
 */
export function ArtifactImage(props: { image: ArtifactImageData; caption?: string; onUse?: (path: string) => void }) {
  const open = signal(false);
  const copied = signal(false);
  const src = computed(() => `data:${props.image.mime};base64,${props.image.data}`);
  const name = computed(() => props.image.path?.split(/[\\/]/u).pop() ?? "image.png");
  const bytes = computed(() => props.image.bytes ?? Math.floor(props.image.data.length * 0.75));
  const blocked = computed(() => bytes() > MAX_TOOL_IMAGE_BYTES || !SUPPORTED_MIME.includes(props.image.mime));

  async function download() {
    const image = props.image;
    const target = await savePath(name());
    if (!target) return;
    if (!image.path) {
      const data = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
      await writeFile(target, data);
      return;
    }
    // Pick a destination and copy the stored file, as the baseline did.
    await invoke("save_copy", { from: image.path, to: target });
  }
  // Never drop an oversized or unsupported block: the shared image card says
  // why it is not inline and keeps the path actions available.
  const actions = computed<(ViewerAction & { icon: JSX.Element })[]>(() => {
    const image = props.image;
    const list: (ViewerAction & { icon: JSX.Element })[] = [
      { id: "download", label: "Download", icon: <Icon name="Download" size={14} />, onSelect: () => { void download().catch(() => {}); } },
    ];
    if (image.path) {
      const path = image.path;
      list.push({
        id: "copy",
        label: copied() ? "Path copied" : "Copy path",
        icon: <Icon name={copied() ? "Check" : "Copy"} size={14} />,
        onSelect: () => { void Clipboard.writeText(path).then(() => { copied.set(true); setTimeout(() => copied.set(false), 1200); }).catch(() => copied.set(false)); },
      });
      list.push({ id: "reveal", label: "Show in folder", icon: <Icon name="FolderOpen" size={14} />, onSelect: () => { void invoke("reveal_path", { path }).catch(() => {}); } });
      list.push({
        id: "use",
        label: "Use as attachment",
        icon: <Icon name="Quote" size={14} />,
        onSelect: () => { if (props.onUse) props.onUse(path); else quoteArtifact(path); },
      });
    }
    return list;
  });
  const inline = computed<ViewerAction[]>(() => [
    { id: "open", label: "Open large image", icon: <Icon name="Maximize2" size={14} />, onSelect: () => open.set(true) },
    ...actions(),
  ]);

  return (
    <If when={blocked()} else={
      <View class="flex-col gap-1">
        <MessageImage kind="tool" source={src()} alt={props.image.alt} bytes={bytes()} showCaption={false} />
        <View class="flex-row flex-wrap items-center justify-between gap-2">
          <If when={!!props.caption}><Text class="text-[10px] text-muted-foreground">{props.caption}</Text></If>
          <View class="ml-auto flex-row flex-nowrap items-center justify-end gap-0.5">
            <Each of={inline()} key={item => item.id}>{item => <Button variant="ghost" className={action} title={item().label} aria-label={item().label} onClick={item().onSelect}>{item().icon}</Button>}</Each>
          </View>
        </View>
        <If when={open()}>
          <ImageViewer src={src()} alt={props.image.alt} title={props.image.path?.split(/[\\/]/u).pop() ?? "Image"} actions={actions()} onClose={() => open.set(false)} />
        </If>
      </View>
    }>
      <View class="flex-col gap-1">
        <MessageImage kind="tool" source={src()} alt={props.image.alt} bytes={bytes()} path={props.image.path} showCaption={false} />
        <If when={!!props.caption}><Text class="text-[10px] text-muted-foreground">{props.caption}</Text></If>
      </View>
    </If>
  );
}
