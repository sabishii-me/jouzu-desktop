import { View, Text, Image, Scroll, computed } from "nsh";
import { Input as BaseInput, Menu, MenuItem, Popover } from "nsh/base";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Icon } from "./ui/icons";
import { Dialog, DialogTitle } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { McpMenu } from "./mcp-menu";
import { ChatConversation } from "./chat-conversation";
import { AgentAction } from "./chat-live";
import { Composer } from "./composer";
import { ArtifactsPanel } from "./artifacts-panel";
import { collectOutputReferences } from "./artifact-references";
import { PanelStart } from "./panel-start";
import { FilesPanel } from "./files-panel";
import { ToolReviewDialog } from "./tool-review-dialog";
import { BackgroundMenu, deriveFlow, deriveSubagents, FlowMenu, latestFlowError, SubagentMenu } from "./tool-renderers";
import { SessionStatsBar } from "./session-stats-bar";
import { TextGuardBar } from "./textguard-bar";
import { humanizeRuntimeError } from "./runtime-errors";
import { createChatWorkspace, normalizedPath, relativeTime, workspaceLabel, type ChatWorkspaceProps, type ChatWorkspaceStore, type SessionSummary } from "./chat-workspace-store";
import { cn } from "./lib";

const MENU_POPUP = "rounded-xl border border-border bg-popover p-1 shadow-xl";
const MENU_ITEM = "flex-row items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50";

/** The extension dialog above the composer (review, confirm, select, input). */
function DialogNode(props: { w: ChatWorkspaceStore }) {
  const w = props.w;
  const reviewBody = computed(() => {
    const dialog = w.dialog();
    return dialog?.title.startsWith("Review tool call") ? dialog.title.split("\n").slice(1).join("\n") : null;
  });
  return (
    <If when={!!w.dialog()}>
      <If when={reviewBody() !== null} else={
        <View class="flex-col rounded-xl border border-primary bg-card p-4 shadow-2xl" accessibilityLabel={w.dialog()?.title.split("\n")[0] ?? ""}>
          <Text class="font-semibold">{w.dialog()?.title.split("\n")[0] ?? ""}</Text>
          <If when={(w.dialog()?.title.split("\n").length ?? 0) > 1}>
            <Text class="my-2 text-sm">{w.dialog()?.title.split("\n").slice(1).join("\n") ?? ""}</Text>
          </If>
          <If when={!!w.dialog()?.message}>
            <Text class="my-2 text-sm">{w.dialog()?.message ?? ""}</Text>
          </If>
          <If when={["input", "editor"].includes(w.dialog()?.method ?? "")}>
            <BaseInput
              accessibilityLabel="Response"
              multiline
              disabled={w.dialog()?.responding}
              class="my-2 w-full rounded border border-border bg-background p-2 text-sm"
              value={w.answer()}
              onChange={event => w.answer.set(event.value)}
            />
          </If>
          <View class="mt-3 flex-row flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={w.dialog()?.responding || !w.snapshot().transportReady} onClick={() => void w.reply({ cancelled: true })}>Cancel</Button>
            <If when={w.dialog()?.method === "confirm"} else={
              <If when={w.dialog()?.method === "select"} else={
                <Button disabled={w.dialog()?.responding || !w.snapshot().transportReady} onClick={() => void w.reply({ value: w.answer() })}>Submit</Button>
              }>
                <View class="flex-row flex-wrap gap-2">
                  <Each of={w.dialog()?.options ?? []} key={option => option}>
                    {(option) => (
                      <Button disabled={w.dialog()?.responding || !w.snapshot().transportReady} onClick={() => void w.reply({ value: option() })}>{option()}</Button>
                    )}
                  </Each>
                </View>
              </If>
            }>
              <View class="flex-row gap-2">
                <Button variant="outline" disabled={w.dialog()?.responding || !w.snapshot().transportReady} onClick={() => void w.reply({ confirmed: false })}>No</Button>
                <Button disabled={w.dialog()?.responding || !w.snapshot().transportReady} onClick={() => void w.reply({ confirmed: true })}>Yes</Button>
              </View>
            </If>
          </View>
        </View>
      }>
        <ToolReviewDialog
          title="Review tool call"
          body={reviewBody() ?? ""}
          options={w.dialog()?.options ?? []}
          disabled={!!w.dialog()?.responding || !w.snapshot().transportReady}
          onSelect={value => void w.reply({ value })}
          onCancel={() => void w.reply({ cancelled: true })}
        />
      </If>
    </If>
  );
}

