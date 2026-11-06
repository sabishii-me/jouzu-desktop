import { View, Text, Image, signal, effect, computed, token, Clipboard, openUrl } from "nsh";
import { invoke } from "./host/invoke";
import { Button } from "./ui/button";
import { JouzuLoader } from "./ui/jouzu-loader";
import { Icon } from "./ui/icons";
import { useWorkspaceRoot } from "./workspace-context";

export const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024;
/** Tool blocks above the old inline cap become a card instead of vanishing. */
export const MAX_TOOL_IMAGE_BYTES = 8 * 1024 * 1024;
const CACHE_LIMIT = 32;
const SUPPORTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const CARD_ACTION = "h-7 gap-1 px-2 text-[11px]";

export interface MessageImageProps {
  kind: "markdown" | "tool" | "block";
  source?: string;
  alt?: string;
  workspace?: string;
  bytes?: number;
  path?: string;
  showCaption?: boolean;
}

export interface LocalImagePayload {
  mimeType: string;
  data: string;
  bytes: number;
  name: string;
}

export interface LocalImageError {
  reason?: string;
  message?: string;
  bytes?: number;
}

export type ImageCardReason =
  | "outside-workspace"
  | "not-found"
  | "too-large"
  | "not-an-image"
  | "unreadable"
  | "not-a-file"
  | "unsupported-mime"
  | "workspace-unavailable"
  | "no-source"
  | "invalid-source";

export type ImageSourceClassification =
  | { type: "inline"; src: string }
  | { type: "remote"; url: string; host: string; openable: boolean }
  | { type: "local"; path: string; name: string }
  | { type: "card"; reason: ImageCardReason; name: string; path?: string; bytes?: number; detail?: string };

const REASON_TEXT: Record<ImageCardReason, string> = {
  "outside-workspace": "Outside the workspace",
  "not-found": "File not found",
  "too-large": "Too large to show",
  "not-an-image": "Preview not supported",
  unreadable: "Unreadable",
  "not-a-file": "Not a file",
  "unsupported-mime": "Preview not supported",
  "workspace-unavailable": "Workspace unavailable",
  "no-source": "No image source",
  "invalid-source": "Image source is not valid",
};

export function imageReasonText(reason: ImageCardReason): string {
  return REASON_TEXT[reason];
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/gu, "/");
}

function fileNameOf(value: string): string {
  return normalizeSlashes(value).split("/").filter(Boolean).at(-1) ?? "image";
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\") || /^[A-Za-z]:\//u.test(value);
}

function isAbsoluteLocalPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

