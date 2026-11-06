import { View, Text, computed } from "nsh";
import { openUrl } from "nsh";
import { invoke } from "./host/invoke";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Select } from "./ui/select";
import { ProviderPicker } from "./ui/provider-picker";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Icon } from "./ui/icons";
import type { AppStore } from "./app-store";

/**
 * The provider settings: the Shisa.AI account card and the connection editor.
 * `inline` is the onboarding form; otherwise it lives in the Settings tab.
 */
export function ProviderSettings(props: { app: AppStore; inline: boolean }) {
  const app = props.app;
  const t = app.t;
  const setup = app.setup;
  const busy = app.busy;
  const providerInfo = computed(() => setup()?.providers.find(item => item.id === app.provider()));
  const providerOauth = computed(() => app.connectionMode() === "builtin" && app.provider() === "openai-codex");
  const providerSignedIn = computed(() => !!setup()?.credentials.some(item => item.providerId === app.provider()));
  const providerApiKey = computed(() => providerInfo()?.apiKey !== false);
  // Shisa is an account, not a provider credential; its key must not appear as a phantom row.
  const otherProviders = computed(() => setup() ? [...new Set([...setup()!.credentials.map(c => c.providerId), ...setup()!.customProviders.map(c => c.id)])].filter(id => id !== "shisa") : []);

  async function openDeviceUrl(value: string) {
    // Only the two documented sign-in origins may reach the system browser.
    try {
      const url = new URL(value);
      const shisa = url.origin === "https://platform.shisa.ai" && url.pathname === "/connect";
      const openai = url.origin === "https://auth.openai.com";
      if ((!shisa && !openai) || url.username || url.password) throw new Error(t().loginUrl);
      await openUrl(url.href);
    } catch (failure) { app.error.set(String(failure)); }
  }

  return (
    <View class="flex-col gap-4">
      <If when={props.inline || !app.addingConnection()}>
        <View class="flex-col gap-4">
          <Card className={props.inline ? "gap-3 rounded-none border-0 bg-transparent p-0 shadow-none" : "border-border gap-4 py-5 shadow-none"}>
            <CardHeader className={props.inline ? "px-0" : undefined}>
              <CardTitle>Shisa.AI</CardTitle>
              <CardDescription>{app.device() ? t().waitingAuthorization : setup()?.account.signedIn ? t().shisaConnected : t().shisaHint}</CardDescription>
            </CardHeader>
            <CardContent className={props.inline ? "gap-3 px-0" : "gap-3"}>
              <If when={!app.device() && setup()?.account.revocation === "unconfirmed"}>
                <Text class="text-sm text-muted-foreground">{t().signOutUnconfirmed}</Text>
              </If>
              <If when={!app.device()}>
                <View class="flex-row flex-wrap justify-end gap-2">
                  <If when={!!setup()?.account.signedIn}>
                    <Button variant="outline" disabled={busy() || app.catalogRefreshing() || !setup()} onClick={() => void app.refreshModelCatalog(true)}>
                      <Icon name="RefreshCw" size={16} className={app.catalogRefreshing() ? "animate-spin" : undefined} />
                      <Text class="text-sm font-medium">{t().refreshModels}</Text>
                    </Button>
                  </If>
                  <Button disabled={busy() || !setup()} onClick={() => void app.configure({ action: setup()?.account.signedIn ? "shisa-logout" : "shisa-login" })}>
                    {setup()?.account.signedIn ? t().signOut : t().signIn}
                  </Button>
                </View>
              </If>
              <If when={!!app.device()}>
                <View class="flex-col gap-3">
                  <Input readOnly aria-label={t().loginUrl} value={app.device()?.url ?? ""} />
                  <Input readOnly aria-label={t().deviceCode} value={app.device()?.code ?? ""} />
                  <Text class="text-xs text-muted-foreground">{t().loginHint}</Text>
                  <View class="flex-row items-center justify-end gap-2">
                    <Button variant="outline" onClick={() => void invoke("cancel_control")}>{t().cancel}</Button>
                    <Button onClick={() => void openDeviceUrl(app.device()?.url ?? "")}>
                      <Icon name="ArrowUpRight" size={16} />
                      <Text class="text-sm font-medium">{t().openBrowser}</Text>
                    </Button>
                  </View>
                </View>
              </If>
            </CardContent>
          </Card>
          <If when={!props.inline}>
            <Card className="border-border gap-4 py-5 shadow-none">
              <CardHeader><CardTitle>{t().connections}</CardTitle></CardHeader>
              <CardContent className="gap-2">
                <If when={!!setup() && otherProviders().length > 5}>
                  <Input aria-label={t().searchProviders} placeholder={t().searchProviders} value={app.providerQuery()} onChange={event => app.providerQuery.set(event.target.value)} />
                </If>
                <If when={!app.addingConnection() && !!setup()}>
                  <View class="flex-col gap-2">
                    <Each of={otherProviders().filter(id => `${id} ${setup()?.providers.find(p => p.id === id)?.name ?? ""}`.toLowerCase().includes(app.providerQuery().toLowerCase()))} key={id => id}>
                      {(id) => (
                        <Button
                          variant="outline"
                          className="h-auto min-w-0 flex-1 justify-between gap-2 py-3"
                          disabled={busy()}
                          onClick={() => {
                            app.provider.set(id());
                            app.token.set("");
                            const saved = setup()?.customProviders.find(p => p.id === id());
                            app.connectionMode.set(saved?.editable ? "custom" : "builtin");
                            app.custom.set(saved?.editable
                              ? { provider: saved.id, url: saved.url, model: saved.model, edit: true, imageInput: saved.imageInput ?? false, contextWindow: saved.contextWindow ?? 32768, maxTokens: saved.maxTokens ?? 4096 }
                              : { provider: "", url: "", model: "", edit: false, imageInput: false, contextWindow: 32768, maxTokens: 4096 });
                            app.addingConnection.set(true);
                          }}
                        >
                          <Text class="text-sm">{setup()?.providers.find(p => p.id === id())?.name ?? id()}</Text>
                          <Text class="text-xs text-muted-foreground">{setup()?.credentials.some(key => key.providerId === id()) ? t().credentialSaved : t().configuredNoKey}</Text>
                        </Button>
                      )}
                    </Each>
                    <Button
                      variant="outline"
                      disabled={busy() || !setup()}
                      onClick={() => {
                        app.providerQuery.set("");
                        app.provider.set("");
                        app.connectionMode.set("builtin");
                        app.custom.set({ provider: "", url: "", model: "", edit: false, imageInput: false, contextWindow: 32768, maxTokens: 4096 });
                        app.addingConnection.set(true);
                      }}
                    >
                      <Icon name="Plus" size={16} />
                      <Text class="text-sm font-medium">{t().addConnection}</Text>
                    </Button>
                  </View>
                </If>
              </CardContent>
            </Card>
          </If>
        </View>
      </If>
      <If when={props.inline || app.addingConnection()}>
        <ConnectionEditor app={app} inline={props.inline} providerOauth={providerOauth()} providerSignedIn={providerSignedIn()} providerApiKey={providerApiKey()} openDeviceUrl={openDeviceUrl} />
      </If>
    </View>
  );
}
function ConnectionEditor(props: { app: AppStore; inline: boolean; providerOauth: boolean; providerSignedIn: boolean; providerApiKey: boolean; openDeviceUrl: (url: string) => Promise<void> }) {
  const app = props.app;
  const t = app.t;
  const setup = app.setup;
  const busy = app.busy;
  const providerInfo = () => setup()?.providers.find(item => item.id === app.provider());
  return (
    <View class={props.inline ? "flex-col gap-3 border-t border-border pt-4" : "flex-col gap-4 rounded-xl border border-border bg-card p-5"}>
      <View class="flex-row items-center justify-between gap-3">
        <Text class="text-sm font-semibold">{props.inline ? t().connections : app.custom().edit ? t().editConnection : t().addConnection}</Text>
        <If when={!props.inline}>
          <Button variant="ghost" disabled={busy()} onClick={() => app.addingConnection.set(false)}>{t().backConnections}</Button>
        </If>
      </View>
      <View class="flex-col gap-4">
        <View class="flex-col gap-2">
          <If when={!props.inline}><Label>{t().service}</Label></If>
          <ProviderPicker
            value={app.connectionMode() === "custom" ? "__custom__" : app.provider()}
            disabled={busy() || app.custom().edit}
            label={t().service}
            placeholder={t().chooseService}
            searchLabel={t().searchProviders}
            empty={t().noResults}
            items={[...(setup()?.providers ?? []), { id: "__custom__", name: t().customProvider }]}
            onChange={value => {
              app.token.set("");
              if (value === "__custom__") { app.connectionMode.set("custom"); app.provider.set(""); }
              else { app.connectionMode.set("builtin"); app.provider.set(value); }
            }}
          />
        </View>
        <If when={app.connectionMode() === "builtin" && !!app.provider()}>
          <View class="flex-col gap-4 border-t border-border pt-4">
            <If when={props.providerOauth}>
              <View class="flex-col gap-3 rounded-lg border border-border p-3">
                <Text class="text-sm text-muted-foreground">{providerInfo()?.oauthName ?? t().oauthHint}</Text>
                <If when={props.providerSignedIn} else={
                  <View class="flex-row justify-end">
                    <Button disabled={busy()} onClick={() => void app.configure({ action: "provider-oauth", provider: app.provider() })}>{t().oauthSignIn}</Button>
                  </View>
                }>
                  <View class="flex-row items-center justify-between gap-2">
                    <Text class="text-sm">{t().oauthConnected}</Text>
                    <Button variant="outline" disabled={busy()} onClick={() => void app.configure({ action: "provider-remove", provider: app.provider() })}>{t().removeCredential}</Button>
                  </View>
                </If>
                <If when={app.providerDevice()?.provider === app.provider()}>
                  <View class="flex-col gap-3">
                    <Input readOnly aria-label={t().loginUrl} value={app.providerDevice()?.url ?? ""} />
                    <If when={!!app.providerDevice()?.code}>
                      <Input readOnly aria-label={t().deviceCode} value={app.providerDevice()?.code ?? ""} />
                    </If>
                    <Text class="text-xs text-muted-foreground">{t().loginHint}</Text>
                    <View class="flex-row items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => void invoke("cancel_control")}>{t().cancel}</Button>
                      <Button onClick={() => void props.openDeviceUrl(app.providerDevice()?.url ?? "")}>
                        <Icon name="ArrowUpRight" size={16} />
                        <Text class="text-sm font-medium">{t().openBrowser}</Text>
                      </Button>
                    </View>
                  </View>
                </If>
              </View>
            </If>
            <If when={props.providerApiKey}>
              <View class="flex-col gap-2">
                <Label>{t().apiKey}</Label>
                <Input type="password" aria-label={t().apiKey} placeholder={t().apiKey} value={app.token()} onChange={event => app.token.set(event.target.value)} />
                <View class="flex-row justify-end gap-2">
                  <Button disabled={busy() || !app.token().trim()} onClick={async () => {
                    if (await app.configure({ action: "provider-key", provider: app.provider(), token: app.token() })) {
                      app.token.set("");
                      app.addingConnection.set(false);
                    }
                  }}>{t().save}</Button>
                  <If when={!!setup()?.credentials.some(c => c.providerId === app.provider())}>
                    <Button variant="outline" disabled={busy()} onClick={() => void app.configure({ action: "provider-remove", provider: app.provider() })}>{t().removeCredential}</Button>
                  </If>
                </View>
              </View>
            </If>
            <Label>{t().defaultModel}</Label>
            <Select
              value={setup()?.defaultProvider === app.provider() ? setup()?.defaultModel ?? null : null}
              onValueChange={model => void app.configure({ action: "default-model", provider: app.provider(), model })}
              items={(setup()?.models ?? []).filter(m => m.provider === app.provider()).map(m => ({ value: m.id, label: m.name }))}
              placeholder={t().defaultModel}
              aria-label={t().defaultModel}
              className="w-full"
            />
          </View>
        </If>
        <If when={app.connectionMode() === "custom"}>
          <CustomConnection app={app} />
        </If>
      </View>
    </View>
  );
}

