import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FieldSelectOption = { value: string; label: string };

const NONE = "__none__";

/**
 * Shared accessible dropdown for PayPatrol forms. Keyboard navigation, visible
 * focus, scrolling and long-option handling come from the underlying Radix
 * select; the panel uses the PayPatrol palette via the popover tokens.
 * An option with value "" acts as the "no selection" choice.
 */
export function FieldSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  ariaLabel,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: FieldSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value === "" ? NONE : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className="bg-card [&>span]:pr-4">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value === "" ? NONE : o.value} value={o.value === "" ? NONE : o.value} className="whitespace-normal">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
