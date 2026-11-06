import { Window } from "nsh/desktop";
import { Backend } from "jouzu-desktop/native";

/** The app version, kept in step with nsh.json and the crate. */
export const APP_VERSION = "1.0.15";

export async function getVersion(): Promise<string> {
  return APP_VERSION;
}

/** The window controls the custom header used; NSH keeps the system title bar. */
export const appWindow = {
  minimize(): void {
    Window.minimize();
  },
  toggleMaximize(): void {
    Window.toggleMaximize();
  },
  close(): void {
    Backend.shutdown();
    Window.close();
  },
};