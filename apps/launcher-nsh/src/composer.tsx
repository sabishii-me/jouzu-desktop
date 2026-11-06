import { View, Text, Image, Scroll, signal, computed } from "nsh";
import { Input as BaseInput, Menu, MenuItem, Popover } from "nsh/base";
import { Picker } from "nsh";
import { MAX_IMAGES, type ImageAttachment } from "./chat-attachments";
import type { ChatModel } from "./chat-connection";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Icon } from "./ui/icons";
import { cn } from "./lib";

function providerLabel(provider: string) {
  if (!provider.startsWith("catalog:")) return provider;
  const id = provider.split(":")[2] ?? provider;
  return id.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

const MENU_POPUP = "rounded-xl border border-border bg-popover p-2 shadow-xl";
const MENU_ITEM = "flex-row items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent focus:bg-accent disabled:opacity-45";

function ModelMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: readonly ChatModel[];
  model?: string;
  onSelect: (provider: string, id: string) => void;
  thinkingLevel?: string;
  thinkingLevels: readonly string[];
  onThinking: (level: string) => void;
  onOpen?: () => void;
  onRetry?: () => void;
}) {
  const query = signal("");
  const visible = computed(() => props.models.filter(item => `${item.provider} ${item.name} ${item.id}`.toLowerCase().includes(query().toLowerCase())));
  const providers = computed(() => [...new Set(visible().map(item => item.provider))]);
  return (
    <Popover
      open={props.open}
      onOpenChange={event => {
        if (event.open) { query.set(""); props.onOpen?.(); }
        props.onOpenChange(event.open);
      }}
      placement="top"
      align="end"
      offset={8}
      popupClass={cn(MENU_POPUP, "w-80")}
      trigger={
        <View class="h-8 flex-row items-center gap-1 rounded-md px-2 hover:bg-muted" role="button" accessibilityLabel="Model">
          <Icon name="Cpu" size={16} />
          <Text class="max-w-40 truncate text-xs">{props.model ?? "Select model"}</Text>
          <Icon name="ChevronDown" size={12} />
        </View>
      }
    >
      <View class="flex-col">
        <Input autoFocus aria-label="Search models" placeholder="Search models" value={query()} onChange={event => query.set(event.target.value)} className="mb-2" />
        <Scroll class="max-h-72">
          <If when={props.models.length === 0}>
            <View class="flex-col gap-2 px-2 py-3">
              <Text class="text-sm text-muted-foreground">No models available. Configure a provider in Settings.</Text>
              <If when={!!props.onRetry}>
                <Button variant="outline" className="h-7 px-2" onClick={() => props.onRetry?.()}>
                  <Text class="text-xs">Retry models</Text>
                </Button>
              </If>
            </View>
          </If>
          <If when={props.models.length > 0 && visible().length === 0}>
            <Text class="px-2 py-3 text-sm text-muted-foreground">No matching models</Text>
          </If>
          <Each of={providers()} key={provider => provider}>
            {(provider) => (
              <View class="mb-2 flex-col">
                <Text class="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{providerLabel(provider())}</Text>
                <Each of={visible().filter(item => item.provider === provider())} key={item => `${item.provider}/${item.id}`}>
                  {(item) => (
                    <View
                      class="w-full flex-row items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                      role="menuitemradio"
                      onPress={() => { props.onSelect(item().provider, item().id); props.onOpenChange(false); }}
                    >
                      <Text class="min-w-0 flex-1 truncate text-sm">{item().name}</Text>
                      <If when={item().name === props.model}>
                        <Text class="text-xs text-primary">Current</Text>
                      </If>
                    </View>
                  )}
                </Each>
              </View>
            )}
          </Each>
        </Scroll>
        <If when={props.thinkingLevels.length > 1}>
          <View class="mt-2 flex-col border-t border-border pt-2">
            <Text class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Thinking</Text>
            <View class="flex-row flex-wrap gap-1 px-1">
              <Each of={props.thinkingLevels} key={level => level}>
                {(level) => (
                  <Button variant={level() === props.thinkingLevel ? "outline" : "ghost"} className="h-7 px-2" onClick={() => props.onThinking(level())}>
                    <Text class="text-xs">{level()}</Text>
                  </Button>
                )}
              </Each>
            </View>
          </View>
        </If>
      </View>
    </Popover>
  );
}

