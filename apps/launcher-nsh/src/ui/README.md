# UI kit contract (NSH port)

The components in this directory keep the baseline call shape where NSH
allows it, so ported screens change as little as possible.

- `Button` (`button.tsx`): `className`, `variant` (`default | outline | ghost |
  destructive`), `disabled`, `onClick`, `aria-label`, `title`. A bare string
  child is wrapped in `Text` automatically; composed children must place text
  in `<Text>` themselves (NSH forbids raw text in a `View`).
- `Input` (`input.tsx`): `className`, `type` (`password` masks, `number` takes
  the number keyboard), `value`, `placeholder`, `disabled`, `readOnly`,
  `onChange(event)` with `event.target.value` (React-shaped), `onSubmit`,
  `aria-label`.
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`: `className`,
  children.
- `Label`: text wrapper, `className`.
- `Progress`: `value` (0–100) or `null`/omitted for indeterminate.
- `Switch`: `checked`, `disabled`, `onCheckedChange(checked)`, `aria-label`.
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`: baseline API — `Tabs value
  onValueChange`, trigger/content `value`. Context carries the value.
- `Select` (`select.tsx`): **API changed** from radix compound children to
  `items={[{ value, label }]}` with `value`, `onValueChange`, `placeholder`,
  `searchable`, `searchPlaceholder`, `aria-label`, `disabled`, `className`.
- `ProviderPicker`: `value`, `items={[{ id, name }]}`, `onChange`, `disabled`,
  `placeholder`, `searchLabel`.
- `Dialog` (`dialog.tsx`): **API flattened** — `Dialog open onOpenChange
  className` contains its content directly (no DialogContent wrapper);
  `DialogTitle` / `DialogDescription` are text wrappers. Escape and a
  backdrop press call `onOpenChange(false)`.
- `ScrollArea`: `className`, `horizontal`, `ref` (a `ScrollRef` for
  `scrollTo`), children.
- `JouzuLoader`: the dotted wait sign; `small`.
- `Icon` (`icons.tsx`): `<Icon name="Search" size={16} />` — the baseline
  lucide names, drawn as tinted template SVGs that follow the theme. Use
  `color` (a CSS color or `token(...)`) to override the tint.

Porting rules for screens:

- **Never destructure props** in a component signature: NSH components run
  once, and a destructured prop is read once and stops following its signal.
  Take `props` and read `props.x` where it is used (the compiler warned about
  exactly this).

- React state becomes signals: `const [x, setX] = useState(v)` →
  `const x = signal(v)`; read `x()`, write `x.set(...)` / `x.update(...)`.
- `useEffect` becomes `effect(...)` (import from `nsh`) or plain startup code
  in the component body (components run once).
- Lists: `<Each of={items()} key={...}>{(item) => ...}</Each>`; conditionals:
  `<If when={...}>`. Both are globals, no import.
- Raw text only inside `<Text>`; `className` on host elements is `class`.
- `localStorage` comes from `../host/storage` (synchronous facade).
- `invoke` comes from `../host/invoke`; `listen` from `../host/events`
  (returns an unsubscribe function directly, not a promise).
- Dialogs: `openFolder` / `savePath` / `confirm` from `../host/dialog`;
  `openUrl`, `Clipboard` from `nsh`; window controls from `../host/window`.