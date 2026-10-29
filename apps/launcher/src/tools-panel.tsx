import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Label } from "./components/ui/label";
import { Switch } from "./components/ui/switch";

interface ImageSettings {
  enabled: boolean;
  provider: string;
  model: string;
  size: string;
  maxImages: number;
}

interface ToolsSettings {
  image: ImageSettings;
  reviewTools: string[];
}

const SIZES = ["1K", "2K", "4K"];
const MAX_IMAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const select = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

/**
 * Tools settings. The image tool owns its provider/model/size here; nothing is
 * derived from the chat model, and the provider list and models come from the
 * extension (CLI mode) so adding a provider does not touch this page.
 */
export function ToolsPanel() {
  const [tools, setTools] = useState<ToolsSettings | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshModels(provider: string, current: string, base?: ToolsSettings) {
    if (!provider) return;
    setBusy(true);
    try {
      const result = await invoke<{ models: string[] }>("image_models", { provider });
      const list = result.models ?? [];
      setModels(list);
      const value = base ?? tools;
      if (value && list.length && (!current || !list.includes(current))) {
        const saved = await invoke<ToolsSettings>("tools_settings_save", { image: { ...value.image, provider, model: list[0] } });
        setTools(saved);
      }
    } catch (failure) {
      setError(String(failure));
      setModels([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const value = await invoke<ToolsSettings>("tools_settings_read");
        setTools(value);
        try {
          const result = await invoke<{ providers: { id: string; label: string }[] }>("image_providers");
          setProviders(result.providers ?? []);
        } catch (failure) {
          setError(String(failure));
        }
        await refreshModels(value.image.provider, value.image.model, value);
      } catch (failure) {
        setError(String(failure));
      }
    })();
  }, []);

  async function save(patch: Partial<ImageSettings>) {
    if (!tools) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await invoke<ToolsSettings>("tools_settings_save", { image: { ...tools.image, ...patch } });
      setTools(saved);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!tools) return <p className="text-sm text-muted-foreground">{error ?? "Loading tools…"}</p>;
  const image = tools.image;

  return <Card className="border-border shadow-none">
    <CardHeader>
      <CardTitle>Image generation</CardTitle>
      <CardDescription>Defaults for the generate_image tool. The image model is independent of the chat model.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="image-enabled">Enable image generation</Label>
        <Switch id="image-enabled" aria-label="Enable image generation" checked={image.enabled} disabled={busy} onCheckedChange={enabled => void save({ enabled })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="text-muted-foreground">Image provider</span>
          <select aria-label="Image provider" className={select} value={image.provider} disabled={busy || !providers.length} onChange={event => { const provider = event.target.value; void save({ provider }); void refreshModels(provider, ""); }}>
            {!providers.length && <option value={image.provider}>{image.provider}</option>}
            {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-muted-foreground">Image model</span>
          <select aria-label="Image model" className={select} value={image.model} disabled={busy || !models.length} onChange={event => void save({ model: event.target.value })}>
            {!models.length && <option value={image.model}>{image.model || "No models"}</option>}
            {models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-muted-foreground">Image size</span>
          <select aria-label="Image size" className={select} value={image.size} disabled={busy} onChange={event => void save({ size: event.target.value })}>
            {SIZES.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-muted-foreground">Images per call</span>
          <select aria-label="Images per call" className={select} value={image.maxImages} disabled={busy} onChange={event => void save({ maxImages: Number(event.target.value) })}>
            {MAX_IMAGES.map(max => <option key={max} value={max}>{max}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="border-t border-border pt-3 text-xs text-muted-foreground">
        Reviewed calls: {tools.reviewTools.join(", ")}
      </div>
    </CardContent>
  </Card>;
}
