import { View, Text, Image, signal, token } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { ImageViewer } from "./components/image-viewer";
import { Button } from "./ui/button";
import { Icon } from "./ui/icons";
import { FilePreview } from "./file-preview";
import type { TurnArtifact, TurnSummaryData } from "./turn-summary";

/**
 * The turn-end summary: what the turn produced, so images and edited files are
 * visible without scrolling back through the transcript.
 */
export function TurnSummary(props: { data: TurnSummaryData; workspace?: string; onOpenArtifacts?: () => void }) {
  const open = signal<TurnArtifact | null>(null);
  const preview = signal<string | null>(null);
  return <If when={props.data.artifacts.length > 0 || props.data.files.length > 0}>
    <View role="region" accessibilityLabel="Turn summary" class="mt-3 flex-col rounded-xl border border-border bg-muted/30 p-3">
      <View class="flex-row flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <If when={props.data.artifacts.length > 0}><View class="flex-row items-center gap-1.5">
          <Icon name="Images" size={14} color={token("muted-foreground")} />
          <Text class="text-xs text-muted-foreground">{props.data.artifacts.length} image{props.data.artifacts.length === 1 ? "" : "s"}</Text>
        </View></If>
        <If when={props.data.files.length > 0}><View class="flex-row items-center gap-1.5">
          <Icon name="PencilLine" size={14} color={token("muted-foreground")} />
          <Text class="text-xs text-muted-foreground">{props.data.files.length} file{props.data.files.length === 1 ? "" : "s"} edited</Text>
        </View></If>
        <If when={props.data.artifacts.length > 0 && !!props.onOpenArtifacts}>
          <Button variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => props.onOpenArtifacts?.()}><Text class="text-[11px]">View in artifacts</Text></Button>
        </If>
      </View>
      <If when={props.data.artifacts.length > 0}><View class="mt-2 flex-row flex-wrap gap-2">
        <Each of={props.data.artifacts} key={artifact => artifact.id}>{artifact => <If when={artifact().data} else={
          <Text class="max-w-48 truncate rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">{artifact().path ?? "image"}</Text>
        }>
          <BaseButton class="overflow-hidden rounded-md border border-border" accessibilityLabel={artifact().prompt ?? "Generated image"} onPress={() => open.set(artifact())}>
            <Image src={`data:${artifact().mime};base64,${artifact().data}`} accessibilityLabel={artifact().prompt ?? "Generated image"} class="size-20 object-cover" />
          </BaseButton>
        </If>}</Each>
      </View></If>
      <If when={props.data.files.length > 0}><View class="mt-2 flex-row flex-wrap gap-1" accessibilityLabel="Edited files">
        <Each of={props.data.files} key={file => file}>{file => <Button variant="outline" className="h-6 max-w-64 gap-1 px-2 font-mono text-[10px]" title={file()} onClick={() => preview.set(file())}><Text class="truncate font-mono text-[10px]">{file().split(/[\\/]/u).pop() ?? file()}</Text></Button>}</Each>
      </View></If>
      <If when={open()}>{artifact => <ImageViewer src={`data:${artifact().mime};base64,${artifact().data}`} alt={artifact().prompt ?? ""} title={artifact().path?.split(/[\\/]/u).pop() ?? "Image"} onClose={() => open.set(null)} />}</If>
      <If when={preview()}>{path => <FilePreview path={path()} workspace={props.workspace} onClose={() => preview.set(null)} />}</If>
    </View>
  </If>;
}