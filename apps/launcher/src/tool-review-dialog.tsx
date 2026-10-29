import { Button } from "./components/ui/button";

/**
 * The generic tool review card. It renders whatever options the runtime sent,
 * so a new reviewed tool needs no new UI; only the body text changes.
 */
export function ToolReviewDialog({ title, body, options, disabled, onSelect, onCancel }: { title: string; body: string; options: readonly string[]; disabled: boolean; onSelect: (value: string) => void; onCancel: () => void }) {
  return <section role="dialog" aria-modal="false" aria-label={title} className="rounded-xl border border-primary/60 bg-card/95 p-4 shadow-2xl backdrop-blur">
    <h3 className="text-sm font-semibold">{title}</h3>
    {body && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{body}</p>}
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <Button variant="outline" disabled={disabled} onClick={onCancel}>Cancel</Button>
      {options.map(option => <Button key={option} disabled={disabled} onClick={() => onSelect(option)}>{option}</Button>)}
    </div>
  </section>;
}