/** The workspace chooser above the hero composer. */
function WorkspacePicker(props: { w: ChatWorkspaceStore; host: ChatWorkspaceProps }) {
  const w = props.w;
  return (
    <Popover
      placement="bottom"
      align="start"
      popupClass={cn(MENU_POPUP, "w-80 p-2")}
      trigger={
        <View class="h-8 max-w-64 flex-row items-center gap-2 rounded-md border border-border bg-background px-2 hover:bg-muted" role="button" accessibilityLabel="Choose workspace">
          <Icon name="FolderOpen" size={16} />
          <Text class="min-w-0 truncate text-xs">{workspaceLabel(props.host.path)}</Text>
          <Icon name="ChevronDown" size={12} />
        </View>
      }
    >
      <View class="flex-col">
        <Each of={props.host.workspaces} key={workspace => workspace.id}>
          {(workspace) => (
            <View
              class="w-full flex-row items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
              role="menuitemradio"
              onPress={() => void w.switchWorkspace(workspace().path)}
            >
              <View class="min-w-0 flex-col">
                <Text class="truncate text-sm">{workspaceLabel(workspace().path)}</Text>
                <Text class="truncate text-xs text-muted-foreground">{workspace().path}</Text>
              </View>
              <If when={workspace().path === props.host.path}>
                <Text class="text-xs text-primary">Current</Text>
              </If>
            </View>
          )}
        </Each>
        <If when={props.host.workspaces.length === 0}>
          <Text class="px-2 py-2 text-sm text-muted-foreground">No workspaces yet.</Text>
        </If>
        <View class="mt-1 border-t border-border pt-1">
          <Button variant="ghost" className="w-full justify-start" onClick={() => props.host.onAddFolder()}>
            <Icon name="Plus" size={16} />
            <Text class="text-sm font-medium">Add folder</Text>
          </Button>
        </View>
      </View>
    </Popover>
  );
}
/** One session row: open, pin, and the actions menu. */
function SessionRow(props: { w: ChatWorkspaceStore; session: SessionSummary }) {
  const w = props.w;
  const selected = () => w.selectedKey() === normalizedPath(props.session.path);
  return (
    <View class={cn("relative flex-row items-center rounded-md text-sm", selected() ? "bg-accent text-foreground" : "hover:bg-muted/60", props.session.archived ? "opacity-60" : "")}>
      <View
        class="min-w-0 flex-1 flex-row items-center gap-2 px-2 py-1.5"
        role="button"
        accessibilityLabel={props.session.title}
        onPress={() => w.openSession(props.session.path)}
      >
        <Icon name={props.session.pinned ? "Pin" : "MessageSquare"} size={14} color={props.session.pinned ? undefined : undefined} />
        <Text class="min-w-0 flex-1 truncate text-sm">{props.session.title}</Text>
        <If when={w.isSessionRunning(props.session.path)}>
          <View class="size-1.5 shrink-0 rounded-full bg-primary" accessibilityLabel="Running" />
        </If>
        <Text class="shrink-0 text-[11px] text-muted-foreground">{relativeTime(props.session.updated)}</Text>
        <If when={w.artifactCount(props.session.path) > 0}>
          <Text class="shrink-0 rounded border border-border px-1 text-[10px] tabular-nums text-muted-foreground">{String(w.artifactCount(props.session.path))}</Text>
        </If>
      </View>
      <View class="shrink-0 flex-row items-center gap-0.5 pr-1">
        <View
          class="size-6 items-center justify-center rounded hover:bg-background/60"
          role="button"
          accessibilityLabel={props.session.pinned ? "Unpin session" : "Pin session"}
          onPress={() => void w.updateSession(props.session.path, { pinned: !props.session.pinned })}
        >
          <Icon name="Pin" size={14} />
        </View>
        <Menu
          placement="bottom"
          align="end"
          popupClass={cn(MENU_POPUP, "w-52")}
          trigger={
            <View class="size-6 items-center justify-center rounded hover:bg-background/60" role="button" accessibilityLabel="Session actions">
              <Icon name="MoreHorizontal" size={16} />
            </View>
          }
        >
          <MenuItem class={MENU_ITEM} onSelect={() => void w.updateSession(props.session.path, { pinned: !props.session.pinned })}>
            <Icon name="Pin" size={16} />
            <Text class="text-sm">{props.session.pinned ? "Unpin session" : "Pin session"}</Text>
          </MenuItem>
          <MenuItem class={MENU_ITEM} onSelect={() => w.renameSession(props.session)}>
            <Icon name="Pencil" size={16} />
            <Text class="text-sm">Rename</Text>
          </MenuItem>
          <MenuItem class={MENU_ITEM} disabled>
            <Icon name="GitFork" size={16} />
            <Text class="text-sm">Fork session</Text>
          </MenuItem>
          <MenuItem class={MENU_ITEM} onSelect={() => void w.updateSession(props.session.path, { archived: !props.session.archived })}>
            <Icon name={props.session.archived ? "ArchiveRestore" : "Archive"} size={16} />
            <Text class="text-sm">{props.session.archived ? "Restore session" : "Archive session"}</Text>
          </MenuItem>
          <MenuItem class={MENU_ITEM} onSelect={() => void w.copySessionId(props.session)}>
            <Icon name="Copy" size={16} />
            <Text class="text-sm">Copy Session ID</Text>
          </MenuItem>
        </Menu>
      </View>
    </View>
  );
}

