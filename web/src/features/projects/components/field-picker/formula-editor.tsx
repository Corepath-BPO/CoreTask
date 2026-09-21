import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

import {
  expressionToLabelText,
  formulaCandidates,
  labelTextToExpression,
  type FormulaCandidate,
} from '../../lib/formula-labels';

import { FieldTypeIcon } from './field-type-icon';

/**
 * Writes a formula in field names, and stores it in field ids.
 *
 * What is typed reads `{Effort} * {Rate}`; what is saved reads
 * `{field:<uuid>} * {field:<uuid>}`, so a rename never breaks the formula.
 * The two are converted at the edges: on the way in when the editor opens,
 * on the way out on every keystroke that converts cleanly. A keystroke that
 * does not — a name nobody has, or one two fields share — leaves the stored
 * expression as it was and shows the reason under the box, so the draft is
 * refused rather than saved wrong.
 *
 * `{` opens a picker of the fields this formula may name, because remembering
 * every field's exact name is not the reader's job.
 */
export function FormulaEditor({
  expression,
  fields,
  selfId,
  onChange,
}: {
  /** The stored form, by id. */
  expression: string;
  /** The project's fields, so the picker and the conversion know the names. */
  fields: readonly FormulaCandidate[];
  /** The field being edited, so the picker leaves it out. */
  selfId?: string;
  onChange: (expression: string) => void;
}) {
  const candidates = useMemo(() => formulaCandidates(fields, selfId), [fields, selfId]);

  const [text, setText] = useState(() => expressionToLabelText(expression, fields));
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number>(0);

  const apply = (next: string) => {
    setText(next);
    const converted = labelTextToExpression(next, candidates);
    if (converted.ok) {
      setConversionError(null);
      onChange(converted.expression);
    } else {
      setConversionError(converted.error.message);
    }
  };

  const insertField = (field: FormulaCandidate) => {
    const element = textareaRef.current;
    const at = element?.selectionStart ?? caret.current ?? text.length;
    // The `{` that opened the picker, if the person typed one, is replaced.
    const before = text.slice(0, at).replace(/\{$/, '');
    const after = text.slice(at);
    const next = `${before}{${field.name}}${after}`;
    apply(next);
    setPickerOpen(false);
    requestAnimationFrame(() => {
      element?.focus();
      const position = before.length + field.name.length + 2;
      element?.setSelectionRange(position, position);
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="formula-expression">Formula</Label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs">
              Insert field
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <Command>
              <CommandInput placeholder="Find a field…" />
              <CommandList>
                <CommandEmpty>No number or date fields on this project.</CommandEmpty>
                <CommandGroup>
                  {candidates.map((field) => (
                    <CommandItem
                      key={field.id}
                      value={field.name}
                      onSelect={() => insertField(field)}
                    >
                      <FieldTypeIcon type={field.type} />
                      <span className="truncate">{field.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <Textarea
        id="formula-expression"
        ref={textareaRef}
        rows={3}
        value={text}
        spellCheck={false}
        onChange={(event) => apply(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === '{') {
            caret.current = (event.target as HTMLTextAreaElement).selectionStart + 1;
            setPickerOpen(true);
          }
        }}
        onSelect={(event) => {
          caret.current = (event.target as HTMLTextAreaElement).selectionStart;
        }}
        placeholder="{Effort} * {Rate}"
        className="font-mono text-xs"
      />

      {conversionError ? (
        <p className="text-xs text-destructive">{conversionError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Add, subtract, multiply and divide this project&apos;s number, rating and date fields.{' '}
          <code className="rounded bg-muted px-1">days_between(a, b)</code> counts the days from one
          date to another; <code className="rounded bg-muted px-1">today()</code> is today. Type{' '}
          <code className="rounded bg-muted px-1">{'{'}</code> to pick a field.
        </p>
      )}
    </div>
  );
}