function CustomConnection(props: { app: AppStore }) {
  const app = props.app;
  const t = app.t;
  const custom = app.custom;
  const busy = app.busy;
  const patch = (change: Partial<ReturnType<typeof custom>>) => custom.update(value => ({ ...value, ...change }));
  return (
    <View class="flex-col gap-3 border-t border-border pt-4">
      <Text class="text-sm text-muted-foreground">{t().customHint}</Text>
      <Label>{t().providerId}</Label>
      <Input placeholder={t().providerId} aria-label={t().providerId} disabled={custom().edit} value={custom().provider} onChange={event => patch({ provider: event.target.value })} />
      <Label>{t().endpoint}</Label>
      <Input placeholder={t().endpoint} aria-label={t().endpoint} value={custom().url} onChange={event => patch({ url: event.target.value })} />
      <Label>{t().modelId}</Label>
      <Input placeholder={t().modelId} aria-label={t().modelId} value={custom().model} onChange={event => patch({ model: event.target.value })} />
      <View class="flex-row items-center justify-between gap-3">
        <Label>{t().imageInput}</Label>
        <Switch aria-label={t().imageInput} checked={custom().imageInput} onCheckedChange={imageInput => patch({ imageInput })} />
      </View>
      <Text class="text-xs text-muted-foreground">{t().imageInputHint}</Text>
      <Label>{t().contextWindow}</Label>
      <Input type="number" aria-label={t().contextWindow} value={String(custom().contextWindow)} onChange={event => patch({ contextWindow: Number(event.target.value) })} />
      <Text class="text-xs text-muted-foreground">{t().contextWindowHint}</Text>
      <Label>{t().maxOutput}</Label>
      <Input type="number" aria-label={t().maxOutput} value={String(custom().maxTokens)} onChange={event => patch({ maxTokens: Number(event.target.value) })} />
      <Text class="text-xs text-muted-foreground">{t().maxOutputHint}</Text>
      <Label>{t().apiKey}</Label>
      <Input type="password" aria-label={t().apiKey} placeholder={t().apiKey} value={app.token()} onChange={event => app.token.set(event.target.value)} />
      <View class="flex-row justify-end pt-1">
        <Button disabled={busy() || !custom().provider || !custom().url || !custom().model} onClick={async () => {
          if (await app.configure({ action: "custom-provider", ...custom() })) {
            patch({ edit: true });
            if (app.token().trim() && !await app.configure({ action: "provider-key", provider: custom().provider, token: app.token() })) return;
            app.token.set("");
            app.addingConnection.set(false);
          }
        }}>{t().save}</Button>
      </View>
    </View>
  );
}
