/**
 * The chat workspace's state and behavior, ported from the baseline
 * chat-workspace.tsx hooks. The view (chat-workspace.tsx) reads these signals;
 * every runtime interaction keeps the baseline's rules (the pool owns live
 * sessions, a click records intent, one switch path loads a session).
 */
import { signal, computed, effect, cleanup, windowSize } from "nsh";
import { Clipboard } from "nsh";
import { invoke } from "./host/invoke";
import { confirm, savePath } from "./host/dialog";
import { localStorage } from "./host/storage";
import { ChatConnection, flowNoticeText, type ChatSnapshot, type SessionTiming } from "./chat-connection";
import { chatPool } from "./chat-pool";
import { fitsSendBudget, readImageAttachment, removeSubmittedImages, validateImageSelection, type ImageAttachment } from "./chat-attachments";
import { normalizeVideoUrl, videoMarker } from "./video-url";
import { emptyProjection, historyProjection, interruptUnfinishedTools, type ChatProjection, type FlowReportRecord, type WireObject } from "./chat-projection";
import { clearDraft, draftKey, readDraft, writeDraft } from "./drafts";
import { humanizeRuntimeError, isCapacityError } from "./runtime-errors";
import { beginDialogResponse, emptyDialogQueue, enqueueDialog, expireDialogs, nextDialogDeadline, removeDialog, type DialogAnswer, type DialogQueue } from "./dialog-queue";
import { parseTextGuardNotice, parseTextGuardResult, type TextGuardData, type TextGuardItem } from "./textguard-bar";
import { onQuoteArtifact } from "./artifact-bus";

export type TextGuardView = { data: TextGuardData | null; seen: boolean; historical: boolean; open: boolean; busy: boolean; error: string | null; loading: boolean };
const emptyTextGuardView: TextGuardView = { data: null, seen: false, historical: false, open: false, busy: false, error: null, loading: false };

/** The side pane starts at half the window so chat and pane have equal room. */
export function defaultPaneWidth() {
  return Math.min(960, Math.max(480, Math.round(windowSize().width / 2)));
}

export interface WorkspaceItem { id: string; path: string }
export interface SessionSummary { path: string; title: string; workspace: string; updated: number; pinned: boolean; archived: boolean }
export interface ChatWorkspaceProps {
  path: string;
  revision?: number;
  locked?: boolean;
  newSession?: boolean;
  onStartSession?: () => void;
  onRetry?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onBootChange?: (booting: boolean) => void;
  catalogRefreshing?: boolean;
  canRefreshModels?: boolean;
  onModelsMissing?: () => void;
  onRetryModels?: () => void;
  workspaces: readonly WorkspaceItem[];
  onSelect: (path: string) => void;
  onAddFolder: () => void;
  onRemove: (id: string) => void;
  onSettings: () => void;
  onUpdate?: () => void;
  updateAvailable?: boolean;
  updateBusy?: boolean;
}
export const lastSegment = (path: string) => path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
export const workspaceLabel = (path: string) => lastSegment(path) === "default-workspace" ? "Default workspace" : lastSegment(path);
export const normalizedPath = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
/** The UUID at the end of a session file stem; a preview has no live session state. */
export const sessionIdFromFile = (path?: string): string | undefined => {
  const name = path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.replace(/\.jsonl$/u, "") ?? "";
  return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.exec(name)?.[1];
};
export function relativeTime(updated: number) {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - updated));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export interface Pane { tabs: string[]; active: string; width: number }

