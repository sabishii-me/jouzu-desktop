import { View, Text } from "nsh";
import { Icon, type IconName } from "./ui/icons";

interface Entry {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  available: boolean;
}

const ENTRIES: Entry[] = [
  { id: "artifacts", title: "Artifacts", description: "Images and files produced in this session.", icon: "Images", available: true },
  { id: "files", title: "Workspace files", description: "Browse files in this session's workspace.", icon: "FolderOpen", available: true },
  { id: "terminal", title: "New terminal", description: "Run commands in the session workspace.", icon: "SquareTerminal", available: false },
];

/** The pane's Start tab: pick which view to open, like DSH's session Start. */
export function PanelStart(props: { onOpen: (id: string) => void }) {
  return (
    <View class="h-full flex-col items-center justify-center gap-6 p-6">
      <Icon name="Compass" size={48} className="opacity-30" />
      <View class="w-full max-w-sm flex-col gap-1">
        <Each of={ENTRIES} key={entry => entry.id}>
          {(entry) => (
            <View
              class="w-full flex-row items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted disabled:opacity-40"
              role="button"
              accessibilityLabel={entry().title}
              onPress={() => { if (entry().available) props.onOpen(entry().id); }}
            >
              <Icon name={entry().icon} size={16} className="mt-0.5" />
              <View class="min-w-0 flex-1 flex-col">
                <Text class="text-sm">{entry().title}</Text>
                <Text class="text-xs text-muted-foreground">{entry().description}</Text>
              </View>
              <If when={!entry().available}>
                <Text class="mt-1 text-[10px] text-muted-foreground">Soon</Text>
              </If>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}