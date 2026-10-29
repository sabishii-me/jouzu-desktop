import { test, expect, type Page } from "@playwright/test";

// Drives the Tools tab against a stateful settings backend.
async function openTools(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("jouzu.ui.language", "en");
    (window as any).isTauri = true;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    let settings = {
      image: { enabled: true, provider: "shisa", model: "gemini-3-pro-image", size: "1K", maxImages: 3 },
      reviewTools: ["generate_image"],
    };
    (window as any).__SAVED__ = [];
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "launcher_state") return { ready: true, bash: true, platform: "windows", recent: [] };
        if (command === "component_versions") return { jouzu: "0.1.18", development: true };
        if (command === "environment_read") return [];
        if (command === "control_request") {
          return { schemaVersion: 1, modelReady: true, profile: "core", account: { signedIn: true }, credentials: [], customProviders: [], providers: [{ id: "openai", name: "OpenAI" }], models: [] };
        }
        if (command === "tools_settings_read") return settings;
        if (command === "tools_settings_save") {
          settings = { ...settings, image: args.image };
          (window as any).__SAVED__.push(args.image);
          return settings;
        }
        if (command === "image_providers") return { providers: [{ id: "shisa", label: "Shisa.AI" }] };
        if (command === "image_models") return { models: ["gemini-3-pro-image", "gemini-3.1-flash-image"] };
        if (command.includes("version")) return "0.1.0";
        return 1;
      },
    };
  });
  await page.goto("http://localhost:1420");
}

test("the Tools tab edits the image tool settings", async ({ page }) => {
  await openTools(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab", { name: "Tools" })).toBeVisible();
  await dialog.getByRole("tab", { name: "Tools" }).click();
  await expect(dialog.getByText("Image generation", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Image provider")).toHaveValue("shisa");
  await expect(dialog.getByLabel("Image model")).toHaveValue("gemini-3-pro-image");
  await expect(dialog.getByLabel("Images per call")).toHaveValue("3");
  await expect(dialog.getByText("Reviewed calls: generate_image")).toBeVisible();

  await dialog.getByLabel("Image model").selectOption("gemini-3.1-flash-image");
  await expect.poll(async () => await page.evaluate(() => (window as any).__SAVED__.at(-1)?.model ?? null)).toBe("gemini-3.1-flash-image");
  await expect(dialog.getByLabel("Image model")).toHaveValue("gemini-3.1-flash-image");
});
