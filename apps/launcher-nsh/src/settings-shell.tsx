import { View, Text, computed } from "nsh";
import { invoke } from "./host/invoke";
import { confirm } from "./host/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Select } from "./ui/select";
import { Dialog } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { ScrollArea } from "./ui/scroll-area";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Icon, type IconName } from "./ui/icons";
import { ProviderSettings } from "./settings-dialog";
import { ToolsPanel } from "./tools-panel";
import { GitBashSection } from "./git-bash-section";
import { TerminalSection } from "./terminal-section";
import { CommandEntrySection } from "./command-entry-section";
import { ReportSection } from "./report-section";
import { UpdatePreview, type Phase } from "./update-preview";
import { recoveryText } from "./recovery-text";
import { locales, type Locale } from "./i18n";
import type { AppStore } from "./app-store";
import { cn } from "./lib";

const TABS: { id: string; icon: IconName; label: (t: AppStore["t"] extends () => infer M ? M : never) => string }[] = [
  { id: "providers", icon: "KeyRound", label: t => t.providers },
  { id: "tools", icon: "Wrench", label: t => t.toolsTab },
  { id: "appearance", icon: "Palette", label: t => t.appearance },
  { id: "environment", icon: "SlidersHorizontal", label: t => t.environment },
  { id: "general", icon: "Languages", label: t => t.general },
  { id: "system", icon: "RefreshCw", label: t => t.system },
];

export function SettingsShell(props: { app: AppStore }) {
  const app = props.app;
  const t = app.t;
  return (
    <Dialog
      open={app.settingsOpen()}
      onOpenChange={value => {
        if (!value && app.device()) void invoke("cancel_control");
        if (!value) app.updateFocus.set(null);
        app.settingsOpen.set(value);
      }}
      className="h-[560px] max-w-3xl flex-col gap-0 overflow-hidden p-0"
    >
      <If when={!!app.error()}>
        <Text class="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">{app.error() ?? ""}</Text>
      </If>
      <Tabs value={app.settingsTab()} onValueChange={value => app.settingsTab.set(value)} className="min-h-0 flex-1 flex-row gap-0">
        <View class="w-44 shrink-0 flex-col border-r border-border bg-muted/60 p-3">
          <View class="mb-5 flex-row items-center gap-2 px-2 pt-2">
            <Icon name="Settings" size={16} />
            <Text class="text-sm font-semibold">{t().settings}</Text>
          </View>
          <TabsList className="h-auto w-full flex-col items-stretch gap-1 bg-transparent p-0">
            <Each of={TABS} key={tab => tab.id}>
              {(tab) => (
                <TabsTrigger value={tab().id} className="min-h-10 justify-start gap-2 px-3">
                  <Icon name={tab().icon} size={16} />
                  <Text class="text-sm">{tab().label(t())}</Text>
                </TabsTrigger>
              )}
            </Each>
          </TabsList>
        </View>
        <ScrollArea className="min-w-0 flex-1">
          <View class="flex-col px-6 pb-6 pt-8">
            <TabsContent value="providers" className="m-0 gap-4">
              <ProviderSettings app={app} inline={false} />
            </TabsContent>
            <TabsContent value="tools" className="m-0 gap-4">
              <ToolsPanel />
            </TabsContent>
            <TabsContent value="environment" className="m-0 gap-4">
              <EnvironmentTab app={app} />
            </TabsContent>
            <TabsContent value="appearance" className="m-0 gap-4">
              <Card className="border-border shadow-none">
                <CardHeader><CardTitle>{t().appearance}</CardTitle><CardDescription>{t().appearanceHint}</CardDescription></CardHeader>
                <CardContent>
                  <Select
                    value={app.theme()}
                    onValueChange={value => app.theme.set(value as "dark" | "light" | "system")}
                    items={[{ value: "system", label: t().themeSystem }, { value: "dark", label: t().themeDark }, { value: "light", label: t().themeLight }]}
                    aria-label={t().appearance}
                    className="w-full"
                  />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="general" className="m-0 gap-4">
              <GeneralTab app={app} />
            </TabsContent>
            <TabsContent value="system" className="m-0 gap-4">
              <SystemTab app={app} />
            </TabsContent>
          </View>
        </ScrollArea>
      </Tabs>
      <View class="absolute right-2 top-2">
        <Button variant="ghost" className="px-3" aria-label={t().dismiss} onClick={() => app.settingsOpen.set(false)}>
          <Icon name="X" size={16} />
        </Button>
      </View>
    </Dialog>
  );
}
function EnvironmentTab(props: { app: AppStore }) {
  const app = props.app;
  const t = app.t;
  const patchRow = (index: number, change: Partial<{ name: string; value: string; enabled: boolean }>) =>
    app.envRows.update(rows => rows.map((row, position) => position === index ? { ...row, ...change } : row));
  return (
    <Card className="border-border shadow-none">
      <CardHeader><CardTitle>{t().environment}</CardTitle><CardDescription>{t().envHint}</CardDescription></CardHeader>
      <CardContent className="gap-3">
        <Each of={app.envRows()} key="index">
          {(row, index) => (
            <View class="flex-col gap-2 rounded-lg border border-border p-3">
              <View class="flex-row items-center gap-2">
                <If when={app.editingEnv() === index()} else={
                  <Text class="min-w-0 flex-1 truncate text-sm font-medium">{row().name}</Text>
                }>
                  <Input aria-label={t().variableName} placeholder={t().variableName} value={row().name} disabled={app.busy()} onChange={event => patchRow(index(), { name: event.target.value })} />
                </If>
                <Button variant="ghost" disabled={app.busy()} onClick={() => app.editingEnv.set(index())}>{t().editValue}</Button>
                <Switch aria-label={t().enabled} checked={row().enabled} disabled={app.busy()} onCheckedChange={enabled => patchRow(index(), { enabled })} />
                <Button variant="ghost" disabled={app.busy()} aria-label={t().deleteEntry} onClick={() => { app.envRows.update(rows => rows.filter((_, position) => position !== index())); app.editingEnv.set(null); }}>
                  <Icon name="X" size={16} />
                </Button>
              </View>
              <If when={app.editingEnv() === index()}>
                <Input type="password" aria-label={t().variableValue} placeholder={t().variableValue} value={row().value} disabled={app.busy()} onChange={event => patchRow(index(), { value: event.target.value })} />
              </If>
            </View>
          )}
        </Each>
        <View class="flex-row gap-2">
          <Button variant="outline" disabled={!app.envLoaded() || app.busy()} onClick={() => { app.editingEnv.set(app.envRows().length); app.envRows.update(rows => [...rows, { name: "", value: "", enabled: true }]); }}>
            <Icon name="Plus" size={16} />
            <Text class="text-sm font-medium">{t().addEntry}</Text>
          </Button>
          <View class="flex-1" />
          <Button disabled={!app.envLoaded() || app.busy()} onClick={() => void app.saveEnvironment()}>{t().save}</Button>
        </View>
      </CardContent>
    </Card>
  );
}

