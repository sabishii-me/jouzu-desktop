import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

test.use({ channel: process.env.JOUZU_UI_TEST_BROWSER });

const workspace = "C:/Projects/Matrix";
const ids = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const path = (index: number) => `C:/sessions/${ids[index]}.jsonl`;

function history(index: number) {
  if (index === 0) return [];
  if (index === 1) return [{ role: "user", content: [{ type: "text", text: "short question" }] }, { role: "assistant", content: [{ type: "text", text: "short answer" }], stopReason: "endTurn" }];
  if (index === 3) return Array.from({ length: 160 }, (_, turn) => ({
    role: turn % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `long turn ${Math.floor(turn / 2)}` }],
    ...(turn % 2 === 1 ? { stopReason: "endTurn" } : {}),
  }));
  if (index === 4) return [
    { role: "user", content: [{ type: "text", text: "image question" }] },
    { role: "assistant", content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }], stopReason: "endTurn" },
  ];
  if (index === 5) return [{ role: "user", content: [{ type: "text", text: "failed question" }] }, { role: "assistant", content: [], errorMessage: "fixture failure", stopReason: "error" }];
  if (index === 6) return [{ role: "user", content: [{ type: "text", text: "tool question" }] }, { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } }], stopReason: "toolUse" }];
  if (index === 7) return [
    { role: "user", content: [{ type: "text", text: "historical TextGuard question" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "tool-2", name: "read", arguments: { path: "SKILL.md" } }], stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "tool-2", toolName: "read", isError: true, content: [{ type: "text", text: "TextGuard withheld this result from the model: 1 error-level finding." }] },
  ];
  if (index === 11) return [
    { role: "user", content: [{ type: "text", text: "settled TextGuard question" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "tool-4", name: "read", arguments: { path: "SKILL.md" } }], stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "tool-4", toolName: "read", isError: true, content: [{ type: "text", text: "TextGuard withheld this result from the model: 1 error-level finding." }] },
  ];
  return [{ role: "user", content: [{ type: "text", text: `session ${index} question` }] }, { role: "assistant", content: [{ type: "text", text: `session ${index} answer` }], stopReason: "endTurn" }];
}

