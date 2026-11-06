import { mount, View, Text, Image, computed } from "nsh";
import { Backend } from "jouzu-desktop/native";
import { loadStorage } from "./src/host/storage";
import { errorText } from "./src/host/invoke";
import { appWindow } from "./src/host/window";
import { Button } from "./src/ui/button";
import { Progress } from "./src/ui/progress";
import { Dialog, DialogTitle, DialogDescription } from "./src/ui/dialog";
import { Icon } from "./src/ui/icons";
import { JouzuLoader } from "./src/ui/jouzu-loader";
import { ChatWorkspace } from "./src/chat-workspace";
import { ProviderSettings } from "./src/settings-dialog";
import { SettingsShell } from "./src/settings-shell";
import { createAppStore, type AppStore } from "./src/app-store";
import jouzuIcon from "./src/assets/jouzu.svg";
import { signal } from "nsh";

/**
 * The launcher shell. The runtime state machine decides the window:
 * probe → prepare (automatic install) → connect a model → the workspace.
 */
function Shell() {
  const ready = signal(false);
  const bootError = signal<string | null>(null);
  void (async () => {
    try {
      await loadStorage();
      await Backend.init();
      ready.set(true);
    } catch (failure) {
      bootError.set(errorText(failure));
    }
  })();
  return (
    <View class="flex-1 bg-background">
      <If when={!!bootError()} else={
        <If when={ready()} else={
          <View class="flex-1 items-center justify-center">
            <JouzuLoader />
          </View>
        }>
          <App />
        </If>
      }>
        <View class="flex-1 items-center justify-center p-6">
          <Text class="text-sm text-destructive">{bootError() ?? ""}</Text>
        </View>
      </If>
    </View>
  );
}

/** The onboarding banner: mark, wordmark, one line of context. */
function Banner(props: { title: string; fill?: boolean }) {
  return (
    <View class={props.fill ? "min-h-0 flex-1 items-center justify-center border-b border-border bg-primary/10 px-6" : "min-h-56 shrink-0 items-center justify-center border-b border-border bg-primary/10 px-6"}>
      <View class="flex-col items-center gap-3">
        <Image src={jouzuIcon} style={{ width: 80, height: 80 }} />
        <Text class="text-2xl font-semibold tracking-tight">Jouzu Desktop</Text>
        <Text class="text-sm text-muted-foreground">{props.title}</Text>
      </View>
    </View>
  );
}

function App() {
  const app = createAppStore();
  const t = app.t;
  const preparePercent = computed(() => {
    const prepare = app.prepare();
    if (prepare.phase === "node" && prepare.total) return Math.max(3, (prepare.downloaded / prepare.total) * 40);
    if (prepare.phase === "packages") return 55;
    if (prepare.phase === "verify") return 90;
    if (prepare.phase === "tools") return 95;
    return 6;
  });
  const prepareLabel = computed(() => {
    const prepare = app.prepare();
    if (prepare.error) return t().prepareFailed;
    if (prepare.phase === "node") return t().prepareNode;
    if (prepare.phase === "packages") return t().preparePackages;
    if (prepare.phase === "verify") return t().prepareVerify;
    if (prepare.phase === "tools") return t().prepareTools;
    return t().prepareTitle;
  });

  return (
    <View class="flex-1 flex-col overflow-hidden bg-background text-foreground">
      <If when={app.runtimePresent() === null} else={
        <If when={app.runtimePresent() === false} else={
          <If when={app.setup()?.modelReady === false} else={
            <MainScreen app={app} />
          }>
            {/* The one setup page left is connecting a model. */}
            <View class="flex-1 flex-col">
              <Banner title={t().setupConnect} />
              <View class="min-h-0 flex-1 items-center px-6 py-8">
                <View class="m-auto w-full max-w-2xl flex-col rounded-2xl border border-border bg-card/70 p-8 shadow-xl">
                  <Text class="mb-6 text-sm leading-relaxed text-muted-foreground">{t().setupHint}</Text>
                  <ProviderSettings app={app} inline />
                </View>
              </View>
            </View>
          </If>
        }>
          {/* The prepare page: banner, one bar, no choices. */}
          <View class="flex-1 flex-col">
            <Banner title={t().prepareTitle} fill />
            <View class="shrink-0 items-center px-6 pb-16 pt-8">
              <View class="w-full max-w-xl flex-col gap-3">
                <View class="flex-row items-baseline justify-between">
                  <Text class="text-sm font-medium">{prepareLabel()}</Text>
                  <Text class="text-xs text-muted-foreground">
                    {app.prepare().phase === "node" && app.prepare().total ? `${Math.round(app.prepare().downloaded / 1048576)} / ${Math.round(app.prepare().total! / 1048576)} MB` : ""}
                  </Text>
                </View>
                <Progress value={app.prepare().phase === "packages" && !app.prepare().error ? null : preparePercent()} className="h-2.5" />
                <View class="flex-row items-center justify-between gap-3">
                  <Text class="min-w-0 flex-1 text-xs text-muted-foreground">{app.prepare().error ?? t().prepareHint}</Text>
                  <If when={!!app.prepare().error}>
                    <Button variant="outline" onClick={() => void app.runPrepare()}>{t().retry}</Button>
                  </If>
                </View>
              </View>
            </View>
          </View>
        </If>
      }>
        {/* Connecting: the first status read decides the window. */}
        <View class="flex-1 flex-col">
          <Banner title={t().connecting} fill />
          <View class="shrink-0 items-center gap-4 px-6 pb-14 pt-8">
            <Progress value={null} className="w-full max-w-xl" />
            <If when={!!app.statusError()}>
              <View class="w-full max-w-xl flex-col items-center gap-3">
                <Text class="text-sm text-muted-foreground" role="alert">{t().connectFailed}</Text>
                <View class="w-full flex-row items-center gap-2 rounded-lg border border-border bg-card py-2 pl-3 pr-1">
                  <Text class="select-text min-w-0 flex-1 truncate text-xs text-muted-foreground">{app.statusError() ?? ""}</Text>
                </View>
                <Button onClick={() => void app.readStatus()}>{t().retry}</Button>
              </View>
            </If>
          </View>
        </View>
      </If>
    </View>
  );
}


