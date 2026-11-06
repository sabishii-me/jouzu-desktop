import { invoke } from "./host/invoke";
import { confirm } from "./host/dialog";
import { ComponentSection, createComponent } from "./components/component-row";
import { messages, type Locale } from "./i18n";

interface Resolution { name: string; path: string | null }
export interface CommandEntryState {
  directory: string;
  shims: boolean;
  onPath: boolean;
  position: "absent" | "first" | "later";
  first: boolean;
  shadowed: boolean;
  commands: Resolution[];
}

const within = (path: string, directory: string) => {
  const normal = (value: string) => value.replaceAll(String.fromCharCode(92), "/").toLowerCase();
  return normal(path).startsWith(normal(directory) + "/");
};

/** The terminal command: jz and jouzu, which the Launcher puts on the PATH when it installs. */
export function CommandEntrySection(props: { locale: Locale }) {
  const t = () => messages[props.locale];
  const api = createComponent<CommandEntryState>("command_entry_report");
  const checking = <ComponentSection title={t().commandEntry} status={t().checking} busy={api.busy()} error={api.error()} installLabel={t().commandEntryInstall} />;
  return <If when={api.value()} else={checking}>{state => {
    // A command another program provides is not Jouzu's to replace without asking, and a command that does
    // not run is repaired rather than installed again.
    const provided = () => state().commands.some(entry => entry.path && !within(entry.path, state().directory));
    const installed = () => state().shims && (state().first || (state().onPath && !provided()));
    const install = () => void api.run(async () => {
      if (provided() && !await confirm(t().commandEntryConfirm, { kind: "warning" })) return state();
      return invoke<CommandEntryState>("command_entry_use");
    });
    // One action, and which one it is follows the state: the file that does not answer is repaired, a
    // command that is not the one answering is installed, and an answer of Jouzu's is given back.
    const action = () => !state().shims
      ? { label: t().commandEntryRepair, run: () => void api.run(() => invoke<CommandEntryState>("command_entry_repair")) }
      : installed()
        ? { label: t().commandEntryRemove, run: () => void api.run(() => invoke<CommandEntryState>("command_entry_remove")) }
        : { label: t().commandEntryInstall, run: install };
    return <ComponentSection
      title={t().commandEntry}
      status={!state().shims ? t().commandEntryBroken : installed() ? t().commandEntryOn : t().gitBashMissing}
      tone={state().shims ? "ok" : "missing"}
      busy={api.busy()} error={api.error()}
      install={action().run}
      installLabel={action().label}
    />;
  }}</If>;
}
