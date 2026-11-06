import { mount, signal, Text, View } from "nsh";
import { Backend } from "jouzu-desktop/native";
import { loadStorage } from "./src/host/storage";
import { invoke, errorText } from "./src/host/invoke";
import { JouzuLoader } from "./src/ui/jouzu-loader";

interface LauncherState {
  platform: string;
  recent: { id: string; path: string }[];
  ready: boolean;
  bash: boolean;
  bundled_git: boolean;
}

function App() {
  const state = signal<LauncherState | null>(null);
  const error = signal<string | null>(null);

  void (async () => {
    try {
      await loadStorage();
      await Backend.init();
      state.set(await invoke<LauncherState>("launcher_state"));
    } catch (failure) {
      error.set(errorText(failure));
    }
  })();

  return (
    <View class="flex-1 items-center justify-center gap-4 bg-background p-6">
      <Text class="text-2xl font-semibold tracking-tight text-foreground">Jouzu Desktop</Text>
      <If when={error()}>
        <Text class="text-sm text-destructive">{error()}</Text>
      </If>
      <If when={!error() && !state()}>
        <JouzuLoader />
      </If>
      <If when={state()}>
        <Text class="text-sm text-muted-foreground">
          {state() ? `${state()!.recent.length} workspace(s) · runtime ${state()!.ready ? "ready" : "missing"}` : ""}
        </Text>
      </If>
    </View>
  );
}

mount(App);