function GeneralTab(props: { app: AppStore }) {
  const app = props.app;
  const t = app.t;
  return (
    <Card className="border-border shadow-none">
      <CardHeader><CardTitle>{t().language}</CardTitle><CardDescription>{t().languageHint}</CardDescription></CardHeader>
      <CardContent>
        <Select
          value={app.locale()}
          onValueChange={value => app.locale.set(value as Locale)}
          items={Object.entries(locales).map(([key, label]) => ({ value: key, label }))}
          aria-label={t().language}
          className="w-full"
        />
        <View class="mt-6 flex-col gap-3 border-t border-border pt-5">
          <View class="flex-row items-center justify-between gap-4">
            <Label>{t().profile}</Label>
            <Switch aria-label={t().profile} disabled={app.busy() || !app.setup()} checked={app.setup()?.profile === "ja"} onCheckedChange={enabled => void app.configure({ action: "profile", profile: enabled ? "ja" : "core" })} />
          </View>
          <Text class="text-sm leading-relaxed text-muted-foreground">{t().profileHint}</Text>
          <Text class="text-sm leading-relaxed text-muted-foreground">{t().profileOffHint}</Text>
        </View>
      </CardContent>
    </Card>
  );
}

function SystemTab(props: { app: AppStore }) {
  const app = props.app;
  const t = app.t;
  const jouzu = app.jouzuUpdater;
  const livePhase = computed<Phase>(() => {
    const phase = jouzu.phase();
    return phase === "preparing" || phase === "verifying" || phase === "activating" || phase === "staged" ? "installing" : phase as Phase;
  });
  const unavailable = () => t().unavailable;
  return (
    <View class="flex-col gap-4">
      <UpdatePreview
        locale={app.locale()}
        focusIndex={app.updateFocus()}
        live={{
          phases: () => [livePhase(), "idle"],
          versions: () => [app.components()?.jouzu ?? unavailable(), app.version() ?? unavailable()],
          targets: () => [jouzu.version(), null],
          progress: () => jouzu.busy() ? jouzu.progress() : undefined,
          configured: () => [!!app.components()?.jouzuUpdaterConfigured, false],
          errors: () => [jouzu.error(), null],
          notes: () => [jouzu.notes() ?? "", ""],
          sources: () => [jouzu.notesSource() ?? "", ""],
          repair: app.components()?.jouzu ? undefined : {
            label: () => recoveryText[app.locale()].action,
            run: () => {
              void (async () => {
                if (!await confirm(recoveryText[app.locale()].description, { title: recoveryText[app.locale()].title, kind: "warning" })) return;
                await app.recoverRuntime();
              })();
            },
          },
          check: () => { void jouzu.check(); },
          install: index => { if (index === 0) void jouzu.install(); },
        }}
      />
      <If when={app.state()?.platform === "windows"}>
        <View class="flex-col rounded-lg border border-border">
          <GitBashSection locale={app.locale()} api={app.gitBash} />
          <TerminalSection locale={app.locale()} />
          <CommandEntrySection locale={app.locale()} />
        </View>
      </If>
      <If when={(app.diagnostics()?.crashes.length ?? 0) > 0}>
        <Card className="border-border shadow-none">
          <CardHeader><CardTitle>{t().crashTitle}</CardTitle><CardDescription>{t().crashHint}</CardDescription></CardHeader>
          <CardContent className="gap-3">
            <Each of={app.diagnostics()?.crashes ?? []} key={record => record.path}>
              {(record) => (
                <View class="flex-col gap-1 rounded-lg border border-border p-3">
                  <Text class="text-xs text-muted-foreground">{`${new Date(record().time * 1000).toLocaleString()} | ${record().version} | ${record().location}`}</Text>
                  <Text class="text-sm">{record().message}</Text>
                  <View class="flex-row justify-end">
                    <Button variant="ghost" onClick={async () => { try { await invoke("crash_dismiss", { path: record().path }); } finally { await app.refreshDiagnostics(); } }}>{t().dismiss}</Button>
                  </View>
                </View>
              )}
            </Each>
          </CardContent>
        </Card>
      </If>
      <ReportSection locale={app.locale()} />
    </View>
  );
}