/** Lexically normalize `..` segments without touching the filesystem. */
export function normalizeLocalPath(value: string): string {
  const text = normalizeSlashes(value);
  const drive = /^[A-Za-z]:/u.exec(text)?.[0];
  const unc = !drive && text.startsWith("//");
  const absolute = !!drive || unc || text.startsWith("/");
  const rest = drive ? text.slice(2) : text;
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  // `drive` already carries its colon; the join adds the single separator.
  if (drive) return `${drive.toUpperCase()}/${parts.join("/")}`;
  if (unc) return `//${parts.join("/")}`;
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

export function isWithinWorkspace(workspace: string, candidate: string): boolean {
  const root = normalizeLocalPath(workspace);
  const path = normalizeLocalPath(candidate);
  const fold = isWindowsPath(workspace) || isWindowsPath(candidate);
  const left = fold ? root.toLowerCase() : root;
  const right = fold ? path.toLowerCase() : path;
  return right === left || right.startsWith(`${left}/`);
}

/**
 * Resolve a Markdown/HTML source against the workspace. Relative paths are
 * joined lexically first so `../../outside.png` is refused before any IPC call;
 * the native command still canonicalizes and re-checks.
 */
export function resolveWorkspacePath(workspace: string, source: string): { absolute: string; inside: boolean } {
  const root = normalizeLocalPath(workspace);
  const raw = normalizeSlashes(decodePath(source));
  if (isAbsoluteLocalPath(raw)) {
    const absolute = normalizeLocalPath(raw);
    return { absolute, inside: isWithinWorkspace(root, absolute) };
  }
  const absolute = normalizeLocalPath(`${root}/${raw}`);
  return { absolute, inside: isWithinWorkspace(root, absolute) };
}

interface DataUrlInfo {
  mime: string;
  base64: boolean;
  bytes: number;
}

function dataUrlInfo(source: string): DataUrlInfo | null {
  const match = /^data:([^;,]*)((?:;[^,]*)*),(.*)$/su.exec(source);
  if (!match) return null;
  const data = match[3] ?? "";
  return {
    mime: (match[1] || "text/plain").toLowerCase(),
    base64: /;base64/iu.test(match[2] ?? ""),
    bytes: Math.floor(data.length * 0.75),
  };
}

function imageLimit(kind: MessageImageProps["kind"]): number {
  return kind === "tool" ? MAX_TOOL_IMAGE_BYTES : MAX_LOCAL_IMAGE_BYTES;
}

/** The single decision point shared by Markdown, tool and message image blocks. */
export function classifyImageSource(
  source: string | undefined,
  options: { kind: MessageImageProps["kind"]; workspace?: string; bytes?: number; path?: string; alt?: string },
): ImageSourceClassification {
  const raw = (source ?? "").trim();
  const name = fileNameOf(options.path ?? "image");
  if (!raw) return { type: "card", reason: "no-source", name };
  if (raw.startsWith("data:")) {
    const info = dataUrlInfo(raw);
    if (!info || !info.base64) {
      return { type: "card", reason: "unsupported-mime", name, path: options.path, detail: info?.mime };
    }
    if (!(SUPPORTED_MIME as readonly string[]).includes(info.mime)) {
      return { type: "card", reason: "unsupported-mime", name, path: options.path, detail: info.mime };
    }
    const bytes = options.bytes ?? info.bytes;
    if (bytes > imageLimit(options.kind)) {
      return { type: "card", reason: "too-large", name, path: options.path, bytes };
    }
    return { type: "inline", src: raw };
  }
  if (/^https?:/iu.test(raw)) {
    try {
      const url = new URL(raw);
      return { type: "remote", url: url.href, host: url.host, openable: !url.username && !url.password };
    } catch {
      return { type: "card", reason: "invalid-source", name };
    }
  }
  if (/^(?:blob|asset):/iu.test(raw)) return { type: "inline", src: raw };
  const local = decodePath(raw);
  if (!options.workspace) {
    return { type: "card", reason: "workspace-unavailable", name: fileNameOf(local), path: local };
  }
  const resolution = resolveWorkspacePath(options.workspace, local);
  if (!resolution.inside) {
    return { type: "card", reason: "outside-workspace", name: fileNameOf(resolution.absolute), path: resolution.absolute };
  }
  return { type: "local", path: resolution.absolute, name: fileNameOf(resolution.absolute) };
}

export function imageCardReason(reason: string | undefined): ImageCardReason {
  return reason && reason in REASON_TEXT ? reason as ImageCardReason : "unreadable";
}

export function normalizeImageError(value: unknown): LocalImageError {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      reason: typeof record.reason === "string" ? record.reason : "unreadable",
      message: typeof record.message === "string" ? record.message : "The image could not be read.",
      bytes: typeof record.bytes === "number" ? record.bytes : undefined,
    };
  }
  if (typeof value === "string") return { reason: "unreadable", message: value };
  return { reason: "unreadable", message: "The image could not be read." };
}

const cache = new Map<string, LocalImagePayload>();
const inflight = new Map<string, Promise<LocalImagePayload>>();
let cachedWorkspace: string | undefined;

function cacheKey(workspace: string, path: string): string {
  return `${workspace}\u0000${path}`;
}

function syncCache(workspace: string): void {
  if (cachedWorkspace !== workspace) {
    cache.clear();
    inflight.clear();
    cachedWorkspace = workspace;
  }
}

