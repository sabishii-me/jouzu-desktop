import { signal, Text, View } from "nsh";
import { invoke, errorText } from "./host/invoke";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Switch } from "./ui/switch";

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

interface ImageModel {
  id: string;
  sizes: string[];
}

const SIZES = ["1K", "2K", "4K"];
const MAX_IMAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function readModels(value: unknown): ImageModel[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  return list.flatMap(item => {
    if (typeof item === "string") return [{ id: item, sizes: SIZES }];
    const entry = item as { id?: unknown; sizes?: unknown };
    const id = typeof entry?.id === "string" ? entry.id : "";
    const sizes = Array.isArray(entry?.sizes) && entry.sizes.every((size: unknown) => typeof size === "string") ? entry.sizes as string[] : SIZES;
    return id ? [{ id, sizes }] : [];
  });
}

/**
 * Tools settings. The image tool owns its provider/model/size here; nothing is
 * derived from the chat model, and the provider list and models come from the
 * extension (CLI mode) so adding a provider does not touch this page.
 * The baseline's native <select> elements become the kit's Select (items).
 */
export function ToolsPanel() {
  const tools = signal<ToolsSettings | null>(null);
  const providers = signal<{ id: string; label: string }[]>([]);
  const models = signal<ImageModel[]>([]);
  const error = signal<string | null>(null);
  const busy = signal(false);

  async function refreshModels(provider: string, currentModel: string, currentSize: string, base?: ToolsSettings) {
    if (!provider) return;
    busy.set(true);
    try {
      const result = await invoke<{ models: unknown }>("image_models", { provider });
      const list = readModels(result.models);
      models.set(list);
      const value = base ?? tools();
      if (!value || !list.length) return;
      const selected = list.find(entry => entry.id === currentModel) ?? list[0];
      const nextSize = selected.sizes.includes(currentSize) ? currentSize : selected.sizes[0];
      if (selected.id !== currentModel || nextSize !== currentSize) {
        const saved = await invoke<ToolsSettings>("tools_settings_save", { image: { ...value.image, provider, model: selected.id, size: nextSize } });
        tools.set(saved);
      }
    } catch (failure) {
      error.set(errorText(failure));
      models.set([]);
    } finally {
      busy.set(false);
    }
  }

  void (async () => {
    try {
      const value = await invoke<ToolsSettings>("tools_settings_read");
      tools.set(value);
      try {
        const result = await invoke<{ providers: { id: string; label: string }[] }>("image_providers");
        providers.set(result.providers ?? []);
      } catch (failure) {
        error.set(errorText(failure));
      }
      await refreshModels(value.image.provider, value.image.model, value.image.size, value);
    } catch (failure) {
      error.set(errorText(failure));
    }
  })();

  async function save(patch: Partial<ImageSettings>) {
    const current = tools();
    if (!current) return;
    busy.set(true);
    error.set(null);
    try {
      const saved = await invoke<ToolsSettings>("tools_settings_save", { image: { ...current.image, ...patch } });
      tools.set(saved);
    } catch (failure) {
      error.set(errorText(failure));
    } finally {
      busy.set(false);
    }
  }

  const loading = <Text class="text-sm text-muted-foreground">{error() ?? "Loading tools…"}</Text>;
  return <If when={tools()} else={loading}>{value => {
    const image = () => value().image;
    const sizes = () => models().find(model => model.id === image().model)?.sizes ?? SIZES;
    return <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle>Image generation</CardTitle>
        <CardDescription>Defaults for the generate_image tool. The image model is independent of the chat model.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <View class="flex-row items-center justify-between gap-4">
          <Label htmlFor="image-enabled">Enable image generation</Label>
          <Switch id="image-enabled" aria-label="Enable image generation" checked={image().enabled} disabled={busy()} onCheckedChange={enabled => void save({ enabled })} />
        </View>
        <View class="flex-col gap-3">
          <View class="flex-col gap-1">
            <Text class="text-sm text-muted-foreground">Image provider</Text>
            <Select aria-label="Image provider" value={image().provider} disabled={busy() || !providers().length}
              items={providers().length ? providers().map(provider => ({ value: provider.id, label: provider.label })) : [{ value: image().provider, label: image().provider }]}
              onValueChange={provider => void refreshModels(provider, "", "")} />
          </View>
          <View class="flex-col gap-1">
            <Text class="text-sm text-muted-foreground">Image model</Text>
            <Select aria-label="Image model" value={image().model} disabled={busy() || !models().length}
              items={models().length ? models().map(model => ({ value: model.id, label: model.id })) : [{ value: image().model, label: image().model || "No models" }]}
              onValueChange={selected => {
                const model = models().find(entry => entry.id === selected);
                const size = model && model.sizes.includes(image().size) ? image().size : model?.sizes[0];
                void save({ model: selected, ...(size ? { size } : {}) });
              }} />
          </View>
          <View class="flex-col gap-1">
            <Text class="text-sm text-muted-foreground">Image size</Text>
            <Select aria-label="Image size" value={image().size} disabled={busy()}
              items={sizes().map(size => ({ value: size, label: size }))}
              onValueChange={size => void save({ size })} />
          </View>
          <View class="flex-col gap-1">
            <Text class="text-sm text-muted-foreground">Images per call</Text>
            <Select aria-label="Images per call" value={String(image().maxImages)} disabled={busy()}
              items={MAX_IMAGES.map(max => ({ value: String(max), label: String(max) }))}
              onValueChange={selected => void save({ maxImages: Number(selected) })} />
          </View>
        </View>
        <If when={error()}>
          <Text role="alert" class="text-xs text-destructive">{error()}</Text>
        </If>
        <View class="border-t border-border pt-3">
          <Text class="text-xs text-muted-foreground">Reviewed calls: {value().reviewTools.join(", ")}</Text>
        </View>
      </CardContent>
    </Card>;
  }}</If>;
}