/** The workspace sidebar: new session, artifacts, the grouped session list. */
function Sidebar(props: { w: ChatWorkspaceStore; host: ChatWorkspaceProps }) {
  const w = props.w;
  return (
    <View class="w-80 max-w-[85%] shrink-0 flex-col border-r border-border bg-background" accessibilityLabel="Workspaces">
      <View class="flex-row items-center gap-2 px-2 pb-2 pt-3">
        <Button className="min-w-0 flex-1 justify-start gap-2" disabled={props.host.locked} onClick={() => void w.startNewSession()}>
          <Icon name="Plus" size={16} />
          <Text class="text-sm font-medium">New session</Text>
        </Button>
      </View>
      <View class="px-2 pb-2">
        <Button variant={w.appView() === "artifacts" ? "default" : "ghost"} className="w-full justify-start gap-2" onClick={() => w.appView.set(w.appView() === "artifacts" ? "chat" : "artifacts")}>
          <Icon name="Images" size={16} />
          <Text class="text-sm font-medium">Artifacts</Text>
        </Button>
      </View>
      <View class="flex-row items-center justify-between border-t border-border px-3 py-2">
        <Text class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspaces</Text>
        <View class="flex-row items-center gap-1">
          <Button variant="ghost" className="size-7 p-0" aria-label="Search workspaces" onClick={() => { w.searchOpen.update(value => !value); if (w.searchOpen()) w.search.set(""); }}>
            <Icon name="Search" size={14} />
          </Button>
          <If when={w.hasArchived() || w.showArchived()}>
            <Button variant="ghost" className="size-7 p-0" aria-label={w.showArchived() ? "Hide archived sessions" : "Show archived sessions"} onClick={() => w.showArchived.update(value => !value)}>
              <Icon name="Archive" size={14} />
            </Button>
          </If>
          <Button variant="ghost" className="size-7 p-0" aria-label={w.sort() === "recent" ? "Sort by name" : "Sort by recent"} onClick={() => w.sort.set(w.sort() === "recent" ? "name" : "recent")}>
            <Icon name="ArrowUpDown" size={14} />
          </Button>
          <Button variant="ghost" className="size-7 p-0" aria-label="Add folder" onClick={() => props.host.onAddFolder()}>
            <Icon name="FolderPlus" size={14} />
          </Button>
        </View>
      </View>
      <If when={w.searchOpen()}>
        <View class="px-2 pb-2">
          <Input autoFocus aria-label="Search sessions" placeholder="Search sessions" value={w.search()} onChange={event => w.search.set(event.target.value)} />
        </View>
      </If>
      <Scroll class="min-h-0 flex-1 px-1.5 pb-2">
        <Each of={w.groups()} key={group => group.id}>
          {(group) => <WorkspaceGroupView w={w} host={props.host} group={group()} />}
        </Each>
        <If when={w.groups().length === 0}>
          <Text class="p-3 text-sm text-muted-foreground">{w.search() ? "No matching sessions" : "No workspaces yet."}</Text>
        </If>
      </Scroll>
      <View class="mt-auto border-t border-border p-2">
        <View class="flex-row items-center gap-1">
          <Button variant="ghost" className="min-w-0 flex-1 justify-start gap-2" onClick={() => props.host.onSettings()}>
            <Icon name="Settings" size={16} />
            <Text class="text-sm font-medium">Settings</Text>
          </Button>
          <If when={!!props.host.onUpdate}>
            <Button variant="ghost" className={cn("size-8 shrink-0 p-0", props.host.updateAvailable ? "text-primary" : "")} aria-label={props.host.updateAvailable ? "Update available" : "Check for updates"} disabled={props.host.updateBusy} onClick={() => props.host.onUpdate?.()}>
              <Icon name={props.host.updateAvailable ? "ArrowUpCircle" : "RefreshCw"} size={16} className={props.host.updateBusy ? "animate-spin" : undefined} />
            </Button>
          </If>
        </View>
      </View>
    </View>
  );
}

