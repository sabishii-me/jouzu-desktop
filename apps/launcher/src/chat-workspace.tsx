import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpCircle, ArrowUpDown, Archive, ArchiveRestore, ChevronDown, ChevronRight, Copy, FolderOpen, FolderPlus, GitFork, MessageSquare, MoreHorizontal, PanelLeft, Pencil, Pin, Plus, RefreshCw, Search, Settings, Sparkles, SquareTerminal, X } from "lucide-react";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { McpMenu } from "./mcp-menu";
import { ChatConversation } from "./chat-conversation";
import { Composer } from "./composer";
import { ChatConnection, flowNoticeText, type ChatSnapshot } from "./chat-connection";
import { readImageAttachment, removeSubmittedImages, validateImageSelection, type ImageAttachment } from "./chat-attachments";
import { emptyProjection, historyProjection, interruptUnfinishedTools, type ChatProjection, type FlowReportRecord } from "./chat-projection";
import { beginDialogResponse, emptyDialogQueue, enqueueDialog, expireDialogs, nextDialogDeadline, removeDialog, type DialogAnswer, type DialogQueue } from "./dialog-queue";
import { BackgroundMenu, deriveFlow, deriveSubagents, FlowMenu, latestFlowError, SubagentMenu } from "./tool-renderers";
import { SessionStatsBar } from "./session-stats-bar";
import { parseTextGuardNotice, parseTextGuardResult, TextGuardBar, type TextGuardData, type TextGuardItem } from "./textguard-bar";
import type { SessionTiming } from "./chat-connection";

type TextGuardView = { data: TextGuardData | null; seen: boolean; historical: boolean; open: boolean; busy: boolean; error: string | null; loading: boolean };
const emptyTextGuardView: TextGuardView = { data: null, seen: false, historical: false, open: false, busy: false, error: null, loading: false };

