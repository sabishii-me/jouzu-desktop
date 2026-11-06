/**
 * The launcher shell's state, ported from the baseline App.tsx hooks. The
 * screens read these signals; the configuration service keeps its one-request
 * queue, and the runtime state machine (probe → prepare → connect) is unchanged.
 */
import { signal, computed, effect, setColorScheme, keymap, Clipboard } from "nsh";
import { invoke } from "./host/invoke";
import { listen } from "./host/events";
import { localStorage } from "./host/storage";
import { openFolder } from "./host/dialog";
import { APP_VERSION, developmentFlag } from "./host/window";
import { messages, resolveLocale, type Locale } from "./i18n";
import { parseControlState, type ControlState } from "./control-state";
import { parseDiagnostics, type Diagnostics } from "./diagnostics";
import type { Workspace } from "./history";
import { createJouzuUpdate } from "./jouzu-update-store";
import { createGitBash } from "./git-bash-section";
import { createComponent } from "./components/component-row";
import { logEvent } from "./log-event";

export interface LauncherState { platform: "windows" | "macos" | "linux"; recent: Workspace[]; ready: boolean; bash: boolean; bundled_git: boolean }
export interface Components { jouzu: string | null; development: boolean; launcherUpdaterConfigured?: boolean; jouzuUpdaterConfigured?: boolean }
export interface RuntimeReport { status?: string; version: string | null; root: string | null; app: string | null; node: boolean; nodeVersion: string | null; nodeCurrent: boolean; git: boolean; terminal: boolean }
export type Theme = "dark" | "light" | "system";

/** The Tauri shell updater is not ported (PORTING.md); its row stays unconfigured. */
const launcherUpdaterStub = {
  phase: "idle" as const,
  busy: false,
  version: null as string | null,
  error: null as string | null,
  notes: null as string | null,
  progress: undefined as number | undefined,
  refresh: async () => {},
  install: async () => {},
};