export function createChatWorkspace(props: ChatWorkspaceProps) {
  const snapshot = signal<ChatSnapshot>({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
  const workingStartedAt = signal<number | undefined>(undefined);
  const pendingUser = signal("");
  const now = signal(Date.now());
  const draft = signal("");
  const attachments = signal<ImageAttachment[]>([]);
  const attachmentError = signal<string | null>(null);
  const videoUrls = signal<string[]>([]);
  const readingImages = signal(false);
  const switching = signal(false);
  const commandBusy = signal(false);
  const selectedSession = signal<string | null>(null);
  const preview = signal<{ path: string; projection: ChatProjection } | null>(null);
  const dialogs = signal<DialogQueue>(emptyDialogQueue());
  const answer = signal("");
  const notification = signal("");
  const sessionError = signal<string | null>(null);
  const textguardBySession = signal<Record<string, TextGuardView>>({});
  const flowNotice = signal("");
  const dropActive = signal(false);
  const sidebar = signal(true);
  const hero = signal(props.newSession !== false);
  const poolStatusVersion = signal(0);
  const sessions = signal<SessionSummary[]>([]);
  const diskReports = signal<FlowReportRecord[]>([]);
  const reportsSession = signal("");
  const timing = signal<SessionTiming | undefined>(undefined);
  const collapsed = signal<Set<string>>(new Set());
  const searchOpen = signal(false);
  const search = signal("");
  const showArchived = signal(false);
  const sort = signal<"recent" | "name">("recent");
  const appView = signal<"chat" | "artifacts">("chat");
  const artifactCounts = signal<Record<string, number>>({});
  const panes = signal<Pane[]>([]);
  const textguardMode = signal<"on" | "strict" | "off">("on");
  /** The session a rename dialog is open for (the baseline used window.prompt). */
  const renameTarget = signal<SessionSummary | null>(null);
  const renameText = signal("");

  let connection: ChatConnection | null = null;
  let unsubscribe: (() => void) | null = null;
  let handleDialogRef: (request: WireObject, client: ChatConnection) => void = () => {};
  const dialogQueues = new Map<ChatConnection, DialogQueue>();
  let previousNewSession = props.newSession !== false;
  let freshOnPath = false;
  let queuedSwitch: string | "new" | null = null;
  let switchingBusy = false;
  let switchPromise: Promise<void> | null = null;
  let previewRequest = 0;
  const projectionCache = new Map<string, ChatProjection>();
  let draftKeyValue = "";
  let reading = false;

  const dialog = computed(() => dialogs().items[0] ?? null);
  const elapsed = computed(() => {
    const started = workingStartedAt();
    if (!started) return undefined;
    const delta = now() - started;
    return `${String(Math.floor(delta / 60000)).padStart(2, "0")}:${String(Math.floor((delta % 60000) / 1000)).padStart(2, "0")}`;
  });

  function writeDialogs(next: DialogQueue) { dialogs.set(next); }
  function updateDialogs(next: DialogQueue) {
    if (connection) dialogQueues.set(connection, next);
    writeDialogs(next);
  }
  function saveDraft(text: string, next: ImageAttachment[]) {
    if (draftKeyValue) writeDraft(draftKeyValue, { text, attachments: next });
  }
  function updateAttachments(next: ImageAttachment[]) {
    attachments.set(next);
    saveDraft(draft(), next);
  }
  function updateDraft(value: string) {
    draft.set(value);
    saveDraft(value, attachments());
  }
  function applyDraft(next: { text: string; attachments: ImageAttachment[] } | undefined) {
    draft.set(next?.text ?? "");
    attachments.set(next?.attachments ?? []);
    attachmentError.set(null);
  }
  function addVideoUrl(input: string): string | null {
    try {
      const url = normalizeVideoUrl(input);
      if (videoUrls().includes(url)) return "This video URL is already attached.";
      videoUrls.update(current => [...current, url]);
      return null;
    } catch (error) {
      return String(error instanceof Error ? error.message : error);
    }
  }
  function removeVideoUrl(url: string) {
    videoUrls.update(current => current.filter(value => value !== url));
  }
  function updateTextGuard(sessionId: string, change: Partial<TextGuardView>) {
    textguardBySession.update(current => ({ ...current, [sessionId]: { ...(current[sessionId] ?? emptyTextGuardView), ...change } }));
  }
  function bindClient(next: ChatConnection) {
    unsubscribe?.();
    connection = next;
    // A dialog belongs to the runtime that raised it: the view shows the queue of
    // the client it is bound to, and a background dialog waits here until then.
    const pending = expireDialogs(dialogQueues.get(next) ?? emptyDialogQueue(), Date.now());
    dialogQueues.set(next, pending);
    writeDialogs(pending);
    unsubscribe = next.subscribe(state => {
      snapshot.set(state);
      if (!state.connected && state.error) {
        dialogQueues.set(next, emptyDialogQueue());
        if (connection === next) writeDialogs(emptyDialogQueue());
      }
    });
  }
  // The pool list re-renders when any live session starts or stops a turn.
  cleanup(chatPool.subscribeStatus(() => poolStatusVersion.update(value => value + 1)));

  effect(() => {
    if (!snapshot().projection.running) return;
    const timer = setInterval(() => now.set(Date.now()), 1000);
    return () => clearInterval(timer);
  });
  effect(() => {
    const next = props.newSession !== false;
    if (next && !previousNewSession) void startNewSession();
    previousNewSession = next;
  });
  // A draft belongs to the workspace and the session (or its new-session slot).
  const activeDraftKey = computed(() => draftKey(props.path, hero() ? null : selectedSession() ?? snapshot().sessionFile ?? null));
  effect(() => {
    const key = activeDraftKey();
    if (draftKeyValue === key) return;
    draftKeyValue = key;
    applyDraft(readDraft(key));
  });

  // The one lease effect: a path/revision change binds a runtime from the pool.
  effect(() => {
    const path = props.path;
    void props.revision;
    const selected = selectedSession();
    const keepPreview = !!selected && !!preview() && normalizedPath(preview()!.path) === normalizedPath(selected);
    queuedSwitch = selected;
    switchingBusy = false;
    previewRequest += 1;
    if (!keepPreview) preview.set(null);
    sessionError.set(null);
    switching.set(false);
    if (selected) hero.set(false);
    writeDialogs(emptyDialogQueue());
    snapshot.set({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
    flowNotice.set("");
    let client: ChatConnection | undefined;
    let disposed = false;
    const handleDialog = (request: WireObject, owner: ChatConnection) => {
      if (["select", "confirm", "input", "editor"].includes(String(request.method))) {
        const pending = expireDialogs(dialogQueues.get(owner) ?? emptyDialogQueue(), Date.now());
        const result = enqueueDialog(pending, request, Date.now());
        dialogQueues.set(owner, result.queue);
        if (connection === owner) writeDialogs(result.queue);
        if (result.status === "full" && typeof request.id === "string") {
          notification.set("Too many extension requests to display. The additional request was cancelled.");
          void owner.reply(request.id, { cancelled: true }).catch(error => {
            if (connection === owner) notification.set(`The additional request could not be cancelled. ${String(error)}`);
          });
        }
        else if (result.status === "invalid") notification.set("An invalid extension request could not be displayed.");
      }
      else if (request.method === "notify") {
        const message = String(request.message ?? "");
        // The runtime already raises a plain-text alert as content is withheld.
        if (/^TextGuard (?:withheld|flagged)\b/u.test(message) || /^TextGuard: \d+ items? waiting for your review/u.test(message)) {
          const id = snapshot().sessionId ?? "";
          if (id) updateTextGuard(id, { seen: true, historical: false, error: null, loading: false });
          return;
        }
        const textguard = parseTextGuardNotice(message);
        if (textguard) {
          const id = textguard.sessionId ?? owner.snapshot.sessionId;
          if (id) {
            const view = textguardBySession()[id];
            if (!textguard.items.length && !view?.data && view?.historical) {
              updateTextGuard(id, { error: "This review is no longer available in the runtime.", loading: false, seen: true });
              return;
            }
            updateTextGuard(id, { data: textguard, seen: true, historical: false, error: null, loading: false });
          }
          return;
        }
        const textguardResult = parseTextGuardResult(message);
        if (textguardResult) {
          const id = owner.snapshot.sessionId;
          if (id) updateTextGuard(id, { error: textguardResult.ok ? null : textguardResult.error ?? "TextGuard request failed.", loading: false });
          return;
        }
        // A background session keeps working; its notices must not surface here.
        if (connection !== owner) return;
        const flow = flowNoticeText(message);
        if (flow) flowNotice.set(flow);
        else notification.set(message);
      }
      else if (request.method === "set_editor_text") {
        if (connection === owner) updateDraft(String(request.text ?? ""));
      }
    };
    void (async () => {
      try {
        const leased = await chatPool.lease(path, undefined, handleDialog, props.newSession !== false || freshOnPath);
        if (disposed) { void leased.close().catch(() => {}); return; }
        client = leased;
        handleDialogRef = handleDialog;
        bindClient(leased);
      } catch (error) {
        if (!disposed) snapshot.update(current => ({ ...current, error: String(error) }));
      }
    })();
    freshOnPath = false;
    return () => {
      disposed = true;
      unsubscribe?.();
      connection = null;
      if (client) dialogQueues.delete(client);
      // A session with a transcript is kept; a blank one is closed.
      if (client?.snapshot.error) void client.close().catch(() => {});
      else parkPrevious(client ?? null);
    };
  });

  effect(() => { props.onBusyChange?.(snapshot().pending || snapshot().projection.running); });
  effect(() => { props.onBootChange?.(!snapshot().connected); });
  effect(() => {
    const key = normalizedPath(snapshot().sessionFile ?? "");
    if (!key) return;
    projectionCache.set(key, snapshot().projection);
    while (projectionCache.size > 8) projectionCache.delete(projectionCache.keys().next().value as string);
  });
  effect(() => {
    const current = preview();
    if (!current || normalizedPath(current.path) !== normalizedPath(snapshot().sessionFile ?? "")) return;
    // Session state is published before history; never blank a visible transcript.
    if (!snapshot().projection.messages.length && current.projection.messages.length) return;
    preview.set({ path: current.path, projection: snapshot().projection });
  });
  effect(() => {
    const state = snapshot();
    if (state.connected && state.modelsLoaded === true && (state.models?.length ?? 0) === 0 && props.canRefreshModels) props.onModelsMissing?.();
  });
  effect(() => { answer.set(dialog()?.prefill ?? ""); });
  effect(() => {
    const deadline = nextDialogDeadline(dialogs());
    if (deadline === null) return;
    const timer = setTimeout(() => updateDialogs(expireDialogs(dialogs(), Date.now())), Math.min(2147483647, Math.max(0, deadline - Date.now())));
    return () => clearTimeout(timer);
  });
  effect(() => {
    if (!notification()) return;
    const timer = setTimeout(() => notification.set(""), 3000);
    return () => clearTimeout(timer);
  });

  async function refreshSessions() {
    try { sessions.set(await invoke<SessionSummary[]>("chat_sessions")); }
    catch { /* Session history is ancillary; chat remains usable. */ }
  }
  async function updateSession(sessionPath: string, change: { pinned?: boolean; archived?: boolean; title?: string }) {
    try { sessions.set(await invoke<SessionSummary[]>("chat_session_update", { sessionPath, ...change })); }
    catch (error) { notification.set(String(error)); }
  }
  function renameSession(session: SessionSummary) {
    renameTarget.set(session);
    renameText.set(session.title);
  }
  async function commitRename() {
    const target = renameTarget();
    if (!target) return;
    renameTarget.set(null);
    await updateSession(target.path, { title: renameText() });
  }
  async function copySessionId(session: SessionSummary) {
    const id = session.path.split(/[\/]/u).at(-1)?.replace(/\.jsonl$/u, "") ?? session.path;
    try {
      await Clipboard.writeText(id);
      notification.set("Session ID copied.");
    } catch (error) { notification.set(String(error)); }
  }
  effect(() => { void props.path; void props.revision; void refreshSessions(); });
  effect(() => {
    if (!snapshot().connected || snapshot().projection.messages.length === 0) return;
    const timer = setTimeout(() => { void refreshSessions(); }, 500);
    return () => clearTimeout(timer);
  });
  effect(() => { if (snapshot().connected) void refreshSessions(); });
  effect(() => {
    const state = snapshot();
    void state.sessionFile; void state.projection.messages.length; void state.projection.running;
    if (state.connected) void connection?.loadStats();
  });
  effect(() => {
    // Reports belong to the loaded session, not one still opening.
    const file = snapshot().sessionFile;
    void snapshot().projection.messages.length;
    if (!file) { diskReports.set([]); reportsSession.set(""); timing.set(undefined); return; }
    diskReports.set([]); reportsSession.set(file);
    let disposed = false;
    void invoke<FlowReportRecord[]>("chat_flow_reports", { sessionPath: file })
      .then(reports => { if (!disposed) diskReports.set(Array.isArray(reports) ? reports : []); })
      .catch(() => { if (!disposed) diskReports.set([]); });
    void invoke<SessionTiming>("chat_session_timing", { sessionPath: file })
      .then(value => { if (!disposed && value && typeof value.modelMs === "number") timing.set(value); })
      .catch(() => { if (!disposed) timing.set(undefined); });
    return () => { disposed = true; };
  });

  async function reply(fields: DialogAnswer) {
    const client = connection;
    const current = dialog();
    if (!current || !client || !snapshot().transportReady) return;
    const id = current.id;
    const claimed = beginDialogResponse(dialogs(), id, fields, Date.now());
    updateDialogs(claimed.queue);
    if (!claimed.response) return;
    try { await client.reply(id, claimed.response); }
    catch (error) { if (connection === client) notification.set(`The response could not be confirmed. ${String(error)}`); }
    finally { if (connection === client) updateDialogs(removeDialog(dialogs(), id)); }
  }

  async function addImages(files: File[]) {
    if (reading || !files.length) return;
    reading = true; readingImages.set(true); attachmentError.set(null);
    try {
      validateImageSelection(attachments(), files);
      const added = await Promise.all(files.map(readImageAttachment));
      validateImageSelection(attachments(), added.map(item => ({ size: item.size, type: item.image.mimeType })));
      if (!fitsSendBudget([...attachments(), ...added])) throw new Error("These images are too large to send together. Send fewer, or smaller ones.");
      updateAttachments([...attachments(), ...added]);
    } catch (error) { attachmentError.set(error instanceof Error ? error.message : String(error)); }
    finally { reading = false; readingImages.set(false); }
  }

  // "Quote" on an image artifact feeds the same attachment path as a paste.
  cleanup(onQuoteArtifact(path => {
    void (async () => {
      try {
        const data = await invoke<{ name: string; mimeType: string; data: string }>("read_dropped_image", { path });
        const binary = atob(data.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        await addImages([new File([bytes], data.name, { type: data.mimeType })]);
      } catch (error) { attachmentError.set(error instanceof Error ? error.message : String(error)); }
    })();
  }));

  async function addDropped(paths: string[]) {
    const images: File[] = [];
    const files: string[] = [];
    for (const path of paths) {
      if (!/\.(?:png|jpe?g|webp|gif)$/iu.test(path)) { files.push(path); continue; }
      try {
        const data = await invoke<{ name: string; mimeType: string; data: string }>("read_dropped_image", { path });
        const binary = atob(data.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        images.push(new File([bytes], data.name, { type: data.mimeType }));
      } catch (error) { attachmentError.set(error instanceof Error ? error.message : String(error)); }
    }
    if (images.length) await addImages(images);
    if (files.length) {
      const current = draft();
      updateDraft(`${current}${current.trim() ? "\n\n" : ""}${files.map(path => `File: ${path}`).join("\n")}`);
      notification.set(`${files.length} file${files.length === 1 ? "" : "s"} added to the message.`);
    }
  }

  async function send() {
    let client = connection;
    if (!client || reading) return;
    const typed = draft();
    const submittedVideos = videoUrls();
    const value = [...submittedVideos.map(videoMarker), typed].filter(Boolean).join("\n");
    const submitted = attachments();
    const wasHero = hero();
    workingStartedAt.set(Date.now());
    pendingUser.set(value);
    commandBusy.set(true);
    try {
      if (!await ensureSelectedSession(client)) { notification.set("The session is still opening."); return; }
      client = connection;
      if (!client) return;
      const running = client.snapshot.projection.running;
      await client.sendOrSteer(value, submitted.map(item => item.image), running);
      if (connection !== client) return;
      pendingUser.set("");
      if (videoUrls().join("\n") === submittedVideos.join("\n")) videoUrls.set([]);
      // Only a successful send clears the sent key; text typed during the send stays.
      if (draft() === value) {
        clearDraft(draftKeyValue);
        draft.set("");
      }
      else saveDraft(draft(), attachments());
      updateAttachments(removeSubmittedImages(attachments(), submitted));
      if (wasHero) { hero.set(false); props.onStartSession?.(); }
    } catch (error) {
      pendingUser.set("");
      const message = String(error).replace(/^Error:\s*/u, "");
      if (connection === client && /Flow attachment is closed|Flow session metadata is missing/u.test(message)) {
        try { if (await recoverSession()) return; } catch (recoveryError) { notification.set(String(recoveryError).replace(/^Error:\s*/u, "")); return; }
      }
      if (connection === client) notification.set(humanizeRuntimeError(message));
    } finally { commandBusy.set(false); }
  }

  function parkPrevious(previous: ChatConnection | null) {
    if (!previous || previous.isDisposed()) return;
    const sessionFile = previous.snapshot.sessionFile;
    // Only a session with a transcript is keyed by path; an unstored one is closed
    // unless it is still working.
    if (sessionFile && previous.snapshot.projection.messages.length) chatPool.remember(sessionFile, previous);
    else if (previous.snapshot.projection.running || previous.snapshot.pending) chatPool.remember(`unsaved:${crypto.randomUUID()}`, previous);
    else void previous.close().catch(() => {});
  }
  function queueNewSession() {
    queuedSwitch = "new";
    previewRequest += 1;
    preview.set(null);
    hero.set(true);
    selectedSession.set(null);
  }
  async function startNewSession() {
    if (props.locked) return;
    appView.set("chat");
    if (switchingBusy) { queueNewSession(); return; }
    if (!snapshot().connected) { queueNewSession(); return; }
    // A new session runs in the real workspace; the previous runtime stays pooled.
    const previous = connection;
    hero.set(true);
    selectedSession.set(null);
    previewRequest += 1;
    preview.set(null);
    switchingBusy = true;
    switching.set(true);
    sessionError.set(null);
    try {
      const next = await chatPool.lease(props.path, undefined, handleDialogRef, true);
      parkPrevious(previous);
      bindClient(next);
      updateDialogs(emptyDialogQueue());
      diskReports.set([]); reportsSession.set(""); timing.set(undefined);
      notification.set("");
      props.onStartSession?.();
      void refreshSessions();
    } catch (error) {
      // A failed cold start must not leave the hero over the bound session.
      const previousFile = previous?.snapshot.sessionFile ?? null;
      hero.set(!previousFile);
      selectedSession.set(previousFile);
      preview.set(null);
      notification.set(humanizeRuntimeError(String(error).replace(/^Error:\s*/u, "")));
    } finally {
      switchingBusy = false;
      switching.set(false);
    }
  }
  async function reloadSession() {
    const client = connection;
    if (!client || commandBusy()) return;
    commandBusy.set(true);
    try {
      if (!await ensureSelectedSession(client)) { notification.set("Could not attach this session for reloading."); return; }
      const active = connection;
      if (!active) return;
      await active.reloadSession();
      notification.set("Session reloaded.");
    } catch (error) { notification.set(String(error).replace(/^Error:\s*/u, "")); }
    finally { commandBusy.set(false); }
  }
  async function runExtensionCommand(command: string) {
    const client = connection;
    if (!client || commandBusy()) return;
    commandBusy.set(true);
    try {
      if (!await ensureSelectedSession(client)) { notification.set("Could not attach this session for the command."); return; }
      const active = connection;
      if (!active) return;
      await active.runCommand(command);
      if (command === "/flow clear") flowNotice.set("");
    }
    catch (error) { notification.set(String(error).replace(/^Error:\s*/u, "")); }
    finally { commandBusy.set(false); }
  }
  async function selectSessionModel(provider: string, id: string) {
    const client = connection;
    if (!client || commandBusy()) return;
    commandBusy.set(true);
    try {
      if (!await ensureSelectedSession(client)) { notification.set("Could not attach this session to change its model."); return; }
      const active = connection;
      if (!active) return;
      await active.selectModel(provider, id);
    }
    catch (error) { notification.set(String(error).replace(/^Error:\s*/u, "")); }
    finally { commandBusy.set(false); }
  }
  async function selectThinkingLevel(level: string) {
    const client = connection;
    if (!client || commandBusy()) return;
    commandBusy.set(true);
    try {
      if (!await ensureSelectedSession(client)) { notification.set("Could not attach this session to change its thinking level."); return; }
      const active = connection;
      if (!active) return;
      await active.setThinkingLevel(level);
    }
    finally { commandBusy.set(false); }
  }

  function inspectTextGuard(sessionId: string) {
    const client = connection;
    if (!client || !client.snapshot.connected || textguardBySession()[sessionId]?.loading) return;
    updateTextGuard(sessionId, { loading: true, error: null });
    void client.runCommand(`/textguard-desktop ${JSON.stringify({ action: "inspect" })}`)
      .catch(error => updateTextGuard(sessionId, { loading: false, error: String(error).replace(/^Error:\s*/u, "") }));
  }
  async function runTextGuard(action: "approve" | "dismiss" | "mode", item: TextGuardItem | null, extra: Record<string, unknown> = {}) {
    const client = connection;
    const sessionId = snapshot().sessionId ?? "";
    if (!client || !sessionId || textguardBySession()[sessionId]?.busy) return;
    updateTextGuard(sessionId, { busy: true, error: null });
    try {
      await client.runCommand(`/textguard-desktop ${JSON.stringify({ action, ...(item ? { id: item.id, ticket: item.ticket } : {}), ...extra })}`);
      if (action === "approve" || action === "dismiss") {
        const previous = textguardBySession()[sessionId]?.data;
        if (previous) updateTextGuard(sessionId, { data: { ...previous, items: [] }, error: null });
      }
      if (action !== "dismiss") await new Promise(resolve => setTimeout(resolve, 300));
      await client.runCommand(`/textguard-desktop ${JSON.stringify({ action: "inspect" })}`);
    } catch (error) {
      updateTextGuard(sessionId, { error: String(error).replace(/^Error:\s*/u, "") });
    } finally {
      updateTextGuard(sessionId, { busy: false, loading: false });
    }
  }
  async function recoverSession(sourcePath?: string): Promise<boolean> {
    const client = connection;
    const source = sourcePath ?? client?.snapshot.sessionFile;
    if (!client || !source) return false;
    const recovered = await invoke<string | null>("chat_session_recover", { sessionPath: source });
    if (!recovered || recovered === source) return false;
    selectedSession.set(recovered);
    await client.resumeSession(recovered);
    await client.loadModels();
    hero.set(false);
    void refreshSessions();
    notification.set("Recovered the session without the interrupted tool call.");
    return true;
  }
  /** The one place that changes which runtime session is loaded. */
  async function switchSession(target: string, recovered = false): Promise<void> {
    const client = connection;
    if (!client || switchingBusy) return;
    if (target !== "new" && normalizedPath(target) === normalizedPath(client.snapshot.sessionFile ?? "")) {
      selectedSession.set(target);
      hero.set(false);
      return;
    }
    switchingBusy = true;
    switching.set(true);
    sessionError.set(null);
    try {
      const previous = connection;
      const next = await chatPool.enter(props.path, target, handleDialogRef);
      if (connection !== previous) return;
      if (previous && previous !== next) parkPrevious(previous);
      if (connection !== next) bindClient(next);
      const loaded = next.snapshot.sessionFile ?? target;
      // A click that arrived while this switch ran owns the selection.
      if (!queuedSwitch && normalizedPath(loaded) !== normalizedPath(selectedSession() ?? "")) selectedSession.set(loaded);
      if (queuedSwitch && queuedSwitch !== "new" && normalizedPath(queuedSwitch) === normalizedPath(loaded)) queuedSwitch = null;
      if (queuedSwitch !== "new") hero.set(false);
      props.onStartSession?.();
      diskReports.set([]); reportsSession.set(loaded); timing.set(undefined);
      notification.set("");
      sessionError.set(null);
      const session = sessions().find(item => normalizedPath(item.path) === normalizedPath(loaded));
      if (session) localStorage.setItem("jouzu.chat.workspace", session.workspace);
      void refreshSessions();
    } catch (error) {
      if (connection !== client) return;
      const message = String(error).replace(/^Error:\s*/u, "");
      if (!recovered && /owned|busy|unavailable|exited|disposed/iu.test(message)) {
        await invoke("chat_stop_all").catch(() => {});
        chatPool.forget(target);
        switchingBusy = false;
        return switchSession(target, true);
      }
      const readable = preview() && normalizedPath(preview()!.path) === normalizedPath(target);
      if (readable) {
        // Never replace a readable transcript with a blank view.
        sessionError.set(message);
        notification.set("");
        return;
      }
      if (!queuedSwitch) {
        const active = client.snapshot.sessionFile ?? null;
        selectedSession.set(active);
        hero.set(!active);
      }
      previewRequest += 1;
      preview.set(null);
      notification.set(humanizeRuntimeError(message));
    } finally {
      switchingBusy = false;
      switching.set(false);
      props.onStartSession?.();
    }
  }
  function loadPreview(sessionPath: string) {
    const request = ++previewRequest;
    const cached = projectionCache.get(normalizedPath(sessionPath));
    if (cached) { preview.set({ path: sessionPath, projection: cached }); return; }
    void invoke<unknown[]>("chat_session_messages", { sessionPath, limit: 200 }).then(messages => {
      if (previewRequest !== request) return;
      if (normalizedPath(selectedSession() ?? "") !== normalizedPath(sessionPath)) return;
      try { preview.set({ path: sessionPath, projection: interruptUnfinishedTools(historyProjection(messages)) }); }
      catch { /* The runtime's authoritative history still loads below. */ }
    }).catch(() => { /* Opening still completes through the runtime. */ });
  }
  /** Start the runtime switch and expose the one promise a send can wait for. */
  function startSwitch(target: string) {
    if (switchingBusy) return;
    const promise = switchSession(target);
    switchPromise = promise;
    void promise.finally(() => { if (switchPromise === promise) switchPromise = null; });
  }
  async function ensureSelectedSession(client: ChatConnection): Promise<boolean> {
    const target = selectedSession();
    if (!target) return true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (normalizedPath(target) === normalizedPath(connection?.snapshot.sessionFile ?? "")) return true;
      if (!switchingBusy) startSwitch(target);
      const pending = switchPromise;
      if (!pending) break;
      await pending;
    }
    return normalizedPath(target) === normalizedPath(connection?.snapshot.sessionFile ?? "");
  }
  /** A click only records intent. The runtime load is the single path above. */
  function openSession(sessionPath: string) {
    appView.set("chat");
    const client = connection;
    if (!client) return;
    const active = normalizedPath(client.snapshot.sessionFile ?? "");
    if (!switchingBusy && normalizedPath(sessionPath) === active) {
      queuedSwitch = null;
      previewRequest += 1;
      preview.set(null);
      sessionError.set(null);
      selectedSession.set(sessionPath);
      hero.set(false);
      return;
    }
    // A session with a pooled runtime opens live: Stop keeps reaching its turn.
    const live = switchingBusy ? undefined : chatPool.client(sessionPath);
    if (live) {
      if (connection !== live) { parkPrevious(connection); bindClient(live); }
      queuedSwitch = null;
      previewRequest += 1;
      preview.set(null);
      sessionError.set(null);
      selectedSession.set(sessionPath);
      hero.set(false);
      diskReports.set([]); reportsSession.set(sessionPath); timing.set(undefined);
      props.onStartSession?.();
      void refreshSessions();
      return;
    }
    sessionError.set(null);
    selectedSession.set(sessionPath);
    hero.set(false);
    loadPreview(sessionPath);
  }

  async function forkTurn(prompt: string, messageIndex: number) {
    const client = connection;
    if (!client || !prompt.trim()) return;
    if (switchingBusy || snapshot().pending || !snapshot().connected) { notification.set("Wait for the session to finish loading."); return; }
    const target = selectedSession();
    const attach = !!target && normalizedPath(target) !== normalizedPath(client.snapshot.sessionFile ?? "");
    switchingBusy = true;
    switching.set(true);
    try {
      if (attach) {
        await client.resumeSession(target!);
        if (normalizedPath(target ?? "") !== normalizedPath(client.snapshot.sessionFile ?? "")) {
          notification.set("Could not attach this session for forking.");
          return;
        }
      }
      const source = client.snapshot.sessionFile;
      if (!source) throw new Error("This session has no file to branch yet.");
      const branch = await invoke<string>("chat_session_branch", { sessionPath: source, messageIndex });
      await client.resumeSession(branch);
      await refreshSessions();
      preview.set(null);
      selectedSession.set(branch);
      hero.set(false);
      notification.set("Branched into a new conversation.");
    } catch (error) { notification.set(String(error).replace(/^Error:\s*/u, "")); }
    finally { switchingBusy = false; switching.set(false); }
  }
  effect(() => {
    if (switching() || !snapshot().connected || snapshot().pending || !queuedSwitch) return;
    const target = queuedSwitch;
    queuedSwitch = null;
    if (target !== "new" && normalizedPath(target) === normalizedPath(connection?.snapshot.sessionFile ?? "")) {
      selectedSession.set(target);
      preview.set(null);
      return;
    }
    if (target === "new") void startNewSession();
    else startSwitch(target);
  });
  async function compactConversation() {
    const client = connection;
    if (!client || commandBusy()) return;
    commandBusy.set(true);
    const target = selectedSession() || undefined;
    try {
      // Compact attaches the target without loading its transcript.
      const pooled = target ? chatPool.client(target) : undefined;
      const active = pooled ?? client;
      if (active !== client) { parkPrevious(client); bindClient(active); }
      await active.compactSession(target);
      if (connection === active) notification.set("Earlier conversation compacted.");
    } catch (error) { notification.set(String(error).replace(/^Error:\s*/u, "")); }
    finally { commandBusy.set(false); }
  }
  async function exportConversation() {
    const client = connection;
    if (!client || !snapshot().connected || commandBusy()) return;
    const selected = await savePath(`${workspaceLabel(props.path)}-conversation.html`);
    if (typeof selected !== "string" || connection !== client) return;
    commandBusy.set(true);
    try {
      if (!await ensureSelectedSession(client)) { notification.set("Could not attach this session for export."); return; }
      const active = connection;
      if (!active) return;
      await active.exportHtml(selected);
      if (connection === active) notification.set(`Conversation exported to ${selected}`);
    } catch (error) { if (connection) notification.set(String(error)); }
    finally { commandBusy.set(false); }
  }
  async function switchWorkspace(next: string) {
    appView.set("chat");
    if (next === props.path) return;
    if (snapshot().projection.running && !await confirm("Stop the current run and switch workspace?", { title: "Switch workspace", kind: "warning" })) return;
    freshOnPath = true;
    selectedSession.set(null);
    hero.set(true);
    props.onStartSession?.();
    props.onSelect(next);
  }

  const groups = computed(() => {
    const map = new Map<string, { id: string; path: string; name: string; sessions: SessionSummary[] }>();
    for (const workspace of props.workspaces) map.set(normalizedPath(workspace.path), { id: workspace.id, path: workspace.path, name: workspaceLabel(workspace.path), sessions: [] });
    for (const session of sessions()) {
      if (session.archived && !showArchived()) continue;
      const key = normalizedPath(session.workspace);
      if (!map.has(key)) map.set(key, { id: key, path: session.workspace, name: workspaceLabel(session.workspace), sessions: [] });
      map.get(key)!.sessions.push(session);
    }
    let result = [...map.values()];
    if (search().trim()) {
      const query = search().trim().toLowerCase();
      result = result.flatMap(group => {
        if (group.name.toLowerCase().includes(query) || group.path.toLowerCase().includes(query)) return [group];
        const matches = group.sessions.filter(session => session.title.toLowerCase().includes(query));
        return matches.length ? [{ ...group, sessions: matches }] : [];
      });
    }
    if (sort() === "name") result.sort((left, right) => left.name.localeCompare(right.name));
    else result.sort((left, right) => (right.sessions[0]?.updated ?? 0) - (left.sessions[0]?.updated ?? 0));
    return result;
  });

  // Panes persist per session, as the baseline did.
  effect(() => {
    const sessionId = snapshot().sessionId;
    const key = sessionId ? `jouzu.ui.panes.${sessionId}` : "";
    try {
      const raw = key ? localStorage.getItem(key) : null;
      const saved = raw ? JSON.parse(raw) : null;
      const next = Array.isArray(saved?.panes)
        ? saved.panes
            .filter((pane: Pane) => pane && Array.isArray(pane.tabs) && pane.tabs.length && typeof pane.active === "string")
            .slice(0, 2)
            .map((pane: Pane) => {
              const width = typeof pane.width === "number" ? Math.min(960, Math.max(360, pane.width)) : defaultPaneWidth();
              return { tabs: pane.tabs.filter((tab: unknown) => typeof tab === "string"), active: pane.active, width: [360, 420, 560].includes(width) ? defaultPaneWidth() : width };
            })
        : [];
      panes.set(next);
    } catch { panes.set([]); }
  });
  effect(() => {
    const sessionId = snapshot().sessionId;
    if (!sessionId) return;
    try { localStorage.setItem(`jouzu.ui.panes.${sessionId}`, JSON.stringify({ panes: panes() })); } catch { /* storage-less hosts keep the session value */ }
  });
  effect(() => {
    void sessions(); void props.revision; void snapshot().projection.messages.length;
    let alive = true;
    void invoke<{ counts: Record<string, number> }>("artifact_counts")
      .then(value => { if (alive) artifactCounts.set(value.counts ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  });
  function artifactCount(sessionPath: string) {
    const file = sessionPath.split(/[\/]/u).at(-1)?.replace(/\.jsonl$/u, "") ?? "";
    const sessionId = file.includes("_") ? file.split("_").pop()! : file;
    return artifactCounts()[sessionId] ?? 0;
  }
  function toggleSide() {
    panes.update(current => current.length ? [] : [{ tabs: ["start"], active: "start", width: defaultPaneWidth() }]);
  }
  function addPane() {
    panes.update(current => current.length >= 2 ? current : [...current, { tabs: ["start"], active: "start", width: defaultPaneWidth() }]);
  }
  function removePane(index: number) {
    panes.update(current => current.filter((_, position) => position !== index));
  }
  function addPaneTab(index: number) {
    panes.update(current => current.map((pane, position) => position !== index ? pane : pane.tabs.includes("start") ? { ...pane, active: "start" } : { ...pane, tabs: [...pane.tabs, "start"], active: "start" }));
  }
  function closePaneTab(index: number, id: string) {
    panes.update(current => current.flatMap((pane, position) => {
      if (position !== index) return [pane];
      const tabs = pane.tabs.filter(tab => tab !== id);
      if (!tabs.length) return [];
      return [{ ...pane, tabs, active: pane.active === id ? tabs[tabs.length - 1] : pane.active }];
    }));
  }
  function openPaneView(index: number, id: string) {
    panes.update(current => current.map((pane, position) => {
      if (position !== index) return pane;
      if (pane.tabs.includes(id)) return { ...pane, tabs: pane.tabs.filter(tab => tab !== "start"), active: id };
      const tabs = [...pane.tabs];
      const start = tabs.indexOf("start");
      if (start >= 0) tabs[start] = id; else tabs.push(id);
      return { ...pane, tabs, active: id };
    }));
  }
  function setPaneActive(index: number, id: string) {
    panes.update(current => current.map((pane, position) => position === index ? { ...pane, active: id } : pane));
  }
  function setPaneWidth(index: number, width: number) {
    panes.update(current => current.map((pane, position) => position === index ? { ...pane, width: Math.min(960, Math.max(360, width)) } : pane));
  }
  function openArtifactsPanel() {
    panes.update(current => {
      if (!current.length) return [{ tabs: ["artifacts"], active: "artifacts", width: defaultPaneWidth() }];
      return current.map((pane, position) => position !== current.length - 1 ? pane : pane.tabs.includes("artifacts") ? { ...pane, tabs: pane.tabs.filter(tab => tab !== "start"), active: "artifacts" } : { ...pane, tabs: [...pane.tabs, "artifacts"], active: "artifacts" });
    });
  }

  // Derived view state (the baseline computed these in the render body).
  const activeSession = computed(() => normalizedPath(snapshot().sessionFile ?? ""));
  const selectedKey = computed(() => normalizedPath(selectedSession() ?? snapshot().sessionFile ?? ""));
  const selectedSessionWorkspace = computed(() => sessions().find(item => normalizedPath(item.path) === selectedKey())?.workspace ?? props.path);
  const selectedSessionWorkspacePath = computed(() => {
    const workspace = selectedSessionWorkspace();
    return workspace.startsWith("\\?\\") ? workspace.slice(4) : workspace;
  });
  // Stop belongs to the session on screen, never to a background turn.
  const composerRunning = computed(() => snapshot().projection.running && selectedKey() === activeSession());
  const activePreview = computed(() => {
    const current = preview();
    return current && normalizedPath(current.path) === selectedKey() ? current : null;
  });
  const artifactsSessionId = computed(() => activePreview() ? sessionIdFromFile(activePreview()!.path) : snapshot().sessionId);
  const opening = computed(() => !hero() && !!selectedSession() && selectedKey() !== activeSession() && !activePreview());
  const booting = computed(() => !snapshot().connected && !sessionError());
  const conversationProjection = computed(() => activePreview()?.projection ?? snapshot().projection);
  const conversationKey = computed(() => selectedSession() ?? snapshot().sessionId ?? props.path);
  const selectedTitle = computed(() => sessions().find(session => normalizedPath(session.path) === selectedKey())?.title);
  const hasArchived = computed(() => sessions().some(session => session.archived));
  const selectedWorkspace = computed(() => sessions().find(session => normalizedPath(session.path) === selectedKey())?.workspace);
  const capacityError = computed(() => isCapacityError(sessionError()) || isCapacityError(snapshot().error));
  const liveThinking = computed(() => {
    const projection = conversationProjection();
    const activeMessage = projection.activeMessage === null ? undefined : projection.messages[projection.activeMessage];
    const hasRunningTool = Object.values(projection.tools).some(tool => tool.phase === "running");
    return projection.running && activeMessage && !hasRunningTool
      ? activeMessage.content.flatMap(block => block.type === "thinking" ? [block.thinking ?? ""] : []).join("\n")
      : "";
  });
  const settled = computed(() => {
    const projection = conversationProjection();
    if (projection.running) return undefined;
    const last = projection.messages.at(-1);
    if (last?.role === "assistant" && last.stopReason === "error") return "failed" as const;
    if (last?.role === "toolResult" || (last?.role === "assistant" && (last.stopReason === "aborted" || last.stopReason === "toolUse"))) return "interrupted" as const;
    return undefined;
  });
  const textguardKey = computed(() => snapshot().sessionId && selectedKey() === activeSession() ? snapshot().sessionId! : "");
  const textguardView = computed(() => textguardKey() ? textguardBySession()[textguardKey()] : undefined);
  const textguardItems = computed(() => textguardView()?.data?.items.length ?? 0);
  const textguardExpired = computed(() => !!textguardView()?.historical && !!textguardView()?.error);
  const textguardBlocked = computed(() => !!textguardView()?.seen && !textguardExpired() && (textguardView()?.data ? textguardItems() > 0 : true));
  const textguardWithheld = computed(() => Object.values(snapshot().projection.tools).some(tool => {
    const result = JSON.stringify(tool.result ?? "");
    return result.includes("TextGuard withheld") || result.includes("TextGuard advisory");
  }));
  effect(() => {
    const id = snapshot().sessionId;
    if (!id || !textguardWithheld() || switching() || hero()) return;
    updateTextGuard(id, { seen: true, historical: !textguardBySession()[id]?.data });
  });
  // A review created by the running turn can only be inspected after it settles.
  effect(() => {
    const key = textguardKey();
    if (!key || snapshot().projection.running || !textguardView()?.open || textguardView()?.data) return;
    inspectTextGuard(key);
  });
  const textguardControl = computed(() => snapshot().sessionId ? {
    label: textguardBlocked() ? `${textguardItems() || 1} blocked` : "TextGuard",
    title: textguardBlocked() ? `${textguardItems() || 1} item(s) withheld from the model` : "TextGuard",
    tone: (textguardBlocked() ? "blocked" : textguardExpired() || textguardView()?.historical ? "expired" : "idle") as "blocked" | "expired" | "idle",
    disabled: !textguardKey(),
    blocked: false,
    mode: textguardMode(),
    onMode: (mode: "on" | "strict" | "off") => {
      textguardMode.set(mode);
      void runExtensionCommand(`/textguard ${mode}`);
    },
    onOpen: () => {},
  } : undefined);

  function abort() { void connection?.abort(); }
  function loadModels() { void connection?.loadModels(); }
  function isSessionRunning(sessionPath: string) { void poolStatusVersion(); return chatPool.isRunning(sessionPath); }
  function toggleCollapsed(id: string) {
    collapsed.update(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return {
    // state
    snapshot, pendingUser, elapsed, draft, attachments, attachmentError, videoUrls, readingImages,
    switching, commandBusy, selectedSession, preview, dialogs, dialog, answer, notification, sessionError,
    textguardBySession, flowNotice, dropActive, sidebar, hero, sessions, diskReports, reportsSession, timing,
    collapsed, searchOpen, search, showArchived, sort, appView, artifactCounts, panes, renameTarget, renameText,
    // derived
    groups, activeSession, selectedKey, selectedSessionWorkspacePath, composerRunning, activePreview,
    artifactsSessionId, opening, booting, conversationProjection, conversationKey, selectedTitle,
    hasArchived, selectedWorkspace, capacityError, liveThinking, settled, textguardKey, textguardView,
    textguardControl,
    // actions
    updateDraft, updateAttachments, addVideoUrl, removeVideoUrl, updateTextGuard, reply, addImages, addDropped,
    send, startNewSession, reloadSession, runExtensionCommand, selectSessionModel, selectThinkingLevel,
    runTextGuard, recoverSession, openSession, forkTurn, compactConversation, exportConversation,
    switchWorkspace, refreshSessions, updateSession, renameSession, commitRename, copySessionId,
    artifactCount, toggleSide, addPane, removePane, addPaneTab, closePaneTab, openPaneView, setPaneActive,
    setPaneWidth, openArtifactsPanel, abort, loadModels, isSessionRunning, toggleCollapsed,
  };
}

export type ChatWorkspaceStore = ReturnType<typeof createChatWorkspace>;
