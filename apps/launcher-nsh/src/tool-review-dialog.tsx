import { View, Text, Scroll } from "nsh";
import { Button } from "./ui/button";

interface ReviewInfo {
  tool?: string;
  images?: number;
  prompt?: string;
  provider?: string;
  model?: string;
  size?: string;
}

function reviewInfo(body: string): ReviewInfo | null {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" ? value as ReviewInfo : null;
  } catch {
    return null;
  }
}

/**
 * The generic tool review card. It renders whatever options the runtime sent, so
 * a new reviewed tool needs no new UI; only the body changes. Structured bodies
 * (the image tool) get fields; anything else falls back to plain text.
 */
export function ToolReviewDialog(props: { title: string; body: string; options: readonly string[]; disabled: boolean; onSelect: (value: string) => void; onCancel: () => void }) {
  const info = () => reviewInfo(props.body);
  const count = () => info()?.images ?? 1;
  return (
    <View class="w-full flex-col rounded-xl border border-border bg-card p-4 shadow-xl" accessibilityLabel={props.title}>
      <View class="flex-row items-center justify-between gap-3">
        <Text class="text-sm font-semibold">{props.title}</Text>
        <If when={!!info()?.tool}>
          <Text class="shrink-0 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            {`${info()?.tool ?? ""} · ${count()} image${count() === 1 ? "" : "s"}`}
          </Text>
        </If>
      </View>
      <If when={!!info()} else={
        <If when={!!props.body}>
          <Text class="mt-2 text-sm text-muted-foreground">{props.body}</Text>
        </If>
      }>
        <View class="flex-col">
          <If when={!!info()?.prompt}>
            <Scroll class="mt-3 max-h-32 rounded-md bg-muted/40 p-2">
              <Text class="text-[11px] leading-relaxed text-muted-foreground">{info()?.prompt ?? ""}</Text>
            </Scroll>
          </If>
          <Text class="mt-2 text-[11px] text-muted-foreground">{[info()?.provider, info()?.model, info()?.size].filter(Boolean).join(" · ")}</Text>
          <Text class="mt-1 text-[11px] text-muted-foreground">{`This runs ${count()} paid image generation${count() === 1 ? "" : "s"}.`}</Text>
        </View>
      </If>
      <View class="mt-4 flex-row flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={props.disabled} onClick={() => props.onCancel()}>Cancel</Button>
        <Each of={props.options} key={option => option}>
          {(option) => (
            <Button
              variant={option() === "Approve" ? "default" : "outline"}
              className={option() === "Deny" ? "text-destructive" : ""}
              disabled={props.disabled}
              onClick={() => props.onSelect(option())}
            >
              {option()}
            </Button>
          )}
        </Each>
      </View>
    </View>
  );
}