export function createAppStore() {
  const locale = signal<Locale>(resolveLocale(localStorage.getItem("jouzu.ui.language") ?? "en"));
  const theme = signal<Theme>((() => {
    const saved = localStorage.getItem("jouzu.ui.theme");
    return saved === "light" || saved === "system" ? saved : "dark";
  })());
  const t = computed(() => messages[locale()]);
  effect(() => {
    localStorage.setItem("jouzu.ui.theme", theme());
    setColorScheme(theme());
  });
  effect(() => { localStorage.setItem("jouzu.ui.language", locale()); });

  const activePath = signal<string | null>(null);
  const newSession = signal(true);
  const sessionRevision = signal(0);
  const chatBusy = signal(false);
  const entryBooting = signal(false);
  // Once the entry session has connected once, the full-window loader never
  // returns; later disconnects are the chat's own "Starting session…" line.
  const entryReady = signal(false);
  const restartPending = signal(false);
  const catalogRefreshing = signal(false);
  let catalogAttempted = false;
  const state = signal<LauncherState | null>(null);
  const error = signal<string | null>(null);
  const statusError = signal<string | null>(null);
  const operation = signal<"choosing" | "launching" | "preparing" | "saving" | null>(null);
  const version = signal<string | null>(APP_VERSION);
  const diagnostics = signal<Diagnostics | null>(null);
  const components = signal<Components | null>(null);
  const settingsTab = signal("providers");
  const settingsOpen = signal(false);
  const updateFocus = signal<number | null>(null);
  const repair = signal<{ error: string | null } | null>(null);
  const connectionMode = signal<"builtin" | "custom">("builtin");
  const providerQuery = signal("");
  const addingConnection = signal(false);
  const setup = signal<ControlState | null>(null);
  // null = still probing, false = onboarding installs it, true = the service can run.
  const runtimePresent = signal<boolean | null>(null);
  const runtimeUpdating = signal<{ phase: string; error: string | null } | null>(null);
  const prepare = signal<{ phase: string; downloaded: number; total: number | null; error: string | null }>({ phase: "", downloaded: 0, total: null, error: null });
  const device = signal<{ url: string; code: string } | null>(null);
  const providerDevice = signal<{ url: string; code: string; provider: string } | null>(null);
  const envRows = signal<{ name: string; value: string; enabled: boolean }[]>([]);
  const editingEnv = signal<number | null>(null);
  const envLoaded = signal(false);
  const custom = signal({ provider: "", url: "", model: "", edit: false, imageInput: false, contextWindow: 32768, maxTokens: 4096 });
  const provider = signal("");
  const token = signal("");
  const notice = signal<"requested" | "removed" | null>(null);
  const busy = computed(() => operation() !== null);

  const jouzuUpdater = createJouzuUpdate(
    () => components()?.jouzuUpdaterConfigured === true,
    () => {
      void loadComponents();
      // A runtime update is only visible to a fresh supervised process.
      requestSessionRestart();
    },
  );
  const updater = launcherUpdaterStub;
  const gitBash = createGitBash();
  const runtime = createComponent<RuntimeReport>("runtime_report");

  // The configuration service allows one operation at a time.
  let controlQueue: Promise<unknown> = Promise.resolve();

  function requestSessionRestart() {
    if (chatBusy()) restartPending.set(true);
    else sessionRevision.update(value => value + 1);
  }
  effect(() => {
    if (restartPending() && !chatBusy()) {
      restartPending.set(false);
      sessionRevision.update(value => value + 1);
    }
  });

  const refresh = async () => state.set(await invoke<LauncherState>("launcher_state"));
  const loadComponents = () => invoke<Components>("component_versions")
    .then(value => { components.set(value); developmentFlag.set(value.development === true); })
    .catch(failure => error.set(String(failure)));

  // Ctrl/Cmd+, opens settings, as the baseline's window keydown handler did.
  keymap.bind("mod+,", () => settingsOpen.set(true));

  const statusCopied = signal(false);
  async function copyStatusError() {
    const message = statusError();
    if (!message) return;
    try {
      await Clipboard.writeText(message);
      statusCopied.set(true);
      setTimeout(() => statusCopied.set(false), 2000);
    } catch (failure) { error.set(String(failure)); }
  }
  const refreshDiagnostics = async () => {
    try { diagnostics.set(parseDiagnostics(await invoke<unknown>("diagnostics"))); }
    catch { diagnostics.set(null); }
  };

  async function configure(request: Record<string, unknown>) {
    const mutates = request.action !== "status";
    const run = controlQueue.then(async () => {
      if (mutates) operation.set("saving");
      error.set(null);
      try {
        const next = parseControlState(await invoke<unknown>("control_request", { request }));
        setup.set(next);
        if (request.action !== "status" && request.action !== "import" && request.action !== "profile") requestSessionRestart();
        return true;
      }
      catch (failure) { error.set(String(failure)); return false; }
      finally { if (mutates) operation.set(null); device.set(null); providerDevice.set(null); }
    });
    controlQueue = run.catch(() => {});
    return run;
  }
  async function readStatus() {
    const run = controlQueue.then(async () => {
      statusError.set(null);
      try { setup.set(parseControlState(await invoke<unknown>("control_request", { request: { action: "status" } }))); }
      catch (failure) { statusError.set(String(failure)); }
    });
    controlQueue = run.catch(() => {});
    return run;
  }
  /** The prepare screen: one automatic install, no choices. */
  let prepareStarted = false;
  async function runPrepare() {
    prepare.set({ phase: "start", downloaded: 0, total: null, error: null });
    try {
      await invoke<string>("runtime_install");
      runtimePresent.set(true);
      await configure({ action: "profile", profile: locale() === "ja" ? "ja" : "core" });
      void loadComponents();
      await readStatus();
    } catch (failure) {
      prepareStarted = false;
      prepare.update(current => ({ ...current, error: String(failure) }));
    }
  }
  effect(() => {
    if (runtimePresent() !== false) { prepareStarted = false; return; }
    if (prepareStarted) return;
    prepareStarted = true;
    void runPrepare();
  });

  /** An outdated runtime is updated in place; new sessions wait. */
  async function updateRuntime() {
    runtimeUpdating.set({ phase: "start", error: null });
    try {
      await invoke<string>("runtime_install");
      const report = await invoke<RuntimeReport>("runtime_report");
      if (report && report.nodeCurrent === false) throw new Error("The runtime update did not finish.");
      runtimeUpdating.set(null);
      void (async () => { try { await invoke("image_tool_ensure"); } catch { /* optional on a fixture */ } })();
      void loadComponents();
      await readStatus();
    } catch (failure) {
      runtimeUpdating.set({ phase: "error", error: String(failure) });
    }
  }

  async function readEnvironment() {
    try { envRows.set(await invoke("environment_read")); envLoaded.set(true); editingEnv.set(null); }
    catch (failure) { error.set(String(failure)); }
  }
  async function saveEnvironment() {
    operation.set("saving"); error.set(null);
    try {
      await invoke("environment_save", { entries: envRows() });
      editingEnv.set(null);
      setup.set(parseControlState(await invoke<unknown>("control_request", { request: { action: "status" } })));
    }
    catch (failure) { error.set(String(failure)); }
    finally { operation.set(null); }
  }

  async function addFolders(paths: string[]) {
    operation.set("saving"); error.set(null);
    try {
      await invoke("add_workspaces", { paths });
      await refresh();
      if (paths.length && !activePath()) activePath.set(paths[0]);
    }
    catch (failure) { error.set(String(failure)); }
    finally { operation.set(null); }
  }
  async function chooseFolder() {
    operation.set("choosing"); error.set(null);
    try {
      const path = await openFolder();
      if (typeof path === "string") { await addFolders([path]); activePath.set(path); }
    } catch (failure) { error.set(String(failure)); }
    finally { operation.set(null); }
  }
  async function forget(workspace: Workspace) {
    operation.set("saving"); error.set(null);
    try {
      await invoke("forget_workspace", { id: workspace.id });
      const next = state()?.recent.find(item => item.id !== workspace.id)?.path ?? null;
      if (activePath() === workspace.path) activePath.set(next);
      await refresh();
      notice.set("removed");
    } catch (failure) { error.set(String(failure)); }
    finally { operation.set(null); }
  }
  async function repairConsole(): Promise<boolean> {
    repair.set({ error: null });
    try { await invoke("terminal_install"); repair.set(null); return true; }
    catch (failure) { repair.set({ error: String(failure) }); return false; }
  }
  function openUpdatePanel() {
    updateFocus.set(jouzuUpdater.version() ? 0 : 1);
    settingsTab.set("system");
    settingsOpen.set(true);
  }
  // A signed-in account supplies models through the published catalog; retry a
  // freshly issued key before leaving the install with an empty model list.
  async function refreshModelCatalog(force = false) {
    if (catalogAttempted && !force) return;
    catalogAttempted = true;
    catalogRefreshing.set(true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await configure({ action: "refresh-catalogs" })) return;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    finally { catalogRefreshing.set(false); }
  }

  // Startup: state, diagnostics, the runtime probe, and the event subscriptions.
  void (async () => {
    refresh().catch(failure => error.set(String(failure)));
    void refreshDiagnostics();
    try {
      const report = await invoke<RuntimeReport>("runtime_report");
      runtimePresent.set(true);
      if (report && report.nodeCurrent === false) { void updateRuntime(); return; }
      void (async () => { try { await invoke("image_tool_ensure"); } catch { /* optional */ } })();
      void loadComponents();
      void readStatus();
    } catch (failure) {
      if (String(failure).includes("application files are missing")) runtimePresent.set(false);
      else runtimePresent.set(true);
    }
  })();
  listen<{ url: string; code: string; provider?: string }>("control-device", event => {
    if (event.payload.provider && event.payload.provider !== "shisa") providerDevice.set({ ...event.payload, provider: event.payload.provider });
    else device.set(event.payload);
  });
  listen<{ phase: string; downloaded?: number; total?: number | null }>("runtime-install-progress", event => {
    runtimeUpdating.update(current => current && !current.error ? { phase: event.payload.phase, error: null } : current);
    prepare.update(current => ({
      ...current,
      phase: event.payload.phase,
      downloaded: event.payload.downloaded ?? current.downloaded,
      total: event.payload.total ?? current.total,
    }));
  });
  listen("new-session", () => newSession.set(true));
  effect(() => {
    if (!notice()) return;
    const timer = setTimeout(() => notice.set(null), 4000);
    return () => clearTimeout(timer);
  });
  // The first workspace: the remembered one, else the first recent.
  let initialWorkspaceChosen = false;
  effect(() => {
    const current = state();
    if (initialWorkspaceChosen || activePath() || !current) return;
    const saved = localStorage.getItem("jouzu.chat.workspace");
    const first = current.recent.find(item => item.path === saved)?.path ?? current.recent[0]?.path;
    if (first) { initialWorkspaceChosen = true; activePath.set(first); }
  });
  effect(() => {
    const path = activePath();
    if (path) localStorage.setItem("jouzu.chat.workspace", path);
  });
  effect(() => {
    if (settingsOpen()) {
      if (!setup() && !busy()) void configure({ action: "status" });
      void readEnvironment();
    }
  });
  function onBootChange(booting: boolean) {
    entryBooting.set(booting);
    if (!booting) { entryReady.set(true); return; }
    // A session that never connects must not keep the window behind the loader.
    if (entryReady()) return;
    setTimeout(() => { if (!entryReady()) { entryReady.set(true); entryBooting.set(false); } }, 8000);
  }
  async function recoverRuntime() {
    operation.set("saving"); error.set(null);
    try {
      await invoke("repair_jouzu");
      components.set(await invoke<Components>("component_versions"));
      await refresh();
      await refreshDiagnostics();
    } catch (failure) { error.set(String(failure)); }
    finally { operation.set(null); }
  }

  return {
    locale, theme, t, activePath, newSession, sessionRevision, chatBusy, entryBooting, entryReady, catalogRefreshing,
    state, error, statusError, statusCopied, copyStatusError, operation, busy, version, diagnostics, components, settingsTab, settingsOpen,
    updateFocus, repair, connectionMode, providerQuery, addingConnection, setup, runtimePresent, runtimeUpdating,
    prepare, device, providerDevice, envRows, editingEnv, envLoaded, custom, provider, token, notice,
    jouzuUpdater, updater, gitBash, runtime,
    configure, readStatus, runPrepare, updateRuntime, readEnvironment, saveEnvironment, addFolders,
    chooseFolder, forget, repairConsole, openUpdatePanel, refreshModelCatalog, refresh, refreshDiagnostics,
    loadComponents, requestSessionRestart, onBootChange, recoverRuntime, logEvent,
  };
}

export type AppStore = ReturnType<typeof createAppStore>;
