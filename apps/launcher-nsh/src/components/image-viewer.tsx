import { View, Text, Image, Scroll, Overlay, signal, effect } from "nsh";
import type { JSX } from "nsh";
import { Button } from "../ui/button";
import { Icon } from "../ui/icons";

export interface ViewerAction {
  id: string;
  label: string;
  icon: JSX.Element;
  onSelect: () => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 32;
const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/**
 * A top-level image viewer on a root Overlay: native pinch/scroll zooms and
 * pans, and it carries the actions the caller supplies. The actions are
 * content data, not viewer code, so any tool can reuse the viewer.
 */
export function ImageViewer(props: { src: string; alt: string; title?: string; actions?: ViewerAction[]; onClose: () => void }) {
  const scale = signal(1);
  const size = signal<{ width: number; height: number } | null>(null);
  effect(() => {
    const src = props.src;
    let alive = true;
    void Image.getSize(src).then(value => { if (alive) size.set(value); }).catch(() => {});
    return () => { alive = false; };
  });
  const reset = () => scale.set(1);
  return (
    <Overlay style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0 }} onCancel={() => props.onClose()}>
      <View class="flex-1 flex-col bg-black/90 text-white" role="dialog" accessibilityLabel={props.title ?? "Image viewer"}>
        <View class="flex-row shrink-0 items-center justify-between gap-2 px-3 py-2">
          <Text class="min-w-0 truncate text-sm text-white/80">{props.title}</Text>
          <View class="flex-row shrink-0 items-center gap-0.5">
            <Each of={props.actions ?? []} key={action => action.id}>{action => <Button variant="ghost" className="size-8 p-0 text-white hover:bg-white/15" title={action().label} aria-label={action().label} onClick={action().onSelect}>{action().icon}</Button>}</Each>
            <Button variant="ghost" className="size-8 p-0 text-white hover:bg-white/15" title="Close" aria-label="Close" onClick={() => props.onClose()}><Icon name="X" size={16} color="white" /></Button>
          </View>
        </View>
        <Scroll
          class="min-h-0 flex-1"
          contentClass="grow items-center justify-center"
          minimumZoomScale={MIN_SCALE}
          maximumZoomScale={MAX_SCALE}
          zoomScale={scale()}
          centerContent
          onPress={event => { if (event.clickCount === 2) reset(); }}
        >
          <If when={size()}>{value => <Image src={props.src} accessibilityLabel={props.alt} style={{ width: value().width, height: value().height }} />}</If>
        </Scroll>
        <View class="flex-row shrink-0 items-center justify-center gap-2 py-3">
          <Button variant="ghost" className="size-8 p-0 text-white hover:bg-white/15" title="Zoom out" aria-label="Zoom out" onClick={() => scale.update(value => clamp(value / 1.25))}><Icon name="Minus" size={16} color="white" /></Button>
          <Text class="w-16 text-center text-xs tabular-nums text-white/70">{Math.round(scale() * 100)}%</Text>
          <Button variant="ghost" className="size-8 p-0 text-white hover:bg-white/15" title="Zoom in" aria-label="Zoom in" onClick={() => scale.update(value => clamp(value * 1.25))}><Icon name="Plus" size={16} color="white" /></Button>
          <Button variant="ghost" className="size-8 p-0 text-white hover:bg-white/15" title="Reset" aria-label="Reset" onClick={reset}><Icon name="RotateCcw" size={16} color="white" /></Button>
        </View>
      </View>
    </Overlay>
  );
}