interface Group { id: string; path: string; name: string; sessions: SessionSummary[] }

function WorkspaceGroupView(props: { w: ChatWorkspaceStore; host: ChatWorkspaceProps; group: Group }) {
  const w = props.w;
  const open = () => !!w.search().trim() || !w.collapsed().has(props.group.id);
  const highlighted = () => {
    const selectedWorkspace = w.selectedWorkspace();
    return selectedWorkspace ? normalizedPath(selectedWorkspace) === normalizedPath(props.group.path) : !w.selectedKey() && normalizedPath(props.group.path) === normalizedPath(props.host.path);
  };
  return (
    <View class="mb-1 flex-col">
      <View class={cn("flex-row items-center gap-1 rounded-lg", highlighted() ? "bg-accent/70" : "hover:bg-muted/60")}>
        <View
          class="min-w-0 flex-1 flex-row items-center gap-1.5 px-2 py-1.5"
          role="button"
          accessibilityLabel={`${open() ? "Collapse" : "Expand"} ${props.group.name}`}
          onPress={() => w.toggleCollapsed(props.group.id)}
        >
          <Icon name={open() ? "ChevronDown" : "ChevronRight"} size={14} />
          <Icon name="FolderOpen" size={16} />
          <Text class="min-w-0 truncate text-sm">{props.group.name}</Text>
        </View>
        <Button
          variant="ghost"
          className="mr-1 size-6 p-0"
          aria-label={`Remove ${props.group.path}`}
          onClick={() => {
            const workspace = props.host.workspaces.find(item => normalizedPath(item.path) === normalizedPath(props.group.path));
            if (workspace) props.host.onRemove(workspace.id);
          }}
        >
          <Icon name="X" size={12} />
        </Button>
      </View>
      <If when={open()}>
        <View class="ml-2 flex-col border-l border-border pl-1.5">
          <Each of={props.group.sessions} key={session => session.path}>
            {(session) => <SessionRow w={w} session={session()} />}
          </Each>
          <If when={props.group.sessions.length === 0}>
            <Text class="px-2 py-1.5 text-xs text-muted-foreground">No sessions yet</Text>
          </If>
        </View>
      </If>
    </View>
  );
}

