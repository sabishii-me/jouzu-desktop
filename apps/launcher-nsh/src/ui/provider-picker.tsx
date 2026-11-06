import { Select } from "./select";

export interface ProviderItem {
  id: string;
  name: string;
}

/** The searchable provider list the settings use. */
export function ProviderPicker(props: {
  value: string;
  items: ProviderItem[];
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  searchLabel?: string;
  empty?: string;
  className?: string;
}) {
  return (
    <Select
      value={props.value || null}
      onValueChange={value => props.onChange(value)}
      items={props.items.map(item => ({ value: item.id, label: item.name }))}
      placeholder={props.placeholder}
      disabled={props.disabled}
      searchable
      searchPlaceholder={props.searchLabel}
      className={props.className}
    />
  );
}