import { effect, signal, Text, View } from "nsh";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogTitle } from "./ui/dialog";
import { Icon } from "./ui/icons";
import { Progress } from "./ui/progress";
import type { Locale } from "./i18n";

/** The two update rows: Jouzu first, then the launcher that carries them. */
const labels: Record<Locale, {
  title: string; description: string; check: string; launcher: string; currentVersion: string;
  available: string; availableTag: string; upToDate: string; updateJouzu: string; updateLauncher: string;
  checking: string; downloading: string; installing: string; updated: string;
  checkFailed: string; retry: string; restart: string; cancel: string; unavailable: string;
}> = {
  en: {
    title: 'System', description: 'Jouzu, the launcher, and the tools they need.', check: 'Check for updates',
    launcher: 'Launcher', currentVersion: 'Current version', available: 'Available', availableTag: 'Update available', upToDate: 'Up to date',
    updateJouzu: 'Update Jouzu', updateLauncher: 'Update and restart', checking: 'Checking…',
    downloading: 'Downloading…', installing: 'Installing…', updated: 'Updated',
    checkFailed: 'Could not check for updates', retry: 'Retry',
    restart: 'The launcher restarts after updating.', cancel: 'Cancel',
    unavailable: 'Online updates are unavailable for this version.',
  },
  ja: {
    title: 'システム', description: 'Jouzu、ランチャー、および必要なツールの状態です。', check: '更新を確認',
    launcher: 'ランチャー', currentVersion: '現在のバージョン', available: '更新先', availableTag: '更新があります', upToDate: '最新です',
    updateJouzu: 'Jouzu を更新', updateLauncher: '更新して再起動', checking: '確認中…',
    downloading: 'ダウンロード中…', installing: 'インストール中…', updated: '更新しました',
    checkFailed: '更新を確認できませんでした', retry: '再試行',
    restart: '更新後にランチャーを再起動します。', cancel: 'キャンセル',
    unavailable: 'このバージョンではオンライン更新を利用できません。',
  },
  'zh-Hans': {
    title: '系统', description: '查看 Jouzu、启动器以及所需工具的状态。', check: '检查更新',
    launcher: '启动器', currentVersion: '当前版本', available: '可更新至', availableTag: '有可用更新', upToDate: '已是最新',
    updateJouzu: '更新 Jouzu', updateLauncher: '更新并重启', checking: '正在检查…',
    downloading: '正在下载…', installing: '正在安装…', updated: '更新完成',
    checkFailed: '暂时无法检查更新', retry: '重试',
    restart: '更新后将重新启动启动器。', cancel: '取消',
    unavailable: '此版本暂不支持在线更新。',
  },
  'zh-Hant': {
    title: '系統', description: '查看 Jouzu、啟動器以及所需工具的狀態。', check: '檢查更新',
    launcher: '啟動器', currentVersion: '目前版本', available: '可更新至', availableTag: '有可用更新', upToDate: '已是最新',
    updateJouzu: '更新 Jouzu', updateLauncher: '更新並重新啟動', checking: '正在檢查…',
    downloading: '正在下載…', installing: '正在安裝…', updated: '更新完成',
    checkFailed: '暫時無法檢查更新', retry: '重試',
    restart: '更新後將重新啟動啟動器。', cancel: '取消',
    unavailable: '此版本暫不支援線上更新。',
  },
};

const noteText: Record<Locale, [string, string, string]> = {
  en: ["What's new", 'Source:', 'No description was published for this version.'],
  ja: ['変更点', '出典:', 'このバージョンの説明は公開されていません。'],
  'zh-Hans': ['更新内容', '来源：', '此版本未发布说明。'],
  'zh-Hant': ['更新內容', '來源：', '此版本未發布說明。'],
};

export type Phase = 'available' | 'current' | 'checking' | 'downloading' | 'installing' | 'complete' | 'error' | 'idle';

/**
 * The live state the launcher reports. Every data field is an accessor so the
 * rows follow the parent's signals (the parent component runs once, so plain
 * values would freeze at their first reading). `repair.label` is an accessor
 * too because it is locale-dependent text.
 */
export interface UpdateViewState {
  phases: () => Phase[];
  versions: () => string[];
  targets: () => (string | null)[];
  progress?: () => number | undefined;
  configured: () => boolean[];
  errors: () => (string | null)[];
  notes: () => string[];
  sources: () => string[];
  check: () => void;
  install: (index: number) => void;
  /** The Jouzu row offers this when the application files are not there to run. */
  repair?: { label: () => string; run: () => void };
}

export interface UpdatePreviewProps {
  locale: Locale;
  live: UpdateViewState;
  focusIndex?: number | null;
}

const noteLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);