/** One side pane: Start / Artifacts / Files tabs with a resize handle. */
function PaneView(props: { w: ChatWorkspaceStore; index: number; references: ReturnType<typeof collectOutputReferences> }) {
  const w = props.w;
  const pane = () => w.panes()[props.index];
  let resizeStart: { x: number; width: number } | null = null;
  return (
    <If when={!!pane()}>
      <View class="relative min-h-0 shrink-0 flex-col border-l border-border bg-background" style={{ width: pane()?.width ?? 480 }}>
        <Tabs value={pane()?.active ?? "start"} onValueChange={value => w.setPaneActive(props.index, value)} className="min-h-0 flex-1 gap-0">
          <View class="flex-row items-center gap-1 border-b border-border px-2 py-1">
            <TabsList className="h-9 min-w-0 flex-1 justify-start gap-1 rounded-none bg-transparent p-0">
              <Each of={pane()?.tabs ?? []} key={tab => tab}>
                {(tab) => (
                  <View class="relative shrink-0 flex-row items-center">
                    <TabsTrigger value={tab()} className="h-9 flex-none px-3 text-xs">
                      {tab() === "artifacts" ? "Artifacts" : tab() === "start" ? "Start" : tab() === "files" ? "Files" : tab()}
                    </TabsTrigger>
                    <View class="rounded p-0.5 hover:bg-muted" role="button" accessibilityLabel={`Close ${tab()} tab`} onPress={() => w.closePaneTab(props.index, tab())}>
                      <Icon name="X" size={12} />
                    </View>
                  </View>
                )}
              </Each>
            </TabsList>
            <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label="Add panel tab" onClick={() => w.addPaneTab(props.index)}>
              <Icon name="Plus" size={14} />
            </Button>
            <If when={props.index === w.panes().length - 1}>
              <Button variant="ghost" className="ml-auto size-7 shrink-0 p-0" aria-label={w.panes().length < 2 ? "Split pane" : "Close second pane"} onClick={() => w.panes().length < 2 ? w.addPane() : w.removePane(1)}>
                <Icon name="Columns2" size={14} />
              </Button>
            </If>
          </View>
          <TabsContent value={pane()?.active ?? "start"} className="min-h-0 flex-1">
            <Scroll class="min-h-0 flex-1 p-3">
              <If when={pane()?.active === "start"} else={
                <If when={pane()?.active === "artifacts"} else={
                  <If when={pane()?.active === "files"}>
                    <Each of={[w.selectedSessionWorkspacePath()]} key={workspacePath => workspacePath}>
                      {(workspacePath) => <FilesPanel path={workspacePath()} />}
                    </Each>
                  </If>
                }>
                  <ArtifactsPanel embedded sessionId={w.artifactsSessionId()} workspace={w.selectedSessionWorkspacePath()} references={props.references} />
                </If>
              }>
                <PanelStart onOpen={id => w.openPaneView(props.index, id)} />
              </If>
            </Scroll>
          </TabsContent>
        </Tabs>
        <View
          class="absolute left-0 top-0 h-full w-1.5 hover:bg-primary/30"
          accessibilityLabel="Resize pane"
          onMoveShouldSetResponder={event => { resizeStart = { x: event.pageX, width: pane()?.width ?? 480 }; return true; }}
          onResponderMove={event => {
            if (!resizeStart) return;
            w.setPaneWidth(props.index, resizeStart.width + (resizeStart.x - event.pageX));
          }}
          onResponderRelease={() => { resizeStart = null; }}
        />
      </View>
    </If>
  );
}

