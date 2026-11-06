import { View, Text, Image } from "nsh";
import { Window, titleBar } from "nsh/desktop";
import jouzuIcon from "../assets/jouzu.svg";
import { APP_VERSION, developmentFlag } from "../host/window";

const HEIGHT = 40;

/**
 * The branded title bar the baseline drew over a draggable Tauri region. NSH
 * hides the system title bar but keeps the platform's caption buttons
 * (minimize / maximize / close) in the area `titleBar()` reports, so the bar
 * reserves that space and makes the rest a window-drag region. Double-click
 * maximizes, as a native title bar does.
 */
export function TitleBar() {
  Window.setTitleBar({ style: "hidden", height: HEIGHT });
  Window.setTitle("Jouzu");
  return (
    <View
      class="shrink-0 flex-row items-center gap-2 border-b border-border bg-background"
      style={{ height: HEIGHT, paddingLeft: titleBar().left + 12, paddingRight: titleBar().right + 12 }}
      desktop={{ windowDrag: true }}
    >
      <Image src={jouzuIcon} style={{ width: 22, height: 22 }} />
      <Text class="text-sm font-semibold tracking-tight">Jouzu</Text>
      <If when={developmentFlag()}>
        <Text class="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">{`DEV ${APP_VERSION}`}</Text>
      </If>
      <View class="flex-1" />
    </View>
  );
}