/** The workspace screen: header-less native window, chat, settings, repair. */
function MainScreen(props: { app: AppStore }) {
  const app = props.app;
  const t = app.t;
  return (
    <View class="flex-1 flex-col overflow-hidden">
      <SettingsShell app={app} />
      <Dialog open={!!app.repair()} onOpenChange={open => { if (!open) app.repair.set(null); }} className="max-w-sm">
        <DialogTitle>{t().consoleRepairTitle}</DialogTitle>
        <DialogDescription>{t().consoleRepairHint}</DialogDescription>
        <View class="flex-row items-center gap-3">
          <If when={!app.repair()?.error} else={
            <Text class="text-sm text-destructive" role="alert">{t().consoleRepairFailed}</Text>
          }>
            <View class="flex-row items-center gap-2">
              <Icon name="LoaderCircle" size={16} className="animate-spin" />
              <Text class="text-sm text-muted-foreground">{t().installingUpdate}</Text>
            </View>
          </If>
          <View class="flex-1" />
          <If when={!!app.repair()?.error}>
            <Button onClick={() => void app.repairConsole()}>{t().retry}</Button>
          </If>
        </View>
      </Dialog>
      <If when={app.entryBooting()}>
        <View class="absolute inset-0 z-40 flex-col bg-background">
          <Banner title={t().connecting} fill />
          <View class="shrink-0 items-center px-6 pb-14 pt-8">
            <Progress value={null} className="w-full max-w-xl" />
          </View>
        </View>
      </If>
      <If when={!!app.error()}>
        <View class="absolute left-1/2 top-4 z-50 w-[640px] max-w-full -translate-x-1/2 flex-row items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-popover p-4 shadow-xl" role="alert">
          <View class="min-w-0 flex-1 flex-col">
            <Text class="text-sm font-medium">{t().error}</Text>
            <Text class="mt-2 text-sm text-muted-foreground">{app.error() ?? ""}</Text>
          </View>
          <Button variant="ghost" className="px-2" aria-label={t().dismiss} onClick={() => app.error.set(null)}>
            <Icon name="X" size={16} />
          </Button>
        </View>
      </If>
      <If when={!!app.runtimeUpdating()}>
        <View class="shrink-0 flex-row items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2">
          <Text class="min-w-0 flex-1 truncate text-sm">
            {app.runtimeUpdating()?.error ? `${t().runtimeUpdateFailed} ${app.runtimeUpdating()!.error}` : t().runtimeUpdating}
          </Text>
          <If when={!!app.runtimeUpdating()?.error}>
            <Button variant="outline" onClick={() => void app.updateRuntime()}>{t().retry}</Button>
          </If>
        </View>
      </If>
      <If when={!!app.activePath()} else={
        <View class="min-h-0 flex-1 items-center justify-center gap-4 p-6">
          <Image src={jouzuIcon} style={{ width: 64, height: 64 }} />
          <Text class="text-xl font-semibold">{t().heading}</Text>
          <Text class="max-w-md text-center text-sm text-muted-foreground">{t().intro}</Text>
          <View class="flex-row items-center gap-2">
            <Button onClick={() => void app.chooseFolder()} disabled={!app.state() || app.busy()}>
              <Icon name="Plus" size={16} />
              <Text class="text-sm font-medium">{t().addFolder}</Text>
            </Button>
            <Button variant="outline" onClick={() => app.settingsOpen.set(true)}>{t().settings}</Button>
          </View>
        </View>
      }>
        <View class="min-h-0 flex-1 flex-row">
          <ChatWorkspace
            path={app.activePath() ?? ""}
            revision={app.sessionRevision()}
            newSession={app.newSession()}
            locked={!!app.runtimeUpdating()}
            onStartSession={() => app.newSession.set(false)}
            onRetry={() => app.sessionRevision.update(value => value + 1)}
            onBusyChange={busy => app.chatBusy.set(busy)}
            onBootChange={booting => app.onBootChange(booting)}
            catalogRefreshing={app.catalogRefreshing()}
            canRefreshModels={app.setup()?.account.signedIn === true}
            onModelsMissing={() => void app.refreshModelCatalog()}
            onRetryModels={() => void app.refreshModelCatalog(true)}
            workspaces={app.state()?.recent ?? []}
            onSelect={path => app.activePath.set(path)}
            onAddFolder={() => void app.chooseFolder()}
            onRemove={id => {
              const workspace = app.state()?.recent.find(item => item.id === id);
              if (workspace) void app.forget(workspace);
            }}
            onSettings={() => app.settingsOpen.set(true)}
            onUpdate={() => app.openUpdatePanel()}
            updateAvailable={!!app.jouzuUpdater.version()}
            updateBusy={app.jouzuUpdater.busy()}
          />
        </View>
      </If>
    </View>
  );
}

mount(Shell);