export function ChatWorkspace(props: ChatWorkspaceProps) {
  const w = createChatWorkspace(props);
  const flow = computed(() => deriveFlow(w.snapshot().projection.tools));
  const subagents = computed(() => deriveSubagents(w.snapshot().projection.tools));
  const flowError = computed(() => latestFlowError(w.snapshot().projection.messages));
  const outputReferences = computed(() => collectOutputReferences(w.conversationProjection().messages, w.artifactsSessionId()));
  const name = () => workspaceLabel(props.path);
  const fileUrisToPaths = (uris: string[]) => uris.map(uri => {
    if (!uri.startsWith("file:")) return uri;
    try {
      let path = decodeURIComponent(new URL(uri).pathname);
      if (/^\/[A-Za-z]:/u.test(path)) path = path.slice(1);
      return path.replaceAll("/", "\\");
    } catch { return uri; }
  });

  return (
    <View
      class="relative min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
      onFileDragEnter={() => w.dropActive.set(true)}
      onFileDragLeave={() => w.dropActive.set(false)}
      onFileDrop={event => {
        w.dropActive.set(false);
        void w.addDropped(fileUrisToPaths(event.uris));
      }}
    >
      <If when={w.dropActive()}>
        <View class="pointer-events-none absolute inset-0 z-40 items-center justify-center border-2 border-dashed border-primary bg-background/85">
          <Text class="text-sm font-medium text-primary">Drop images or files</Text>
        </View>
      </If>
      <If when={w.sidebar()}>
        <Sidebar w={w} host={props} />
      </If>
      <If when={w.appView() === "chat"}>
        <View class="min-h-0 min-w-0 flex-1 flex-col">
          <If when={w.hero()} else={
            <View class="flex-row items-center gap-2 border-b border-border px-2 py-2 sm:px-3">
              <Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={w.sidebar() ? "Hide workspaces" : "Show workspaces"} onClick={() => w.sidebar.update(value => !value)}>
                <Icon name="PanelLeft" size={16} />
              </Button>
              <View class="min-w-0 flex-1 flex-row items-center gap-2">
                <Text class="max-w-60 min-w-0 shrink-0 truncate text-sm font-semibold">{w.selectedTitle() ?? name()}</Text>
                <If when={!w.snapshot().connected}>
                  <Text class={cn("h-7 shrink-0 rounded-md border px-2 text-xs leading-7", w.snapshot().error ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground")}>
                    {w.snapshot().error ? "Offline" : "Starting…"}
                  </Text>
                </If>
                <View class="hidden min-w-0 flex-row items-center gap-1.5 md:flex">
                  <SubagentMenu agents={subagents()} widgets={w.snapshot().widgets ?? {}} statuses={w.snapshot().statuses ?? {}} />
                  <BackgroundMenu jobs={flow().background} widgets={w.snapshot().widgets ?? {}} statuses={w.snapshot().statuses ?? {}} />
                  <FlowMenu
                    flow={flow()}
                    widgets={w.snapshot().widgets ?? {}}
                    statuses={w.snapshot().statuses ?? {}}
                    notice={w.flowNotice()}
                    error={flowError()}
                    reports={w.reportsSession() && normalizedPath(w.reportsSession()) === w.activeSession() ? w.diskReports() : []}
                    onCommand={command => void w.runExtensionCommand(command)}
                    busy={w.commandBusy()}
                  />
                  <McpMenu onReload={() => void w.reloadSession()} onAsk={() => w.updateDraft("Add an MCP server to this workspace. Ask me for the name, transport, target, and any required environment variables.")} />
                </View>
              </View>
              <View class="shrink-0 flex-row items-center gap-0.5">
                <Button variant="ghost" className="size-7 shrink-0 p-0" aria-label="Toggle artifacts panel" onClick={() => w.toggleSide()}>
                  <Icon name="PanelRight" size={14} />
                </Button>
              </View>
            </View>
          }>
            <View class="flex-row items-center px-2 py-1.5">
              <Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={w.sidebar() ? "Hide workspaces" : "Show workspaces"} onClick={() => w.sidebar.update(value => !value)}>
                <Icon name="PanelLeft" size={16} />
              </Button>
            </View>
          </If>
          <If when={!!w.notification()}>
            <View class="pointer-events-none absolute left-1/2 top-16 z-50 max-w-[640px] -translate-x-1/2 rounded-lg bg-popover px-4 py-2 shadow-xl">
              <Text class="text-xs text-foreground">{w.notification()}</Text>
            </View>
          </If>
          <If when={!!w.snapshot().error && !w.notification()}>
            <View class="absolute left-1/2 top-16 z-50 max-w-[640px] -translate-x-1/2 flex-row items-center gap-3 rounded-lg bg-popover px-4 py-2 shadow-xl" role="alert">
              <Text class="min-w-0 text-xs text-foreground">{humanizeRuntimeError(w.snapshot().error ?? "")}</Text>
              <If when={w.capacityError()} else={
                <Button variant="outline" className="h-7 shrink-0 px-2" onClick={() => props.onRetry?.()}>Retry</Button>
              }>
                <Button variant="outline" className="h-7 shrink-0 px-2" onClick={() => void w.startNewSession()}>New session</Button>
              </If>
            </View>
          </If>
          <If when={!!w.sessionError()}>
            <View class="absolute left-1/2 top-16 z-50 max-w-[700px] -translate-x-1/2 flex-row items-center gap-3 rounded-lg border border-destructive/30 bg-popover px-4 py-2 shadow-xl" role="alert">
              <Text class="min-w-0 text-xs text-foreground">
                {humanizeRuntimeError(w.sessionError() ?? "") + (w.capacityError() ? "" : " The transcript is still available; this session was not discarded.")}
              </Text>
              <If when={w.capacityError()} else={
                <Button variant="outline" className="h-7 shrink-0 px-2" onClick={() => { const selected = w.selectedSession(); if (selected) w.openSession(selected); }}>Retry</Button>
              }>
                <Button variant="outline" className="h-7 shrink-0 px-2" onClick={() => void w.startNewSession()}>New session</Button>
              </If>
            </View>
          </If>
          <MainArea w={w} host={props} outputReferences={outputReferences()} />
        </View>
      </If>
      <If when={w.appView() === "artifacts"}>
        <View class="min-h-0 min-w-0 flex-1 flex-col">
          <Scroll class="min-h-0 flex-1 p-4">
            <View class="mx-auto w-full max-w-5xl">
              <ArtifactsPanel />
            </View>
          </Scroll>
        </View>
      </If>
      <If when={!!w.textguardKey() && !!w.textguardView()?.seen && !!w.textguardView()?.open}>
        <View class="relative z-20 h-full w-[480px] max-w-[90%] shrink-0 flex-col border-l border-border bg-background" role="region" accessibilityLabel="TextGuard review">
          <View class="flex-row items-center justify-between border-b border-border px-4 py-2.5">
            <Text class="text-sm font-semibold">TextGuard</Text>
            <Button variant="ghost" className="size-8 p-0" aria-label="Close TextGuard" onClick={() => w.updateTextGuard(w.textguardKey(), { open: false })}>
              <Icon name="X" size={16} />
            </Button>
          </View>
          <Scroll class="min-h-0 flex-1 p-3">
            <TextGuardBar
              data={w.textguardView()?.data ?? null}
              open
              busy={!!w.textguardView()?.busy}
              running={w.composerRunning()}
              error={w.textguardView()?.error ?? null}
              historical={!!w.textguardView()?.historical}
              onToggle={() => w.updateTextGuard(w.textguardKey(), { open: false })}
              onStop={() => w.abort()}
              onAction={(action, item, extra) => void w.runTextGuard(action, item, extra)}
            />
          </Scroll>
        </View>
      </If>
      <Dialog open={!!w.renameTarget()} onOpenChange={open => { if (!open) w.renameTarget.set(null); }} className="max-w-md">
        <DialogTitle>Rename session</DialogTitle>
        <Input aria-label="Session title" value={w.renameText()} onChange={event => w.renameText.set(event.target.value)} onSubmit={() => void w.commitRename()} />
        <View class="flex-row justify-end gap-2">
          <Button variant="outline" onClick={() => w.renameTarget.set(null)}>Cancel</Button>
          <Button onClick={() => void w.commitRename()}>Save</Button>
        </View>
      </Dialog>
    </View>
  );
}

/** The center: boot loader, hero composer, or the transcript with panes. */
function MainArea(props: { w: ChatWorkspaceStore; host: ChatWorkspaceProps; outputReferences: ReturnType<typeof collectOutputReferences> }) {
  const w = props.w;
  const composerCommon = () => ({
    connected: w.snapshot().connected,
    draft: w.draft(),
    onDraft: (value: string) => w.updateDraft(value),
    onSend: () => void w.send(),
    onStop: () => w.abort(),
    onCompact: () => void w.compactConversation(),
    onExport: () => void w.exportConversation(),
    compatibility: w.snapshot().projection.compatibility,
    attachments: w.attachments(),
    onAddImages: (files: File[]) => void w.addImages(files),
    onRemoveImage: (id: string) => w.updateAttachments(w.attachments().filter(item => item.id !== id)),
    readingImages: w.readingImages(),
    attachmentError: w.attachmentError(),
    videos: w.videoUrls(),
    onAddVideo: (url: string) => w.addVideoUrl(url),
    onRemoveVideo: (url: string) => w.removeVideoUrl(url),
    models: w.snapshot().models ?? [],
    model: w.snapshot().model,
    onSelectModel: (provider: string, id: string) => void w.selectSessionModel(provider, id),
    onRefreshModels: () => w.loadModels(),
    onRetryModels: props.host.canRefreshModels ? props.host.onRetryModels : undefined,
    thinkingLevel: w.snapshot().thinkingLevel,
    thinkingLevels: w.snapshot().thinkingLevels ?? [],
    onThinkingLevel: (level: string) => void w.selectThinkingLevel(level),
  });
  return (
    <If when={w.booting()} else={
      <If when={w.hero()} else={
        <If when={!w.snapshot().sessionId} else={
          <View class="min-h-0 flex-1 flex-row">
            <View class="min-w-[520px] flex-1 flex-col">
              <View class="relative min-h-0 flex-1 flex-col">
                <If when={!!w.snapshot().gap}>
                  <Text class="mx-auto mb-2 max-w-3xl text-xs text-muted-foreground">The transcript was refreshed after a display backlog.</Text>
                </If>
                <Each of={[w.conversationKey()]} key={sessionKey => sessionKey}>
                  {() => (
                    <ChatConversation
                      projection={w.conversationProjection()}
                      workspace={props.host.path}
                      busy={w.snapshot().pending}
                      pendingUser={w.pendingUser()}
                      onFork={(prompt, index) => void w.forkTurn(prompt, index)}
                      onOpenArtifacts={() => w.openArtifactsPanel()}
                    />
                  )}
                </Each>
              </View>
              <View class="relative flex-col">
                <View class="mx-auto w-full max-w-3xl flex-col">
                  <If when={!!w.flowNotice()}>
                    <FlowNotice w={w} />
                  </If>
                  <AgentAction thinking={w.liveThinking()} label="Working…" running={w.conversationProjection().running} elapsed={w.elapsed()} settled={w.settled()} />
                </View>
                <If when={!!w.dialog()}>
                  <View class="absolute bottom-full left-1/2 z-20 mb-2 w-[720px] max-w-full -translate-x-1/2 px-3">
                    <DialogNode w={w} />
                  </View>
                </If>
                <Composer
                  {...composerCommon()}
                  connected={w.snapshot().connected || !!w.activePreview()}
                  pending={w.snapshot().pending || w.commandBusy() || (w.opening() && !w.activePreview()) || !!props.host.locked}
                  opening={w.opening() && !w.activePreview()}
                  unavailable={!!w.sessionError()}
                  running={w.composerRunning()}
                  textguard={w.textguardControl()}
                />
              </View>
              <SessionStatsBar stats={w.snapshot().stats} timing={w.timing()} />
            </View>
            <Each of={w.panes()} key="index">
              {(_pane, index) => <PaneView w={w} index={index()} references={props.outputReferences} />}
            </Each>
          </View>
        }>
          <View class="min-h-0 flex-1 items-center justify-center">
            <Text class="text-sm text-muted-foreground">Opening session…</Text>
          </View>
        </If>
      }>
        <HeroArea w={w} host={props.host} composerCommon={composerCommon()} />
      </If>
    }>
      <View class="min-h-0 flex-1 items-center justify-center">
        <Text class="text-sm text-muted-foreground">Starting session…</Text>
      </View>
    </If>
  );
}

function FlowNotice(props: { w: ChatWorkspaceStore }) {
  const w = props.w;
  return (
    <View class="mb-1 flex-row flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2" role="alert">
      <Text class="min-w-0 flex-1 text-[11px] text-amber-700 dark:text-amber-300">
        {/holding|reconciliation|waiting for recovery/iu.test(w.flowNotice()) ? "Flow is holding your message. Clear it to continue." : w.flowNotice()}
      </Text>
      <If when={/paused/iu.test(w.flowNotice())}>
        <Button variant="outline" className="h-6 px-2" onClick={() => void w.runExtensionCommand("/flow resume")}>
          <Text class="text-[10px]">Resume</Text>
        </Button>
      </If>
      <Button variant="outline" className="h-6 px-2" onClick={() => void w.runExtensionCommand("/flow clear")}>
        <Text class="text-[10px]">Clear</Text>
      </Button>
    </View>
  );
}

function HeroArea(props: { w: ChatWorkspaceStore; host: ChatWorkspaceProps; composerCommon: Record<string, unknown> }) {
  const w = props.w;
  const common = props.composerCommon as Omit<import("./composer").ComposerProps, "pending" | "running">;
  return (
    <Scroll class="min-h-0 flex-1 px-4 py-8 sm:px-8" contentClass="grow justify-center">
      <View class="mx-auto w-full max-w-3xl flex-col">
        <View class="mb-7 flex-col items-center gap-3">
          <View class="size-12 items-center justify-center rounded-2xl border border-border bg-card">
            <Icon name="Sparkles" size={24} />
          </View>
          <Text class="text-2xl font-semibold tracking-tight">What would you like to build?</Text>
          <Text class="max-w-md text-center text-sm text-muted-foreground">Choose a workspace, then describe the task. Jouzu can explore code, explain it, or make a change.</Text>
        </View>
        <View class="mb-2 flex-row flex-wrap items-center gap-2 px-1">
          <WorkspacePicker w={w} host={props.host} />
        </View>
        <If when={!!w.dialog()}>
          <View class="mb-3">
            <DialogNode w={w} />
          </View>
        </If>
        <Composer
          {...common}
          hero
          pending={w.snapshot().pending || w.commandBusy() || w.switching() || !!props.host.locked}
          opening={false}
          running={w.composerRunning()}
        />
        <SessionStatsBar stats={w.snapshot().stats} timing={w.timing()} />
      </View>
    </Scroll>
  );
}