function AddMenu(props: {
  onAddImage?: () => void;
  onCompact?: () => void;
  onModel: () => void;
  onExport?: () => void;
  compactDisabled: boolean;
  exportDisabled: boolean;
}) {
  return (
    <Menu
      placement="top"
      popupClass={cn(MENU_POPUP, "w-72")}
      trigger={
        <View class="size-8 items-center justify-center rounded-md hover:bg-muted" role="button" accessibilityLabel="Add files or run commands">
          <Icon name="Plus" size={16} />
        </View>
      }
    >
      <Text class="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">Add</Text>
      <MenuItem class={MENU_ITEM} disabled={!props.onAddImage} onSelect={() => props.onAddImage?.()}>
        <Icon name="ImagePlus" size={16} />
        <View class="min-w-0 flex-col">
          <Text class="text-sm">Image</Text>
          <Text class="text-xs text-muted-foreground">Attach up to four images</Text>
        </View>
      </MenuItem>
      <Text class="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">Commands</Text>
      <MenuItem class={MENU_ITEM} disabled={props.compactDisabled || !props.onCompact} onSelect={() => props.onCompact?.()}>
        <Icon name="Minimize2" size={16} />
        <View class="min-w-0 flex-col">
          <Text class="text-sm">Compact</Text>
          <Text class="text-xs text-muted-foreground">Summarize earlier conversation</Text>
        </View>
      </MenuItem>
      <MenuItem class={MENU_ITEM} onSelect={() => props.onModel()}>
        <Icon name="Cpu" size={16} />
        <View class="min-w-0 flex-col">
          <Text class="text-sm">Model</Text>
          <Text class="text-xs text-muted-foreground">Choose this session's model</Text>
        </View>
      </MenuItem>
      <MenuItem class={MENU_ITEM} disabled={props.exportDisabled || !props.onExport} onSelect={() => props.onExport?.()}>
        <Icon name="Download" size={16} />
        <View class="min-w-0 flex-col">
          <Text class="text-sm">Export conversation</Text>
          <Text class="text-xs text-muted-foreground">Save the transcript as an HTML file</Text>
        </View>
      </MenuItem>
    </Menu>
  );
}

export interface ComposerProps {
  hero?: boolean;
  textguard?: { label: string; title: string; tone: "idle" | "blocked" | "expired"; disabled: boolean; blocked: boolean; mode: "on" | "strict" | "off"; onOpen: () => void; onMode: (mode: "on" | "strict" | "off") => void };
  connected: boolean;
  pending: boolean;
  opening?: boolean;
  unavailable?: boolean;
  running: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onCompact?: () => void;
  onExport?: () => void;
  compatibility?: readonly string[];
  attachments?: readonly ImageAttachment[];
  onAddImages?: (files: File[]) => void;
  onRemoveImage?: (id: string) => void;
  videos?: readonly string[];
  onAddVideo?: (url: string) => string | null;
  onRemoveVideo?: (url: string) => void;
  readingImages?: boolean;
  attachmentError?: string | null;
  models: readonly ChatModel[];
  model?: string;
  onSelectModel: (provider: string, id: string) => void;
  onRefreshModels?: () => void;
  onRetryModels?: () => void;
  thinkingLevel?: string;
  thinkingLevels: readonly string[];
  onThinkingLevel: (level: string) => void;
}