async function setup(page: Page) {
  await page.addInitScript(({ ids, paths, histories }) => {
    localStorage.setItem("jouzu.ui.language", "en");
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.switchCalls = [];
    w.promptCalls = [];
    if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => `test-${Math.random().toString(16).slice(2)}` });
    const sessions = ids.map((id: string, index: number) => ({ path: paths[index], title: `S${index}`, workspace: "C:/Projects/Matrix", updated: 100 - index, pinned: false, archived: false }));
    let current = "";
    const records: any[] = [];
    const response = (request: any, data?: any) => records.push({ type: "response", id: request.id, command: request.type, success: true, data });
    const sessionFile = () => current ? `C:/sessions/${current}.jsonl` : "C:/sessions/new.jsonl";
    const review = { ok: true, action: "inspect", sessionId: ids[2], mode: "on", items: [{ id: "matrix-review", withheld: true, ticket: "ticket", source: "SKILL.md", digest: "a".repeat(64), severity: "error", review: { source: "SKILL.md", digest: "a".repeat(64), scanner: "fixture", status: "withheld", severity: { error: 1 }, findings: [{ kind: "yara:command_injection" }] }, snapshot: { body: "reviewed body" } }] };
    const liveReview = { ...review, sessionId: ids[7], items: [{ ...review.items[0], id: "live-review", source: "LIVE.md" }] };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any) => {
        if (command === "launcher_state") return { ready: true, bash: true, bundled_git: true, platform: "windows", recent: [{ id: "work", path: "C:/Projects/Matrix", environment: { kind: "windows" } }] };
        if (command === "control_request") return { schemaVersion: 1, modelReady: true, profile: "core", account: { signedIn: false }, credentials: [], customProviders: [], providers: [], models: [] };
        if (command === "component_versions") return { jouzu: "0.3.8", development: true };
        if (command === "chat_sessions") return sessions;
        if (command === "chat_session_messages") return histories[String(args.sessionPath)] ?? [];
        if (command === "textguard_reviews_read") return String(args.sessionId) === ids[2] ? review : null;
        if (command === "textguard_reviews_write" || command === "textguard_reviews_clear") return null;
        if (command === "chat_flow_reports") return [];
        if (command === "chat_session_timing") return { modelMs: 1, toolMs: 1, turns: 1, steps: 1, outputTokens: 1 };
        if (command === "environment_read") return [];
        if (command === "chat_start") return "matrix-test";
        if (command === "chat_poll") return { records: records.splice(0), closed: false };
        if (command === "chat_send") {
          const request = args.request;
          if (request.type === "switch_session") { w.switchCalls.push(request.sessionPath); current = String(request.sessionPath).replace(/^.*[\\/]|\.jsonl$/g, ""); response(request, { cancelled: false }); }
          else if (request.type === "new_session") { current = ""; response(request, { cancelled: false }); }
          else if (request.type === "get_state") response(request, { sessionId: current || "new", sessionFile: sessionFile(), isStreaming: false, model: { name: "Matrix model" } });
          else if (request.type === "get_messages") response(request, { messages: histories[sessionFile()] ?? [] });
          else if (request.type === "get_available_models") response(request, { models: [{ provider: "fixture", id: "deterministic", name: "Matrix model" }] });
          else if (request.type === "get_available_thinking_levels") response(request, { levels: [] });
          else if (request.type === "get_session_stats") response(request, { userMessages: 1, assistantMessages: 1, toolCalls: 0, tokens: { total: 1 } });
          else if (request.type === "prompt") {
            w.promptCalls.push(request.message);
            if (String(request.message).startsWith("/textguard-desktop") && String(request.message).includes("inspect")) {
              const payload = current === ids[7] ? liveReview : { ...review, sessionId: current || "new", items: [] };
              records.push({ type: "extension_ui_request", id: `tg-${w.promptCalls.length}`, method: "notify", message: `JOUZU_TEXTGUARD ${JSON.stringify(payload)}` });
            }
            response(request);
          }
          else response(request);
          return;
        }
        if (command.includes("version")) return "0.3.8";
        return 1;
      },
    };
  }, { ids, paths: ids.map((_, index) => path(index)), histories: Object.fromEntries(ids.map((_, index) => [path(index), history(index)])) });
  const dist = resolve("dist");
  await page.route("http://jouzu-ui.test/**", async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = resolve(dist, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!file.startsWith(dist + sep)) return route.abort();
    const contentType = ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" } as Record<string, string>)[extname(file)] ?? "application/octet-stream";
    try { await route.fulfill({ body: await readFile(file), contentType }); } catch { await route.fulfill({ status: 404, body: "Not found" }); }
  });
  await page.goto("http://jouzu-ui.test/");
  await expect(page.getByLabel("Message Jouzu")).toBeVisible();
}

test("matrix: every session shape opens without attaching the runtime", async ({ page }) => {
  await setup(page);
  for (const index of [1, 0, 3, 4, 5, 6]) {
    await page.getByRole("button", { name: new RegExp(`^S${index}\\b`) }).click();
    const article = page.getByRole("article", { name: "assistant message" });
    if (index === 0) await expect(page.getByText("What would you like to work on?")).toBeVisible();
    if (index === 1) await expect(article).toContainText("short answer");
    if (index === 3) await expect(page.getByRole("article")).toHaveCount(30);
    if (index === 4) await expect(page.getByRole("img", { name: "Conversation attachment" })).toBeVisible();
    if (index === 5) await expect(page.getByRole("alert")).toContainText("fixture failure");
    if (index === 6) await expect(page.getByRole("button", { name: "Read README.md" })).toBeVisible();
    expect(await page.evaluate(() => (window as any).switchCalls)).toHaveLength(0);
  }
});