/** The update rows, driven by the state the launcher reports. */
export function UpdatePreview(props: UpdatePreviewProps) {
  const t = () => labels[props.locale];
  const nt = () => noteText[props.locale];
  const live = props.live;
  const confirmRestart = signal(false);
  const highlight = signal<number | null>(null);
  // A jump from the header lands on the row that actually has something waiting, so the guidance is one step, not a search.
  // NSH has no scrollIntoView; the highlight ring is kept, the smooth scroll is not (see port report).
  effect(() => {
    const focus = props.focusIndex;
    if (focus === null || focus === undefined) return;
    highlight.set(focus);
    const timer = setTimeout(() => highlight.set(null), 2400);
    return () => clearTimeout(timer);
  });
  const working = ['checking', 'downloading', 'installing'];
  const busy = () => live.phases().some(phase => working.includes(phase));
  const start = (index: number) => (index === 0 ? live.install(index) : confirmRestart.set(true));
  return <View class="flex-col gap-6">
    <Dialog open={confirmRestart()} onOpenChange={confirmRestart.set} className="sm:max-w-sm">
      <DialogTitle>{t().updateLauncher}</DialogTitle>
      <DialogDescription>{t().restart}</DialogDescription>
      <View class="flex-row justify-end gap-2">
        <Button variant="outline" onClick={() => confirmRestart.set(false)}>{t().cancel}</Button>
        <Button onClick={() => { confirmRestart.set(false); live.install(1); }}>{t().updateLauncher}</Button>
      </View>
    </Dialog>
    <View class="flex-row flex-wrap items-start justify-between gap-3">
      <View class="flex-col">
        <Text class="text-lg font-semibold">{t().title}</Text>
        <Text class="mt-1 text-sm text-muted-foreground">{t().description}</Text>
      </View>
      <Button variant="ghost" className="h-9 w-9 p-0" aria-label={t().check} title={t().check} disabled={busy()} onClick={live.check}>
        <Icon name="RefreshCw" size={16} className={live.phases().includes('checking') ? 'animate-spin' : ''} />
      </Button>
    </View>
    <View class="flex-col rounded-lg border border-border px-5">
      <Each of={live.phases()} key="index">{(phase, index) => (
        <View role="region" accessibilityLabel={index() === 0 ? 'Jouzu' : t().launcher}
          class={`flex min-h-32 flex-col gap-2 py-4 transition-shadow ${index() > 0 ? 'border-t border-border' : ''} ${highlight() === index() ? 'ring-2 ring-primary ring-offset-2 ring-offset-card' : ''}`}>
          <View class="flex-row flex-wrap items-center justify-between gap-3">
            <View class="flex-col">
              <View class="flex-row items-center gap-2">
                <Text class="font-medium">{index() === 0 ? 'Jouzu' : t().launcher}</Text>
                <If when={phase() === 'available'}>
                  <Text class="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{t().availableTag}</Text>
                </If>
              </View>
              <Text class="mt-1 text-sm text-muted-foreground">{t().currentVersion} {live.versions()[index()]}</Text>
              <If when={index() === 0 && live.repair}>
                <View class="mt-2">
                  <Button variant="outline" disabled={busy()} onClick={live.repair?.run}>{live.repair?.label()}</Button>
                </View>
              </If>
            </View>
            <If when={phase() === 'available'} else={
              <If when={phase() === 'error'} else={
                <View class="flex-row items-center gap-2">
                  <If when={working.includes(phase())}>
                    <Icon name="LoaderCircle" size={16} className="animate-spin" />
                  </If>
                  <Text class="text-sm text-muted-foreground">{phase() === 'current' ? t().upToDate : phase() === 'complete' ? t().updated : phase() === 'checking' ? t().checking : phase() === 'downloading' ? t().downloading : phase() === 'installing' ? t().installing : ''}</Text>
                </View>
              }>
                <Button variant="outline" className="h-9 w-9 p-0" aria-label={t().retry} title={t().retry} disabled={busy()} onClick={() => (live.targets()[index()] ? start(index()) : live.check())}>
                  <Icon name="RefreshCw" size={16} />
                </Button>
              </If>
            }>
              <Button disabled={busy()} onClick={() => start(index())}>
                <Icon name="Download" size={16} />
                <Text class="text-sm font-medium">{index() === 0 ? t().updateJouzu : t().updateLauncher}</Text>
              </Button>
            </If>
          </View>
          <View class="flex-col gap-2">
            <If when={!live.configured()[index()]}>
              <Text class="text-sm text-muted-foreground">{t().unavailable}</Text>
            </If>
            <If when={phase() === 'available'}>
              <Text class="text-sm text-muted-foreground">{t().available} {live.targets()[index()]}</Text>
            </If>
            <If when={phase() === 'available' || phase() === 'complete'}>
              <If when={live.notes()[index()]} else={
                <Text class="text-xs text-muted-foreground">{nt()[2]}</Text>
              }>
                <View class="max-h-40 flex-col overflow-auto rounded-md bg-muted/40 p-2">
                  <Text class="text-xs font-medium">{nt()[0]}</Text>
                  <View class="mt-1 flex-col gap-1">
                    <Each of={noteLines(live.notes()[index()])} key="index">{line => (
                      <If when={line().startsWith('### ')} else={
                        <If when={line().startsWith('- ')} else={
                          <Text class="text-xs text-muted-foreground">{line()}</Text>
                        }>
                          <View class="flex-row gap-2">
                            <Text class="text-xs text-muted-foreground">•</Text>
                            <Text class="text-xs text-muted-foreground">{line().slice(2)}</Text>
                          </View>
                        </If>
                      }>
                        <Text class="text-xs font-medium text-muted-foreground">{line().slice(4)}</Text>
                      </If>
                    )}</Each>
                  </View>
                  <If when={live.sources()[index()]}>
                    <Text class="mt-1 text-[10px] text-muted-foreground/70">{nt()[1]} {live.sources()[index()]}</Text>
                  </If>
                </View>
              </If>
            </If>
            <If when={phase() === 'error'}>
              <Text role="alert" class="text-sm text-destructive">{live.errors()[index()] ?? t().checkFailed}</Text>
            </If>
            <If when={phase() === 'downloading' || phase() === 'installing'}>
              <Progress value={phase() === 'downloading' ? live.progress?.() : undefined} />
            </If>
          </View>
        </View>
      )}</Each>
    </View>
  </View>;
}