function TextGuardControl(props: { control: NonNullable<ComposerProps["textguard"]> }) {
  const tone = () => props.control.tone === "blocked" ? "text-destructive" : props.control.tone === "expired" ? "text-amber-600" : "text-muted-foreground";
  const modes = ["on", "strict", "off"] as const;
  return (
    <If when={props.control.blocked} else={
      <Menu
        placement="top"
        popupClass="w-48 rounded-lg border border-border bg-popover p-1 shadow-xl"
        trigger={
          <View class={cn("h-8 flex-row items-center gap-1.5 rounded-md px-2 hover:bg-muted", tone())} role="button" accessibilityLabel={`TextGuard: ${props.control.title}`}>
            <Icon name="ShieldAlert" size={16} />
            <Text class="text-xs">{props.control.label}</Text>
            <Icon name="ChevronDown" size={12} />
          </View>
        }
      >
        <Each of={[...modes]} key={mode => mode}>
          {(mode) => (
            <MenuItem class={MENU_ITEM} role="menuitemradio" checked={props.control.mode === mode()} indicator={<Icon name="Check" size={14} />} onSelect={() => props.control.onMode(mode())}>
              <Icon name="ShieldAlert" size={16} />
              <Text class="min-w-0 flex-1 truncate text-sm">{mode() === "on" ? "On" : mode() === "strict" ? "Strict" : "Off"}</Text>
            </MenuItem>
          )}
        </Each>
      </Menu>
    }>
      <Button variant="ghost" className={cn("h-8 gap-1.5 px-2", tone())} disabled={props.control.disabled} onClick={() => props.control.onOpen()} aria-label={`TextGuard: ${props.control.title}`}>
        <Icon name="ShieldAlert" size={16} />
        <Text class="text-xs">{props.control.label}</Text>
      </Button>
    </If>
  );
}