test("matrix: rapid and repeated switching keeps one final transcript", async ({ page }) => {
  await setup(page);
  const marks: number[] = [];
  for (const index of [1, 7, 8, 9, 10, 11, 1, 8, 1, 8]) {
    await page.getByRole("button", { name: new RegExp(`^S${index}\\b`) }).click();
    await page.waitForTimeout(40);
    marks.push(await page.getByRole("article").count());
  }
  await expect(page.getByRole("article", { name: "assistant message" })).toContainText("session 8 answer");
  expect(await page.evaluate(() => (window as any).switchCalls)).toHaveLength(0);
  expect(marks.every(count => count > 0)).toBe(true);
});

test("matrix: long transcripts open at the newest turn and stay bounded", async ({ page }) => {
  await setup(page);
  const mark = await page.evaluate(() => { const value = performance.now(); (window as any).__matrixClick = value; return value; });
  await page.getByRole("button", { name: /^S3\b/ }).click();
  await expect(page.getByRole("article", { name: "assistant message" }).last()).toContainText("long turn 79");
  const result = await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="Conversation"] .overflow-y-auto');
    return { elapsed: performance.now() - (window as any).__matrixClick, gap: el ? el.scrollHeight - el.scrollTop - el.clientHeight : -1, articles: document.querySelectorAll("article").length };
  });
  expect(result.gap).toBeLessThan(2);
  expect(result.articles).toBeLessThanOrEqual(30);
  expect(result.elapsed).toBeLessThan(500);
  expect(await page.evaluate(() => (window as any).switchCalls)).toHaveLength(0);
});

test("matrix: refresh during a session view does not create a second load", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: /^S8\b/ }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toContainText("session 8 answer");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Message Jouzu")).toBeVisible();
  await page.getByRole("button", { name: /^S8\b/ }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toContainText("session 8 answer");
  expect(await page.evaluate(() => (window as any).switchCalls)).toHaveLength(0);
});

test("matrix: TextGuard history is hidden while the session is only previewed", async ({ page }) => {
  await setup(page);
  for (const title of ["S2", "S7"]) {
    await page.getByRole("button", { name: new RegExp(`^${title}\\b`) }).click();
    await expect(page.getByRole("region", { name: "TextGuard" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).switchCalls)).toHaveLength(0);
  }
});

test("matrix: TextGuard is visible only for the attached session", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: /^S7\b/ }).click();
  const composer = page.getByLabel("Message Jouzu");
  const before = await composer.boundingBox();
  await expect(page.getByRole("region", { name: "TextGuard" })).toHaveCount(0);
  await composer.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).switchCalls.length)).toBe(1);
  const bar = page.getByRole("region", { name: "TextGuard" });
  await expect(bar).toContainText("TextGuard withheld content from the model");
  expect((await composer.boundingBox())?.y).toBeCloseTo(before!.y, 0);
  await bar.getByRole("button", { name: "Review", exact: true }).click();
  await expect(bar).toContainText("TextGuard withheld 1 item");
  await expect(bar).toContainText("LIVE.md");
  expect((await composer.boundingBox())?.y).toBeCloseTo(before!.y, 0);
  await page.getByRole("button", { name: /^S8\b/ }).click();
  await expect(page.getByRole("region", { name: "TextGuard" })).toHaveCount(0);
  expect((await composer.boundingBox())?.y).toBeCloseTo(before!.y, 0);
});

test("matrix: a settled review leaves no Stop turn or Review", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: /^S11\b/ }).click();
  const composer = page.getByLabel("Message Jouzu");
  await composer.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).switchCalls.length)).toBe(1);
  const bar = page.getByRole("region", { name: "TextGuard" });
  await expect(bar).toContainText("TextGuard withheld content from the model");
  await bar.getByRole("button", { name: "Review", exact: true }).click();
  await expect(bar).toContainText("TextGuard completed for this session");
  await expect(bar.getByRole("button", { name: "Stop turn" })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Strict", exact: true })).toBeVisible();
});
