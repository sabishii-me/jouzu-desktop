import { Backend } from "jouzu-desktop/native";
import { AlertDialog } from "nsh/base";

/** The folder picker the launcher uses to add workspaces; null when cancelled. */
export async function openFolder(): Promise<string | null> {
  const picked = await Backend.pickFolders();
  return picked && picked.length ? picked[0] : null;
}

/** The save dialog artifact copies use; null when cancelled. */
export async function savePath(fileName: string): Promise<string | null> {
  return Backend.pickSavePath(fileName);
}

/** A native confirmation, the shape @tauri-apps/plugin-dialog's confirm had. */
export async function confirm(message: string, options?: { title?: string; kind?: string }): Promise<boolean> {
  const result = await AlertDialog.show({
    title: options?.title ?? null,
    description: message,
    actions: [
      { id: "ok", label: "OK" },
      { id: "cancel", label: "Cancel", role: "cancel" },
    ],
  });
  return result.action === "ok";
}