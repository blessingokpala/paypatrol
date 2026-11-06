import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/brand";
import { cn } from "@/lib/utils";
import { OTHER, categoryOptions, type CategoryValue } from "@/lib/categories";

/** Searchable category dropdown with an "Other → Specify category" follow-up. */
export function CategoryField({
  id, value, onChange, existing = [], error, required = true,
}: {
  id: string;
  value: CategoryValue;
  onChange: (v: CategoryValue) => void;
  existing?: string[];
  error?: string | null;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = [...categoryOptions(existing), { id: OTHER, label: "Other" }];
  const selected = options.find((o) => o.id === value.choice);
  const otherMissing = value.choice === OTHER && !value.other.trim();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Category{required && <Req />}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-required={required}
            aria-invalid={Boolean(error) && !value.choice}
            aria-describedby={error && !value.choice ? `${id}-error` : undefined}
            className="w-full justify-between bg-card font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected ? selected.label : "Select a category"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[16rem] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories…" />
            <CommandList>
              <CommandEmpty>No match. Choose “Other” to specify one.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.label} ${o.id}`}
                    onSelect={() => { onChange({ choice: o.id, other: o.id === OTHER ? value.other : "" }); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value.choice === o.id ? "opacity-100" : "opacity-0")} aria-hidden />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.choice === OTHER && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-other`}>Specify category<Req /></Label>
          <Input
            id={`${id}-other`}
            aria-required
            aria-invalid={Boolean(error) && otherMissing}
            aria-describedby={error && otherMissing ? `${id}-error` : undefined}
            value={value.other}
            onChange={(e) => onChange({ choice: OTHER, other: e.target.value })}
            placeholder="e.g. Seasonal decorations"
          />
          <p className="text-xs text-muted-foreground">A custom category is only a label. It does not grant spending permission; categories your spending rules don't permit are held for review.</p>
        </div>
      )}
      {error && (!value.choice || otherMissing) && <p id={`${id}-error`} role="alert" className="text-xs text-blocked">{error}</p>}
    </div>
  );
}