interface WorkspaceItem { id: string; path: string }
interface SessionSummary { path: string; title: string; workspace: string; updated: number; pinned: boolean; archived: boolean }
export interface ChatWorkspaceProps {
  path: string;
  revision?: number;
  newSession?: boolean;
  onStartSession?: () => void;
  onRetry?: () => void;
  onBusyChange?: (busy: boolean) => void;
  catalogRefreshing?: boolean;
  canRefreshModels?: boolean;
  onModelsMissing?: () => void;
  workspaces: readonly WorkspaceItem[];
  onSelect: (path: string) => void;
  onAddFolder: () => void;
  onRemove: (id: string) => void;
  onTerminal?: (path: string) => void;
  onSettings: () => void;
  onUpdate?: () => void;
  updateAvailable?: boolean;
  updateBusy?: boolean;
}
const lastSegment = (path: string) => path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
const workspaceLabel = (path: string) => lastSegment(path) === "default-workspace" ? "Default workspace" : lastSegment(path);
const normalizedPath = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
function relativeTime(updated: number) {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - updated));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function ChatWorkspace({ path, revision = 0, newSession = true, onStartSession, onRetry, onBusyChange, catalogRefreshing = false, canRefreshModels = false, onModelsMissing, workspaces, onSelect, onAddFolder, onRemove, onTerminal, onSettings, onUpdate, updateAvailable = false, updateBusy = false }: ChatWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const attachmentRef = useRef(attachments);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const readingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  const switchingRef = useRef(false);
  const switchingTarget = useRef<string | "new" | null>(null);
  const switchPromise = useRef<Promise<void> | null>(null);
  const [preview, setPreview] = useState<{ path: string; projection: ChatProjection } | null>(null);
  const previewRef = useRef<{ path: string; projection: ChatProjection } | null>(null);
  previewRef.current = preview;
  const previewRequest = useRef(0);
  const projectionCache = useRef(new Map<string, ChatProjection>());
  const selectedSessionRef = useRef<string | null>(null);
  selectedSessionRef.current = selectedSession;
  const [dialogs, setDialogs] = useState(emptyDialogQueue);
  const queue = useRef(dialogs);
  const dialog = dialogs.items[0] ?? null;
  const [answer, setAnswer] = useState("");
  const [notification, setNotification] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [textguardBySession, setTextguardBySession] = useState<Record<string, TextGuardView>>({});
  const textguardRef = useRef(textguardBySession);
  textguardRef.current = textguardBySession;
  const activeSessionIdRef = useRef("");
  activeSessionIdRef.current = snapshot.sessionId ?? "";
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(""), 3000);
    return () => clearTimeout(timer);
  }, [notification]);
  const [flowNotice, setFlowNotice] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const chatRoot = useRef<HTMLDivElement>(null);
  const [sidebar, setSidebar] = useState(true);
  const [hero, setHero] = useState(newSession);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [diskReports, setDiskReports] = useState<FlowReportRecord[]>([]);
  const [reportsSession, setReportsSession] = useState("");
  const [timing, setTiming] = useState<SessionTiming>();
  const [workingStartedAt, setWorkingStartedAt] = useState<number>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<string | null>(null);
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const connection = useRef<ChatConnection | null>(null);
  const previousNewSession = useRef(newSession);
  const newSessionOnStart = useRef(newSession);
  newSessionOnStart.current = newSession;
  const freshOnPath = useRef(false);
  const queuedSwitch = useRef<string | "new" | null>(null);
  function updateDialogs(next: DialogQueue) { queue.current = next; setDialogs(next); }
  function updateAttachments(next: ImageAttachment[]) { attachmentRef.current = next; setAttachments(next); }
  function updateTextGuard(sessionId: string, change: Partial<TextGuardView>) {
    setTextguardBySession(current => {
      const next = { ...current, [sessionId]: { ...(current[sessionId] ?? emptyTextGuardView), ...change } };
      textguardRef.current = next;
      return next;
    });
  }
  useEffect(() => {
    if (newSession && !previousNewSession.current) void startNewSession();
    previousNewSession.current = newSession;
  }, [newSession]);
  useEffect(() => {
    const selected = selectedSessionRef.current;
    const keepPreview = !!selected && !!previewRef.current && normalizedPath(previewRef.current.path) === normalizedPath(selected);
    queuedSwitch.current = selected;
    switchingRef.current = false;
    previewRequest.current += 1;
    if (!keepPreview) setPreview(null);
    setSessionError(null);
    setSwitching(false);
    if (selected) setHero(false);
    updateDialogs(emptyDialogQueue());
    setSnapshot({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
    setDraft(""); updateAttachments([]); setAttachmentError(null);
    setFlowNotice("");
    const client = new ChatConnection(state => {
      setSnapshot(state);
      if (!state.connected && state.error) updateDialogs(emptyDialogQueue());
    }, request => {
      if (["select", "confirm", "input", "editor"].includes(String(request.method))) {
        const result = enqueueDialog(queue.current, request, Date.now());
        updateDialogs(result.queue);
        if (result.status === "full" && typeof request.id === "string") {
          setNotification("Too many extension requests to display. The additional request was cancelled.");
          void client.reply(request.id, { cancelled: true }).catch(error => {
            if (connection.current === client) setNotification(`The additional request could not be cancelled. ${String(error)}`);
          });
        }
        else if (result.status === "invalid") setNotification("An invalid extension request could not be displayed.");
      }
      else if (request.method === "notify") {
        const message = String(request.message ?? "");
        const textguard = parseTextGuardNotice(message);
        if (textguard) {
          const id = textguard.sessionId ?? activeSessionIdRef.current;
          if (id && id === activeSessionIdRef.current) {
            const view = textguardRef.current[id];
            // A transcript-only event with no live review is historical: an empty
            // inspect must not turn it into a completed review.
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
          const id = activeSessionIdRef.current;
          if (id) updateTextGuard(id, { error: textguardResult.ok ? null : textguardResult.error ?? "TextGuard request failed.", loading: false });
          return;
        }
        const flow = flowNoticeText(message);
        if (flow) setFlowNotice(flow);
        else setNotification(message);
      }
      else if (request.method === "set_editor_text") setDraft(String(request.text ?? ""));
    });
    connection.current = client;
    void client.start(path, newSessionOnStart.current || freshOnPath.current);
    freshOnPath.current = false;
    return () => { connection.current = null; void client.close().catch(() => {}); };
  }, [path, revision]);
  useEffect(() => { onBusyChange?.(snapshot.pending || snapshot.projection.running || draft.trim().length > 0); }, [snapshot.pending, snapshot.projection.running, draft, onBusyChange]);
  useEffect(() => {
    const key = normalizedPath(snapshot.sessionFile ?? "");
    if (!key) return;
    projectionCache.current.set(key, snapshot.projection);
    while (projectionCache.current.size > 8) projectionCache.current.delete(projectionCache.current.keys().next().value as string);
  }, [snapshot.sessionFile, snapshot.projection]);
  useEffect(() => {
    const current = previewRef.current;
    if (!current || normalizedPath(current.path) !== normalizedPath(snapshot.sessionFile ?? "")) return;
    // Session state is published before history. Never replace a visible transcript with
    // that empty intermediate projection; wait for the authoritative messages.
    if (!snapshot.projection.messages.length && current.projection.messages.length) return;
    setPreview({ path: current.path, projection: snapshot.projection });
  }, [snapshot.sessionFile, snapshot.projection]);
  useEffect(() => {
    if (snapshot.connected && snapshot.modelsLoaded === true && (snapshot.models?.length ?? 0) === 0 && canRefreshModels) onModelsMissing?.();
  }, [snapshot.connected, snapshot.models, snapshot.modelsLoaded, canRefreshModels, onModelsMissing]);
  useEffect(() => { setAnswer(dialog?.prefill ?? ""); }, [dialog?.id, dialog?.prefill]);
  useEffect(() => {
    const deadline = nextDialogDeadline(dialogs);
    if (deadline === null) return;
    const timer = setTimeout(() => updateDialogs(expireDialogs(queue.current, Date.now())), Math.min(2147483647, Math.max(0, deadline - Date.now())));
    return () => clearTimeout(timer);
  }, [dialogs]);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => { if (!picker.current?.contains(event.target as Node)) setPickerOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [pickerOpen]);
  async function refreshSessions() {
    try { setSessions(await invoke<SessionSummary[]>("chat_sessions")); }
    catch { /* Session history is ancillary; chat remains usable. */ }
  }
  async function updateSession(sessionPath: string, change: { pinned?: boolean; archived?: boolean; title?: string }) {
    try { setSessions(await invoke<SessionSummary[]>("chat_session_update", { sessionPath, ...change })); }
    catch (error) { setNotification(String(error)); }
  }
  async function renameSession(session: SessionSummary) {
    const title = window.prompt("Rename session", session.title);
    if (title !== null) { await updateSession(session.path, { title }); setSessionMenu(null); }
  }
  async function copySessionId(session: SessionSummary) {
    const id = session.path.split(/[\\/]/u).at(-1)?.replace(/\.jsonl$/u, "") ?? session.path;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(id);
      else { const area = document.createElement("textarea"); area.value = id; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove(); }
      setNotification("Session ID copied.");
      setSessionMenu(null);
    } catch (error) { setNotification(String(error)); }
  }
  useEffect(() => {
    if (!sessionMenu) return;
    const close = (event: MouseEvent) => { if (!(event.target as Element).closest("[data-session-menu]")) setSessionMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSessionMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [sessionMenu]);
  useEffect(() => { void refreshSessions(); }, [path, revision]);
  useEffect(() => {
    if (!snapshot.connected || snapshot.projection.messages.length === 0) return;
    const timer = setTimeout(() => { void refreshSessions(); }, 500);
    return () => clearTimeout(timer);
  }, [snapshot.connected, snapshot.projection.messages.length]);
  useEffect(() => { if (snapshot.connected) void refreshSessions(); }, [snapshot.connected, snapshot.sessionFile]);
  useEffect(() => { if (snapshot.connected) void connection.current?.loadStats(); }, [snapshot.connected, snapshot.sessionFile, snapshot.projection.messages.length, snapshot.projection.running]);
  useEffect(() => {
    // Reports belong to the loaded session, not to a selected session that is still opening.
    const file = snapshot.sessionFile;
    if (!file) { setDiskReports([]); setReportsSession(""); setTiming(undefined); return; }
    setDiskReports([]); setReportsSession(file);
    let disposed = false;
    void invoke<FlowReportRecord[]>("chat_flow_reports", { sessionPath: file })
      .then(reports => { if (!disposed) setDiskReports(Array.isArray(reports) ? reports : []); })
      .catch(() => { if (!disposed) setDiskReports([]); });
    void invoke<SessionTiming>("chat_session_timing", { sessionPath: file })
      .then(value => { if (!disposed && value && typeof value.modelMs === "number") setTiming(value); })
      .catch(() => { if (!disposed) setTiming(undefined); });
    return () => { disposed = true; };
  }, [snapshot.sessionFile, snapshot.projection.messages.length]);
  async function reply(fields: DialogAnswer) {
    const client = connection.current;
    if (!dialog || !client || !snapshot.transportReady) return;
    const id = dialog.id;
    const claimed = beginDialogResponse(queue.current, id, fields, Date.now());
    updateDialogs(claimed.queue);
    if (!claimed.response) return;
    try { await client.reply(id, claimed.response); }
    catch (error) { if (connection.current === client) setNotification(`The response could not be confirmed. ${String(error)}`); }
    finally { if (connection.current === client) updateDialogs(removeDialog(queue.current, id)); }
  }
  async function addImages(files: File[]) {
    if (readingRef.current || !files.length) return;
    readingRef.current = true; setReadingImages(true); setAttachmentError(null);
    try {
      validateImageSelection(attachmentRef.current, files);
      const added = await Promise.all(files.map(readImageAttachment));
      validateImageSelection(attachmentRef.current, added.map(item => ({ size: item.size, type: item.image.mimeType })));
      updateAttachments([...attachmentRef.current, ...added]);
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
    finally { readingRef.current = false; setReadingImages(false); }
  }
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
      } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
    }
    if (images.length) await addImages(images);
    if (files.length) {
      setDraft(current => `${current}${current.trim() ? "\n\n" : ""}${files.map(path => `File: ${path}`).join("\n")}`);
      setNotification(`${files.length} file${files.length === 1 ? "" : "s"} added to the message.`);
    }
  }
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const subscription = getCurrentWindow().onDragDropEvent(event => {
      const payload = event.payload;
      if (payload.type === "leave") { setDropActive(false); return; }
      const rect = chatRoot.current?.getBoundingClientRect();
      const x = payload.position.x / window.devicePixelRatio;
      const y = payload.position.y / window.devicePixelRatio;
      const inside = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      setDropActive(inside && payload.type !== "drop");
      if (payload.type === "drop" && inside) void addDropped(payload.paths);
    });
    subscription.then(unlisten => { if (disposed) unlisten(); }).catch(error => setNotification(String(error)));
    return () => { disposed = true; subscription.then(unlisten => unlisten()).catch(() => {}); };
  }, [path, revision]);
  async function send() {
    const client = connection.current;
    if (!client || readingRef.current) return;
    const value = draft;
    const submitted = attachmentRef.current;
    const wasHero = hero;
    setWorkingStartedAt(Date.now());
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("The session is still opening."); return; }
      const running = client.snapshot.projection.running;
      await client.sendOrSteer(value, submitted.map(item => item.image), running);
      if (connection.current !== client) return;
      setDraft(current => current === value ? "" : current);
      updateAttachments(removeSubmittedImages(attachmentRef.current, submitted));
      if (wasHero) { setHero(false); onStartSession?.(); }
    } catch (error) {
      // Keep the draft and images available after rejection, but do not hide why it failed.
      const message = String(error).replace(/^Error:\s*/u, "");
      if (connection.current === client && /Flow attachment is closed|Flow session metadata is missing/u.test(message)) {
        try { if (await recoverSession()) return; } catch (recoveryError) { setNotification(String(recoveryError).replace(/^Error:\s*/u, "")); return; }
      }
      if (connection.current === client) setNotification(message);
    } finally { setCommandBusy(false); }
  }
  const name = workspaceLabel(path);
  async function startNewSession() {
    if (switchingRef.current) {
      queuedSwitch.current = "new";
      previewRequest.current += 1;
      setPreview(null);
      setHero(true);
      setSelectedSession(null);
      return;
    }
    if (snapshot.projection.running || snapshot.pending) {
      setNotification("Wait for the current turn to finish before starting a new session.");
      return;
    }
    if (!snapshot.connected) {
      queuedSwitch.current = "new";
      setHero(true);
      setSelectedSession(null);
      return;
    }
    setHero(true);
    setSelectedSession(null);
    previewRequest.current += 1;
    setPreview(null);
    startSwitch("new");
  }
  async function reloadSession() {
    const client = connection.current;
    if (!client || commandBusy) return;
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("Could not attach this session for reloading."); return; }
      await client.reloadSession();
      setNotification("Session reloaded.");
    } catch (error) { setNotification(String(error).replace(/^Error:\s*/u, "")); }
    finally { setCommandBusy(false); }
  }
  async function runExtensionCommand(command: string) {
    const client = connection.current;
    if (!client || commandBusy) return;
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("Could not attach this session for the command."); return; }
      await client.runCommand(command);
    }
    catch (error) { setNotification(String(error).replace(/^Error:\s*/u, "")); }
    finally { setCommandBusy(false); }
  }
  async function selectSessionModel(provider: string, id: string) {
    const client = connection.current;
    if (!client || commandBusy) return;
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("Could not attach this session to change its model."); return; }
      await client.selectModel(provider, id);
    }
    catch (error) { setNotification(String(error).replace(/^Error:\s*/u, "")); }
    finally { setCommandBusy(false); }
  }
  async function selectThinkingLevel(level: string) {
    const client = connection.current;
    if (!client || commandBusy) return;
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("Could not attach this session to change its thinking level."); return; }
      await client.setThinkingLevel(level);
    }
    finally { setCommandBusy(false); }
  }
  function inspectTextGuard(sessionId: string) {
    const client = connection.current;
    if (!client || !client.snapshot.connected || textguardRef.current[sessionId]?.loading) return;
    updateTextGuard(sessionId, { loading: true, error: null });
    void client.runCommand(`/textguard-desktop ${JSON.stringify({ action: "inspect" })}`)
      .catch(error => updateTextGuard(sessionId, { loading: false, error: String(error).replace(/^Error:\s*/u, "") }));
  }
  async function requestTextGuardReview() {
    const client = connection.current;
    if (!client) return;
    if (!await ensureSelectedSession(client)) return;
    const id = activeSessionIdRef.current;
    if (id) inspectTextGuard(id);
  }
  async function runTextGuard(action: "approve" | "dismiss" | "mode", item: TextGuardItem | null, extra: Record<string, unknown> = {}) {
    const client = connection.current;
    const sessionId = activeSessionIdRef.current;
    if (!client || !sessionId || textguardRef.current[sessionId]?.busy) return;
    updateTextGuard(sessionId, { busy: true, error: null });
    try {
      await client.runCommand(`/textguard-desktop ${JSON.stringify({ action, ...(item ? { id: item.id, ticket: item.ticket } : {}), ...extra })}`);
      if (action === "approve" || action === "dismiss") {
        const previous = textguardRef.current[sessionId]?.data;
        if (previous) updateTextGuard(sessionId, { data: { ...previous, items: [] }, error: null });
      }
      // Approve and mode replies are delivered before the runtime reloads resources.
      if (action !== "dismiss") await new Promise(resolve => setTimeout(resolve, 300));
      await client.runCommand(`/textguard-desktop ${JSON.stringify({ action: "inspect" })}`);
    } catch (error) {
      updateTextGuard(sessionId, { error: String(error).replace(/^Error:\s*/u, "") });
    } finally {
      updateTextGuard(sessionId, { busy: false, loading: false });
    }
  }
  async function recoverSession(sourcePath?: string): Promise<boolean> {
    const client = connection.current;
    const source = sourcePath ?? client?.snapshot.sessionFile;
    if (!client || !source) return false;
    const recovered = await invoke<string | null>("chat_session_recover", { sessionPath: source });
    if (!recovered || recovered === source) return false;
    setSelectedSession(recovered);
    await client.resumeSession(recovered);
    await client.loadModels();
    setHero(false);
    void refreshSessions();
    setNotification("Recovered the session without the interrupted tool call.");
    return true;
  }
  /** The one place that changes which runtime session is loaded. */
  async function switchSession(target: string | "new") {
    const client = connection.current;
    if (!client || switchingRef.current) return;
    if (target !== "new" && normalizedPath(target) === normalizedPath(client.snapshot.sessionFile ?? "")) {
      setSelectedSession(target);
      setHero(false);
      return;
    }
    switchingRef.current = true;
    switchingTarget.current = target;
    setSwitching(true);
    setSessionError(null);
    if (target === "new") {
      previewRequest.current += 1;
      setPreview(null);
      setHero(true);
      setSelectedSession(null);
    }
    try {
      if (target === "new") {
        await client.newSession();
        if (connection.current !== client) return;
        onStartSession?.();
        setDiskReports([]); setReportsSession(""); setTiming(undefined);
        void refreshSessions();
        return;
      }
      await client.resumeSession(target);
      if (connection.current !== client) return;
      const loaded = client.snapshot.sessionFile ?? target;
      // A click that arrived while this switch was running owns the selection.
      if (!queuedSwitch.current && normalizedPath(loaded) !== normalizedPath(selectedSessionRef.current ?? "")) setSelectedSession(loaded);
      // The same row was clicked again while loading: that is already this load.
      if (queuedSwitch.current && normalizedPath(queuedSwitch.current) === normalizedPath(loaded)) queuedSwitch.current = null;
      if (queuedSwitch.current !== "new") setHero(false);
      onStartSession?.();
      setDiskReports([]); setReportsSession(loaded); setTiming(undefined);
      setNotification("");
      setSessionError(null);
      const session = sessions.find(item => normalizedPath(item.path) === normalizedPath(loaded));
      if (session) localStorage.setItem("jouzu.chat.workspace", session.workspace);
      void refreshSessions();
    } catch (error) {
      if (connection.current !== client) return;
      const message = String(error).replace(/^Error:\s*/u, "");
      const readable = previewRef.current && normalizedPath(previewRef.current.path) === normalizedPath(target);
      if (readable) {
        // The transcript is already on screen. Never replace a readable session with a blank
        // view because its runtime attachment failed.
        setSessionError(message);
        setNotification("");
        return;
      }
      if (!queuedSwitch.current) {
        const active = client.snapshot.sessionFile ?? null;
        setSelectedSession(active);
        setHero(!active);
      }
      previewRequest.current += 1;
      setPreview(null);
      setNotification(message);
    } finally {
      switchingRef.current = false;
      switchingTarget.current = null;
      setSwitching(false);
      onStartSession?.();
    }
  }
  function loadPreview(sessionPath: string) {
    const request = ++previewRequest.current;
    const cached = projectionCache.current.get(normalizedPath(sessionPath));
    if (cached) {
      setPreview({ path: sessionPath, projection: cached });
      return;
    }
    void invoke<unknown[]>("chat_session_messages", { sessionPath, limit: 200 }).then(messages => {
      if (previewRequest.current !== request) return;
      if (normalizedPath(selectedSessionRef.current ?? "") !== normalizedPath(sessionPath)) return;
      try { setPreview({ path: sessionPath, projection: interruptUnfinishedTools(historyProjection(messages)) }); }
      catch { /* The runtime's authoritative history still loads below. */ }
    }).catch(() => { /* Opening still completes through the runtime. */ });
  }
  /** Start the runtime switch and expose the one promise a send can wait for. */
  function startSwitch(target: string | "new") {
    if (switchingRef.current) return;
    const promise = switchSession(target);
    switchPromise.current = promise;
    void promise.finally(() => { if (switchPromise.current === promise) switchPromise.current = null; });
  }
  async function ensureSelectedSession(client: ChatConnection): Promise<boolean> {
    const target = selectedSessionRef.current;
    if (!target) return true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (normalizedPath(target) === normalizedPath(client.snapshot.sessionFile ?? "")) return true;
      if (!switchingRef.current) startSwitch(target);
      const pending = switchPromise.current;
      if (!pending) break;
      await pending;
    }
    return normalizedPath(target) === normalizedPath(client.snapshot.sessionFile ?? "");
  }
  /** A click only records intent. The runtime load is always the single path below. */
  function openSession(sessionPath: string) {
    const client = connection.current;
    if (!client) return;
    const active = normalizedPath(client.snapshot.sessionFile ?? "");
    if (!switchingRef.current && normalizedPath(sessionPath) === active) {
      queuedSwitch.current = null;
      previewRequest.current += 1;
      setPreview(null);
      setSessionError(null);
      setSelectedSession(sessionPath);
      setHero(false);
      return;
    }
    setSessionError(null);
    setSelectedSession(sessionPath);
    setHero(false);
    loadPreview(sessionPath);
  }
  async function forkTurn(prompt: string, messageIndex: number) {
    const client = connection.current;
    if (!client || !prompt.trim()) return;
    if (switchingRef.current || snapshot.pending || !snapshot.connected) { setNotification("Wait for the session to finish loading."); return; }
    // Fork is an explicit action on the selected session: attach it first, the same
    // way Review does, so the branch is copied from the session on screen.
    const target = selectedSessionRef.current;
    const attach = !!target && normalizedPath(target) !== normalizedPath(client.snapshot.sessionFile ?? "");
    if (attach) startSwitch(target);
    switchingRef.current = true;
    setSwitching(true);
    try {
      if (attach) {
        await switchPromise.current;
        if (connection.current !== client || normalizedPath(target ?? "") !== normalizedPath(client.snapshot.sessionFile ?? "")) {
          setNotification("Could not attach this session for forking.");
          return;
        }
        // switchSession's finally clears the guard; keep fork single-flight while it runs.
        switchingRef.current = true;
        setSwitching(true);
      }
      const source = client.snapshot.sessionFile;
      if (!source) throw new Error("This session has no file to branch yet.");
      // Copy the session through the clicked message (the turn end) into a new
      // session, then switch the runtime to it. No runtime fork semantics change.
      const branch = await invoke<string>("chat_session_branch", { sessionPath: source, messageIndex });
      await client.resumeSession(branch);
      await refreshSessions();
      setPreview(null);
      setSelectedSession(branch);
      setHero(false);
      setNotification("Branched into a new conversation.");
    } catch (error) { setNotification(String(error).replace(/^Error:\s*/u, "")); }
    finally { switchingRef.current = false; setSwitching(false); }
  }
  useEffect(() => {
    if (switching || !snapshot.connected || snapshot.pending || !queuedSwitch.current) return;
    const target = queuedSwitch.current;
    queuedSwitch.current = null;
    if (target !== "new" && normalizedPath(target) === normalizedPath(connection.current?.snapshot.sessionFile ?? "")) {
      setSelectedSession(target);
      setPreview(null);
      return;
    }
    startSwitch(target);
  }, [switching, snapshot.connected, snapshot.pending]);
  async function compactConversation() {
    const client = connection.current;
    if (!client || commandBusy) return;
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("Could not attach this session for compacting."); return; }
      await client.compact();
      if (connection.current === client) setNotification("Earlier conversation compacted.");
    } catch (error) { if (connection.current === client) setNotification(String(error).replace(/^Error:\s*/u, "")); }
    finally { setCommandBusy(false); }
  }
  async function exportConversation() {
    const client = connection.current;
    if (!client || !snapshot.connected || commandBusy) return;
    const selected = await save({ title: "Export conversation", defaultPath: `${name}-conversation.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
    if (typeof selected !== "string" || connection.current !== client) return;
    setCommandBusy(true);
    try {
      if (!await ensureSelectedSession(client)) { setNotification("Could not attach this session for export."); return; }
      await client.exportHtml(selected);
      if (connection.current === client) setNotification(`Conversation exported to ${selected}`);
    } catch (error) { if (connection.current === client) setNotification(String(error)); }
    finally { setCommandBusy(false); }
  }
  async function switchWorkspace(next: string) {
    if (next === path) { setPickerOpen(false); return; }
    if (snapshot.projection.running && !await confirm("Stop the current run and switch workspace?", { title: "Switch workspace", kind: "warning" })) return;
    freshOnPath.current = true;
    setSelectedSession(null);
    setHero(true);
    onStartSession?.();
    setPickerOpen(false);
    onSelect(next);
  }
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; path: string; name: string; sessions: SessionSummary[] }>();
    for (const workspace of workspaces) map.set(normalizedPath(workspace.path), { id: workspace.id, path: workspace.path, name: workspaceLabel(workspace.path), sessions: [] });
    for (const session of sessions) {
      if (session.archived && !showArchived) continue;
      const key = normalizedPath(session.workspace);
      if (!map.has(key)) map.set(key, { id: key, path: session.workspace, name: workspaceLabel(session.workspace), sessions: [] });
      map.get(key)!.sessions.push(session);
    }
    let result = [...map.values()];
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      result = result.flatMap(group => {
        if (group.name.toLowerCase().includes(query) || group.path.toLowerCase().includes(query)) return [group];
        const matches = group.sessions.filter(session => session.title.toLowerCase().includes(query));
        return matches.length ? [{ ...group, sessions: matches }] : [];
      });
    }
    if (sort === "name") result.sort((left, right) => left.name.localeCompare(right.name));
    else result.sort((left, right) => (right.sessions[0]?.updated ?? 0) - (left.sessions[0]?.updated ?? 0));
    return result;
  }, [workspaces, sessions, search, sort, showArchived]);
  const activeSession = normalizedPath(snapshot.sessionFile ?? "");
  const selectedKey = normalizedPath(selectedSession ?? snapshot.sessionFile ?? "");
  const selectedTitle = sessions.find(session => normalizedPath(session.path) === selectedKey)?.title;
  const activePreview = preview && normalizedPath(preview.path) === selectedKey ? preview : null;
  const opening = !hero && !!selectedSession && selectedKey !== activeSession && !activePreview;
  const conversationProjection = activePreview?.projection ?? snapshot.projection;
  const conversationKey = selectedSession ?? snapshot.sessionId ?? path;
  const hasArchived = sessions.some(session => session.archived);
  const selectedWorkspace = sessions.find(session => normalizedPath(session.path) === selectedKey)?.workspace;
  useEffect(() => { if (selectedSession) selectedRowRef.current?.scrollIntoView({ block: "nearest" }); }, [selectedSession]);
  const flow = useMemo(() => deriveFlow(snapshot.projection.tools), [snapshot.projection.tools]);
  const subagents = useMemo(() => deriveSubagents(snapshot.projection.tools), [snapshot.projection.tools]);
  const flowError = useMemo(() => latestFlowError(snapshot.projection.messages), [snapshot.projection.messages]);
  const textguardWithheld = useMemo(() => Object.values(snapshot.projection.tools).some(tool => {
    const result = JSON.stringify(tool.result ?? "");
    return result.includes("TextGuard withheld") || result.includes("TextGuard advisory");
  }), [snapshot.projection.tools]);
  useEffect(() => {
    const id = snapshot.sessionId;
    if (!id || !textguardWithheld || switching || hero) return;
    updateTextGuard(id, { seen: true, historical: !textguardRef.current[id]?.data });
  }, [textguardWithheld, snapshot.sessionId, switching, hero]);
  const workspacePicker = <div ref={picker} className="relative">
    <Button type="button" variant="outline" className="h-8 max-w-64 gap-2 px-2 text-xs" aria-label="Choose workspace" aria-expanded={pickerOpen} onClick={() => setPickerOpen(value => !value)}>
      <FolderOpen className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{name}</span><ChevronDown className="size-3 shrink-0" aria-hidden="true" />
    </Button>
    {pickerOpen && <div role="menu" aria-label="Choose workspace" className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-2 shadow-xl">
      {workspaces.map(workspace => <button key={workspace.id} type="button" role="menuitemradio" aria-checked={workspace.path === path} onClick={() => void switchWorkspace(workspace.path)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
        <span className="min-w-0"><span className="block truncate">{workspaceLabel(workspace.path)}</span><span className="block truncate text-xs text-muted-foreground">{workspace.path}</span></span>
        {workspace.path === path && <span className="text-xs text-primary">Current</span>}
      </button>)}
      {!workspaces.length && <p className="px-2 py-2 text-sm text-muted-foreground">No workspaces yet.</p>}
      <div className="mt-1 border-t border-border pt-1"><Button type="button" variant="ghost" className="w-full justify-start" onClick={() => { setPickerOpen(false); onAddFolder(); }}><Plus className="size-4" />Add folder</Button></div>
    </div>}
  </div>;
  const workspaceError = snapshot.error;
  const textguardKey = snapshot.sessionId && selectedKey === activeSession ? snapshot.sessionId : "";
  const textguardView = textguardKey ? textguardBySession[textguardKey] : undefined;
  const textguardItems = textguardView?.data?.items.length ?? 0;
  const textguardBlocked = !!textguardView?.seen && (textguardView.data ? textguardItems > 0 : true);
  const [textguardMode, setTextguardMode] = useState<"on" | "strict" | "off">("on");
  const textguardControl = snapshot.sessionId ? {
    label: "TextGuard",
    title: `TextGuard mode: ${textguardMode === "on" ? "On" : textguardMode === "strict" ? "Strict" : "Off"}`,
    tone: "idle" as "blocked" | "expired" | "idle",
    disabled: !textguardKey,
    blocked: false,
    mode: textguardMode,
    onMode: (mode: "on" | "strict" | "off") => {
      setTextguardMode(mode);
      void runExtensionCommand(`/textguard ${mode}`);
    },
    onOpen: () => {},
  } : undefined;

  // A review created by the running turn can only be inspected after it settles.
  useEffect(() => {
    if (!textguardKey || snapshot.projection.running || !textguardView?.open || textguardView.data) return;
    inspectTextGuard(textguardKey);
  }, [textguardKey, snapshot.projection.running, textguardView?.open, textguardView?.data]);
  const textguardPanel = textguardKey && textguardView?.seen && textguardView.open
    ? <aside role="region" aria-label="TextGuard review" className="relative z-20 flex h-full w-[480px] max-w-[90vw] shrink-0 flex-col border-l border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">TextGuard</h2>
          <Button variant="ghost" className="size-8 p-0" aria-label="Close TextGuard" onClick={() => updateTextGuard(textguardKey, { open: false })}><X className="size-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TextGuardBar data={textguardView.data} open busy={textguardView.busy} running={snapshot.projection.running} error={textguardView.error} historical={textguardView.historical} onToggle={() => updateTextGuard(textguardKey, { open: false })} onStop={() => void connection.current?.abort()} onAction={(action, item, extra) => void runTextGuard(action, item, extra)} />
        </div>
      </aside>
    : null;
  return <div ref={chatRoot} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    {dropActive && <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-primary">Drop images or files</div>}
    {sidebar && <aside aria-label="Workspaces" className="absolute inset-y-0 left-0 z-20 flex w-72 max-w-[85%] flex-col border-r border-border bg-background shadow-xl md:static md:z-auto md:shadow-none">
      <div className="flex items-center gap-2 px-2 pb-2 pt-3"><Button className="min-w-0 flex-1 justify-start gap-2" onClick={() => void startNewSession()}><Plus className="size-4" />New session</Button><Button variant="ghost" className="size-8 p-0 md:hidden" aria-label="Hide workspaces" onClick={() => setSidebar(false)}><X className="size-4" /></Button></div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspaces</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="size-7 p-0" aria-label="Search workspaces" aria-pressed={searchOpen} onClick={() => { setSearchOpen(value => !value); if (searchOpen) setSearch(""); }}><Search className="size-3.5" /></Button>
          {(hasArchived || showArchived) && <Button variant="ghost" className="size-7 p-0" aria-label={showArchived ? "Hide archived sessions" : "Show archived sessions"} aria-pressed={showArchived} onClick={() => setShowArchived(value => !value)}><Archive className="size-3.5" /></Button>}
          <Button variant="ghost" className="size-7 p-0" aria-label={sort === "recent" ? "Sort by name" : "Sort by recent"} onClick={() => setSort(value => value === "recent" ? "name" : "recent")}><ArrowUpDown className="size-3.5" /></Button>
          <Button variant="ghost" className="size-7 p-0" aria-label="Add folder" onClick={onAddFolder}><FolderPlus className="size-3.5" /></Button>
        </div>
      </div>
      {searchOpen && <div className="px-2 pb-2"><Input autoFocus aria-label="Search sessions" placeholder="Search sessions" value={search} onChange={event => setSearch(event.target.value)} /></div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {groups.map(group => {
          const open = !!search.trim() || !collapsed.has(group.id);
          return <section key={group.id} className="mb-1">
            <div className={`group flex items-center gap-1 rounded-lg ${(selectedWorkspace ? normalizedPath(selectedWorkspace) === normalizedPath(group.path) : !selectedKey && normalizedPath(group.path) === normalizedPath(path)) ? "bg-accent/70" : "hover:bg-muted/60"}`}>
              <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${group.name}`} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
                {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" /><span className="truncate text-sm">{group.name}</span>
              </button>
              <Button variant="ghost" className="mr-1 size-6 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${group.path}`} onClick={() => { const workspace = workspaces.find(item => normalizedPath(item.path) === normalizedPath(group.path)); if (workspace) onRemove(workspace.id); }}><X className="size-3" /></Button>
            </div>
            {open && <div className="ml-4 border-l border-border pl-1.5">
              {group.sessions.map(session => <div key={session.path} ref={node => { if (selectedKey === normalizedPath(session.path)) selectedRowRef.current = node; }} data-session-selected={selectedKey === normalizedPath(session.path) || undefined} className={`group/session relative flex items-center rounded-md text-sm ${selectedKey === normalizedPath(session.path) ? "bg-accent text-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary" : "hover:bg-muted/60"} ${session.archived ? "opacity-60" : ""}`}>
                <button type="button" onClick={() => void openSession(session.path)} title={session.path} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left">
                  {session.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" /> : <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />}<span className="min-w-0 flex-1 truncate">{session.title}</span><span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(session.updated)}</span>
                </button>
                <div className={`relative flex shrink-0 items-center gap-0.5 pr-1 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100 ${sessionMenu === session.path ? "opacity-100" : "opacity-0"}`} data-session-menu>
                  <button type="button" className="flex size-6 items-center justify-center rounded hover:bg-background/60" aria-label={session.pinned ? "Unpin session" : "Pin session"} title={session.pinned ? "Unpin session" : "Pin session"} onClick={() => void updateSession(session.path, { pinned: !session.pinned })}><Pin className={`size-3.5 ${session.pinned ? "text-primary" : "text-muted-foreground"}`} /></button>
                  <button type="button" className="flex size-6 items-center justify-center rounded hover:bg-background/60" aria-label="Session actions" title="Session actions" aria-haspopup="menu" aria-expanded={sessionMenu === session.path} onClick={() => setSessionMenu(value => value === session.path ? null : session.path)}><MoreHorizontal className="size-4 text-muted-foreground" /></button>
                  {sessionMenu === session.path && <div role="menu" aria-label={`Actions for ${session.title}`} className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-border bg-popover p-1 text-sm shadow-xl">
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => { void updateSession(session.path, { pinned: !session.pinned }); setSessionMenu(null); }}><Pin className="size-4 text-muted-foreground" />{session.pinned ? "Unpin session" : "Pin session"}</button>
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => void renameSession(session)}><Pencil className="size-4 text-muted-foreground" />Rename</button>
                    <button type="button" role="menuitem" disabled title="Fork is not available in the runtime yet" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"><GitFork className="size-4 text-muted-foreground" />Fork session</button>
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => { void updateSession(session.path, { archived: !session.archived }); setSessionMenu(null); }}>{session.archived ? <ArchiveRestore className="size-4 text-muted-foreground" /> : <Archive className="size-4 text-muted-foreground" />}{session.archived ? "Restore session" : "Archive session"}</button>
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => void copySessionId(session)}><Copy className="size-4 text-muted-foreground" />Copy Session ID</button>
                  </div>}
                </div>
              </div>)}
              {!group.sessions.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No sessions yet</p>}
            </div>}
          </section>;
        })}
        {!groups.length && <p className="p-3 text-sm text-muted-foreground">{search ? "No matching sessions" : "No workspaces yet."}</p>}
      </div>
      <div className="mt-auto border-t border-border p-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="min-w-0 flex-1 justify-start gap-2" onClick={onSettings}><Settings className="size-4" />Settings</Button>
          {onUpdate && <Button variant="ghost" className={`size-8 shrink-0 p-0 ${updateAvailable ? "text-primary hover:text-primary" : ""}`} aria-label={updateAvailable ? "Update available" : "Check for updates"} title={updateAvailable ? "Update available" : "Check for updates"} disabled={updateBusy} onClick={onUpdate}>{updateAvailable ? <ArrowUpCircle className={`size-4 ${updateBusy ? "animate-pulse" : ""}`} /> : <RefreshCw className={`size-4 ${updateBusy ? "animate-spin" : ""}`} />}</Button>}
        </div>
      </div>
    </aside>}
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hero ? <div className="flex items-center px-2 py-1.5"><Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={sidebar ? "Hide workspaces" : "Show workspaces"} title="Workspaces" aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><PanelLeft className="size-4" /></Button></div> : <div className="flex items-center gap-2 border-b border-border px-2 py-2 sm:px-3">
        <Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={sidebar ? "Hide workspaces" : "Show workspaces"} title="Workspaces" aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><PanelLeft className="size-4" /></Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="max-w-60 min-w-0 shrink-0 truncate text-sm font-semibold" title={`${name} · ${path}${snapshot.model ? ` · ${snapshot.model}` : ""}`}>{selectedTitle ?? name}</h2>
          {!snapshot.connected && <span className={`h-7 shrink-0 rounded-md border px-2 text-xs leading-7 ${workspaceError ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"}`}>{workspaceError ? "Offline" : "Starting…"}</span>}
          <div className="hidden min-w-0 items-center gap-1.5 md:flex">
            <span className="flex h-7 shrink-0 items-center rounded-md border border-border px-2 text-xs text-muted-foreground">Standard mode</span>
            <SubagentMenu agents={subagents} widgets={snapshot.widgets ?? {}} statuses={snapshot.statuses ?? {}} />
            <BackgroundMenu jobs={flow.background} widgets={snapshot.widgets ?? {}} statuses={snapshot.statuses ?? {}} />
            <FlowMenu key={snapshot.sessionId ?? path} flow={flow} widgets={snapshot.widgets ?? {}} statuses={snapshot.statuses ?? {}} notice={flowNotice} error={flowError} reports={reportsSession && normalizedPath(reportsSession) === activeSession ? diskReports : []} onCommand={command => void runExtensionCommand(command)} busy={commandBusy} />
            <McpMenu onReload={() => void reloadSession()} onAsk={() => setDraft("Add an MCP server to this workspace. Ask me for the name, transport, target, and any required environment variables.")} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label="Reload session" title="Reload session (extensions, skills, MCP and catalogs)" disabled={commandBusy || !snapshot.sessionFile || snapshot.pending || snapshot.projection.running} onClick={() => void reloadSession()}><RefreshCw className="size-3.5" /></Button>
          {onTerminal && <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label="Open in terminal" title="Open this session's workspace in a terminal" onClick={() => onTerminal(path)}><SquareTerminal className="size-3.5" /></Button>}
        </div>
      </div>}
      {notification && <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-16 z-50 w-max max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-popover px-4 py-2 text-xs text-foreground shadow-xl">{notification}</div>}
      {workspaceError && !notification && <div role="alert" className="fixed left-1/2 top-16 z-50 flex w-max max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg bg-popover px-4 py-2 text-xs text-foreground shadow-xl"><span className="min-w-0 break-words">{workspaceError}</span><Button variant="outline" className="h-7 shrink-0 px-2" onClick={onRetry}>Retry</Button></div>}
      {sessionError && <div role="alert" className="fixed left-1/2 top-16 z-50 flex w-max max-w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border border-destructive/30 bg-popover px-4 py-2 text-xs text-foreground shadow-xl"><span className="min-w-0 break-words">{sessionError} The transcript is still available; this session was not discarded.</span><Button variant="outline" className="h-7 shrink-0 px-2" onClick={() => { if (selectedSession) openSession(selectedSession); }}>Retry</Button></div>}
      {dialog && <section role="dialog" aria-modal="false" aria-label={dialog.title} className="m-3 rounded-xl border border-primary bg-card p-4"><h3 className="font-semibold">{dialog.title}</h3>{dialog.message && <p className="my-2 text-sm">{dialog.message}</p>}{["input", "editor"].includes(dialog.method) && <textarea aria-label="Response" disabled={dialog.responding} className="my-2 w-full rounded border border-border bg-background p-2" value={answer} onChange={event => setAnswer(event.target.value)} />}
        <fieldset disabled={dialog.responding || !snapshot.transportReady} className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void reply({ cancelled: true })}>Cancel</Button>{dialog.method === "confirm" ? <><Button variant="outline" onClick={() => void reply({ confirmed: false })}>No</Button><Button onClick={() => void reply({ confirmed: true })}>Yes</Button></> : dialog.method === "select" ? dialog.options.map(option => <Button key={option} onClick={() => void reply({ value: option })}>{option}</Button>) : <Button onClick={() => void reply({ value: answer })}>Submit</Button>}</fieldset></section>}
      {hero ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8 sm:px-8">
        <div className="w-full max-w-3xl">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card"><Sparkles className="size-6 text-primary" aria-hidden="true" /></span>
            <h1 className="text-2xl font-semibold tracking-tight">What would you like to build?</h1>
            <p className="max-w-md text-sm text-muted-foreground">Choose a workspace, then describe the task. Jouzu can explore code, explain it, or make a change.</p>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">{workspacePicker}<span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">Standard mode</span></div>
          <Composer hero connected={snapshot.connected} pending={snapshot.pending || commandBusy || switching} opening={false} running={snapshot.projection.running} draft={draft} onDraft={setDraft} onSend={() => void send()} onStop={() => void connection.current?.abort()} onCompact={() => void compactConversation()} onExport={() => void exportConversation()} compatibility={snapshot.projection.compatibility} attachments={attachments} onAddImages={files => void addImages(files)} onRemoveImage={id => updateAttachments(attachmentRef.current.filter(item => item.id !== id))} readingImages={readingImages} attachmentError={attachmentError} models={snapshot.models ?? []} model={snapshot.model} onSelectModel={(provider, id) => void selectSessionModel(provider, id)} onRefreshModels={() => void connection.current?.loadModels()} thinkingLevel={snapshot.thinkingLevel} thinkingLevels={snapshot.thinkingLevels ?? []} onThinkingLevel={level => void selectThinkingLevel(level)} />
          <SessionStatsBar stats={snapshot.stats} timing={timing} />
        </div>
      </div> : !snapshot.sessionId ? <div role="status" className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Opening session…</div> : <>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatConversation key={conversationKey} projection={conversationProjection} pending={snapshot.pending} startedAt={workingStartedAt} opening={false} onFork={(prompt, index) => void forkTurn(prompt, index)} />
          {opening && !activePreview && <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-background/60 pt-24 backdrop-blur-[1px]"><span className="rounded-lg border border-border bg-popover px-4 py-2 text-sm text-foreground shadow-lg">Opening {selectedTitle ?? name}…</span></div>}
        </div>
        <div className="relative">
          <Composer connected={snapshot.connected} pending={snapshot.pending || commandBusy || (opening && !activePreview)} opening={opening && !activePreview} unavailable={!!sessionError} running={snapshot.projection.running} draft={draft} onDraft={setDraft} onSend={() => void send()} onStop={() => void connection.current?.abort()} onCompact={() => void compactConversation()} onExport={() => void exportConversation()} compatibility={snapshot.projection.compatibility} attachments={attachments} onAddImages={files => void addImages(files)} onRemoveImage={id => updateAttachments(attachmentRef.current.filter(item => item.id !== id))} readingImages={readingImages} attachmentError={attachmentError} models={snapshot.models ?? []} model={snapshot.model} onSelectModel={(provider, id) => void selectSessionModel(provider, id)} onRefreshModels={() => void connection.current?.loadModels()} thinkingLevel={snapshot.thinkingLevel} thinkingLevels={snapshot.thinkingLevels ?? []} onThinkingLevel={level => void selectThinkingLevel(level)} textguard={textguardControl} />
        </div>
        <SessionStatsBar stats={snapshot.stats} timing={timing} />
      </>}
    </section>
    {textguardPanel}
  </div>;
}