function AttachmentChip(props: { item: ImageAttachment; onRemove: () => void }) {
  return (
    <View class="max-w-36 flex-col rounded-lg border border-border p-1.5">
      <Image src={`data:${props.item.image.mimeType};base64,${props.item.image.data}`} style={{ width: 96, height: 64, objectFit: "contain" }} />
      <View class="flex-row items-center gap-1">
        <Text class="min-w-0 flex-1 truncate text-xs">{props.item.name}</Text>
        <Button variant="ghost" className="size-6 p-0" aria-label={`Remove ${props.item.name}`} onClick={props.onRemove}>
          <Icon name="X" size={12} />
        </Button>
      </View>
    </View>
  );
}
export function Composer(props: ComposerProps) {
  const videoOpen = signal(false);
  const videoDraft = signal("");
  const videoError = signal<string | null>(null);
  const modelOpen = signal(false);

  const submit = () => {
    if (props.connected && !props.pending && !props.opening && !props.unavailable && !props.readingImages && (props.draft.trim() || (props.videos?.length ?? 0) > 0)) props.onSend();
  };
  const compactDisabled = () => !props.connected || props.pending || !!props.opening || !!props.unavailable || props.running;
  const exportDisabled = () => !props.connected || props.pending || !!props.opening || !!props.unavailable;
  const addVideo = () => {
    const error = props.onAddVideo?.(videoDraft()) ?? null;
    videoError.set(error);
    if (!error) { videoDraft.set(""); videoOpen.set(false); }
  };
  const pickImages = async () => {
    if (!props.onAddImages) return;
    const picked = await Picker.pickImages({ multiple: true, limit: Math.max(1, MAX_IMAGES - (props.attachments?.length ?? 0)) });
    if (picked.length) props.onAddImages(picked.map(item => item.file));
  };

  return (
    <View class={props.hero ? "flex-col" : "flex-col px-3 pb-3 pt-2 sm:px-6"}>
      <If when={(props.compatibility?.length ?? 0) > 0}>
        <Text class="mx-auto mb-2 max-w-3xl text-xs text-muted-foreground">{`Some runtime events have no display: ${(props.compatibility ?? []).join(", ")}`}</Text>
      </If>
      <View
        class={cn("mx-auto w-full max-w-3xl flex-col gap-2 border border-border bg-card shadow-lg", props.hero ? "rounded-3xl p-3" : "rounded-2xl p-2.5")}
        accessibilityLabel="Message composer"
      >
        <If when={!!props.attachmentError}>
          <Text class="px-1 text-sm text-destructive">{props.attachmentError ?? ""}</Text>
        </If>
        <If when={(props.attachments?.length ?? 0) > 0}>
          <View class="flex-row flex-wrap gap-2 px-1" accessibilityLabel="Attached images">
            <Each of={props.attachments ?? []} key={item => item.id}>
              {(item) => <AttachmentChip item={item()} onRemove={() => props.onRemoveImage?.(item().id)} />}
            </Each>
          </View>
        </If>
        <If when={(props.videos?.length ?? 0) > 0}>
          <View class="flex-row flex-wrap gap-2 px-1" accessibilityLabel="Attached videos">
            <Each of={props.videos ?? []} key={url => url}>
              {(url) => (
                <View class="max-w-full flex-row items-center gap-1 rounded-lg border border-border px-2 py-1">
                  <Icon name="Video" size={14} />
                  <Text class="min-w-0 flex-1 truncate text-xs">{url()}</Text>
                  <Button variant="ghost" className="size-6 p-0" aria-label={`Remove video ${url()}`} onClick={() => props.onRemoveVideo?.(url())}>
                    <Icon name="X" size={12} />
                  </Button>
                </View>
              )}
            </Each>
          </View>
        </If>
        <If when={videoOpen()}>
          <View class="flex-row items-center gap-2 px-1">
            <Input aria-label="Video URL" placeholder="https://…/video.mp4" value={videoDraft()} onChange={event => videoDraft.set(event.target.value)} onSubmit={addVideo} />
            <Button onClick={addVideo}>Add</Button>
          </View>
        </If>
        <If when={!!videoError()}>
          <Text class="px-1 text-xs text-destructive">{videoError() ?? ""}</Text>
        </If>
        <BaseInput
          accessibilityLabel="Message Jouzu"
          placeholder="Message Jouzu…"
          value={props.draft}
          multiline
          submitBehavior="submit"
          class="max-h-60 min-h-16 w-full bg-transparent px-1 text-sm text-foreground outline-none"
          onChange={event => props.onDraft(event.value)}
          onSubmit={submit}
          onPaste={event => {
            if (!props.onAddImages || !event.files.length) return;
            props.onAddImages(event.files);
          }}
        />
        <View class="flex-row items-center justify-between gap-2">
          <View class="min-w-0 flex-row items-center gap-1">
            <If when={!!props.onAddVideo}>
              <Button variant="ghost" className="size-8 p-0" aria-label="Add video URL" onClick={() => videoOpen.update(value => !value)}>
                <Icon name="Video" size={16} />
              </Button>
            </If>
            <AddMenu
              onAddImage={props.onAddImages && !props.readingImages && (props.attachments?.length ?? 0) < MAX_IMAGES ? () => void pickImages() : undefined}
              onCompact={props.onCompact}
              onModel={() => modelOpen.set(true)}
              onExport={props.onExport}
              compactDisabled={compactDisabled()}
              exportDisabled={exportDisabled() || !!props.readingImages}
            />
            <If when={!!props.textguard}>
              {props.textguard ? <TextGuardControl control={props.textguard} /> : <View />}
            </If>
            <If when={!!props.readingImages}>
              <Text class="text-xs text-muted-foreground">Reading images…</Text>
            </If>
          </View>
          <View class="shrink-0 flex-row items-center gap-2">
            <Text class="hidden text-xs text-muted-foreground lg:inline">
              {!props.connected ? "Connecting…" : props.unavailable ? "Session unavailable" : props.opening ? "Opening session…" : props.pending ? "Sending…" : props.running ? "Enter to steer" : "Enter to send · Shift+Enter for newline"}
            </Text>
            <ModelMenu
              open={modelOpen()}
              onOpenChange={value => modelOpen.set(value)}
              models={props.models}
              model={props.model}
              onSelect={(provider, id) => props.onSelectModel(provider, id)}
              onOpen={props.onRefreshModels}
              onRetry={props.onRetryModels}
              thinkingLevel={props.thinkingLevel}
              thinkingLevels={props.thinkingLevels}
              onThinking={level => props.onThinkingLevel(level)}
            />
            <If when={props.running}>
              <Button variant="outline" className="h-8 px-2" onClick={() => props.onStop()}>
                <Icon name="Square" size={14} />
                <Text class="text-sm font-medium">Stop</Text>
              </Button>
            </If>
            <Button
              className="h-8 px-2"
              disabled={!props.connected || props.pending || !!props.opening || !!props.unavailable || !!props.readingImages || !props.draft.trim()}
              onClick={submit}
            >
              <Icon name="Send" size={14} />
              <Text class="text-sm font-medium">{props.running ? "Steer" : "Send"}</Text>
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}