function readCached(workspace: string, path: string): LocalImagePayload | undefined {
  syncCache(workspace);
  const key = cacheKey(workspace, path);
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function remember(workspace: string, path: string, payload: LocalImagePayload): void {
  syncCache(workspace);
  const key = cacheKey(workspace, path);
  cache.delete(key);
  cache.set(key, payload);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** One deduplicated native read per workspace+path, shared by every mount. */
export function requestLocalImage(workspace: string, path: string): Promise<LocalImagePayload> {
  syncCache(workspace);
  const key = cacheKey(workspace, path);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = invoke<LocalImagePayload>("read_local_image", { workspace, path }).then(payload => {
    remember(workspace, path, payload);
    inflight.delete(key);
    return payload;
  }, error => {
    inflight.delete(key);
    throw error;
  });
  inflight.set(key, request);
  return request;
}

/** The active workspace is part of the key, but a switch also drops the cache. */
export function clearImageCache(): void {
  cache.clear();
  inflight.clear();
  cachedWorkspace = undefined;
}

function RevealButton(props: { path: string }) {
  return <Button variant="ghost" className={CARD_ACTION} title="Show in folder" aria-label="Reveal" onClick={() => {
    void invoke("reveal_path", { path: props.path }).catch(() => {});
  }}><Icon name="FolderOpen" size={12} /><Text class="text-[11px]">Reveal</Text></Button>;
}

function CopyPathButton(props: { path: string }) {
  const copied = signal(false);
  return <Button variant="ghost" className={CARD_ACTION} onClick={() => {
    void Clipboard.writeText(props.path).then(() => {
      copied.set(true);
      setTimeout(() => copied.set(false), 1200);
    }).catch(() => copied.set(false));
  }}><Icon name={copied() ? "Check" : "Copy"} size={12} /><Text class="text-[11px]">{copied() ? "Copied" : "Copy path"}</Text></Button>;
}

/** Exported so the card states can be rendered directly in a static test. */
export function ImageFallbackCard(props: { reason: ImageCardReason; name: string; path?: string; bytes?: number; detail?: string }) {
  const label = imageReasonText(props.reason);
  const size = props.reason === "too-large" ? formatBytes(props.bytes ?? 0) : "";
  return <View role="group" accessibilityLabel={`${props.name}: ${label}`} class="my-2 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 text-left">
    <View class="flex-row items-start gap-2 px-3 py-2">
      <Icon name="ImageOff" size={14} className="mt-0.5" color={token("muted-foreground")} />
      <View class="min-w-0 flex-1 flex-col">
        <Text class="truncate text-xs font-medium" tooltip={<Text>{props.name}</Text>}>{props.name}</Text>
        <If when={!!props.path}><Text class="break-all font-mono text-[10px] text-muted-foreground">{props.path}</Text></If>
        <Text class="text-[11px] text-muted-foreground">{label}{size ? ` · ${size}` : ""}{props.detail ? ` · ${props.detail}` : ""}</Text>
      </View>
    </View>
    <If when={!!props.path}><View class="flex-row flex-wrap justify-end gap-1 border-t border-border/60 px-2 py-1">
      <RevealButton path={props.path!} />
      <CopyPathButton path={props.path!} />
    </View></If>
  </View>;
}

function RemoteImageCard(props: { url: string; host: string; alt: string; openable: boolean }) {
  return <View role="group" accessibilityLabel={`Remote image on ${props.host}`} class="my-2 flex-col overflow-hidden rounded-lg border border-border bg-muted/30 text-left">
    <View class="flex-row items-start gap-2 px-3 py-2">
      <Icon name="ImageOff" size={14} className="mt-0.5" color={token("muted-foreground")} />
      <View class="min-w-0 flex-1 flex-col">
        <Text class="truncate text-xs font-medium">{props.alt || props.host}</Text>
        <Text class="break-all text-[11px] text-muted-foreground">{props.host} · Remote image not loaded</Text>
      </View>
    </View>
    <If when={props.openable}><View class="flex-row justify-end border-t border-border/60 px-2 py-1">
      <Button variant="ghost" className={CARD_ACTION} onClick={() => { void invoke("open_external_url", { url: props.url }).catch(() => openUrl(props.url).catch(() => {})); }}><Icon name="ExternalLink" size={12} /><Text class="text-[11px]">Open</Text></Button>
    </View></If>
  </View>;
}

function InlineImage(props: { src: string; alt: string; caption: boolean }) {
  const broken = signal(false);
  return <If when={broken()} else={
    <View class="my-2 flex-col gap-1">
      <Image
        src={props.src}
        accessibilityLabel={props.alt || "Image"}
        class="max-h-80 max-w-full rounded-lg border border-border bg-background object-contain"
        onError={() => broken.set(true)}
      />
      <If when={props.caption && !!props.alt}><Text class="text-[11px] text-muted-foreground">{props.alt}</Text></If>
    </View>
  }>
    <ImageFallbackCard reason="unreadable" name={props.alt || "Image"} />
  </If>;
}

type LocalState = { status: "loading" } | { status: "ready"; payload: LocalImagePayload } | { status: "failed"; error: LocalImageError };

function readyState(state: LocalState): Extract<LocalState, { status: "ready" }> | null {
  return state.status === "ready" ? state : null;
}
function failedState(state: LocalState): Extract<LocalState, { status: "failed" }> | null {
  return state.status === "failed" ? state : null;
}

function LocalImage(props: { workspace: string; path: string; name: string; alt: string; caption: boolean }) {
  const state = signal<LocalState>({ status: "loading" });
  effect(() => {
    const workspace = props.workspace;
    const path = props.path;
    let cancelled = false;
    const cached = readCached(workspace, path);
    if (cached) {
      state.set({ status: "ready", payload: cached });
      return () => { cancelled = true; };
    }
    state.set({ status: "loading" });
    void requestLocalImage(workspace, path).then(payload => {
      if (!cancelled) state.set({ status: "ready", payload });
    }, (error: unknown) => {
      if (!cancelled) state.set({ status: "failed", error: normalizeImageError(error) });
    });
    return () => { cancelled = true; };
  });
  return <If when={readyState(state())} else={
    <If when={failedState(state())} else={
      <View role="status" class="my-2 flex-row items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <JouzuLoader small /><Text class="text-[11px] text-muted-foreground">Loading image…</Text>
      </View>
    }>{failed => <ImageFallbackCard reason={imageCardReason(failed().error.reason)} name={props.name} path={props.path} bytes={failed().error.bytes} detail={imageCardReason(failed().error.reason) === "not-an-image" ? failed().error.message : undefined} />}</If>
  }>{ready => <InlineImage src={`data:${ready().payload.mimeType};base64,${ready().payload.data}`} alt={props.alt} caption={props.caption} />}</If>;
}

function asInline(value: ImageSourceClassification): Extract<ImageSourceClassification, { type: "inline" }> | null {
  return value.type === "inline" ? value : null;
}
function asRemote(value: ImageSourceClassification): Extract<ImageSourceClassification, { type: "remote" }> | null {
  return value.type === "remote" ? value : null;
}
function asLocal(value: ImageSourceClassification): Extract<ImageSourceClassification, { type: "local" }> | null {
  return value.type === "local" ? value : null;
}
function asCard(value: ImageSourceClassification): Extract<ImageSourceClassification, { type: "card" }> | null {
  return value.type === "card" ? value : null;
}

/**
 * One image surface for the transcript. It either renders the picture with the
 * alt as caption, or explains why it cannot (inside/outside the workspace,
 * missing, unreadable, too large, unsupported, or remote and never fetched).
 */
export function MessageImage(props: MessageImageProps) {
  const root = computed(() => props.workspace ?? useWorkspaceRoot());
  const alt = computed(() => props.alt ?? "");
  const caption = computed(() => props.showCaption ?? props.kind === "markdown");
  const classification = computed(() => classifyImageSource(props.source, { kind: props.kind, workspace: root(), bytes: props.bytes, path: props.path }));
  return <If when={asInline(classification())} else={
    <If when={asRemote(classification())} else={
      <If when={asLocal(classification())} else={
        <If when={asCard(classification())}>{card => <ImageFallbackCard reason={card().reason} name={card().name} path={card().path} bytes={card().bytes} detail={card().detail} />}</If>
      }>{local => <LocalImage workspace={root() ?? ""} path={local().path} name={local().name} alt={alt()} caption={caption()} />}</If>
    }>{remote => <RemoteImageCard url={remote().url} host={remote().host} alt={alt()} openable={remote().openable} />}</If>
  }>{inline => <InlineImage src={inline().src} alt={alt()} caption={caption()} />}</If>;
}
