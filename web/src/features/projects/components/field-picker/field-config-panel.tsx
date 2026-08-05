import { CustomFieldType } from '@coretask/contracts';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CustomFieldOptionEditor } from './custom-field-option-editor';
import type { FieldDraft } from './field-type-registry';

/**
 * The half of the builder that changes with the field type.
 *
 * Dispatching on the draft's type rather than rendering every control and
 * hiding most: a form that shows "decimal places" above a checkbox teaches the
 * reader that the settings do not mean anything.
 *
 * Only settings the API validates appear here. There is no point offering a
 * control whose value the server would drop.
 */
export function FieldConfigPanel({
  draft,
  onChange,
}: {
  draft: FieldDraft;
  onChange: (draft: FieldDraft) => void;
}) {
  const setSetting = (key: string, value: unknown) =>
    onChange({ ...draft, settings: { ...draft.settings, [key]: value } });

  const setting = <T,>(key: string, fallback: T): T => (draft.settings[key] as T) ?? fallback;

  switch (draft.type) {
    case CustomFieldType.SINGLE_SELECT:
    case CustomFieldType.MULTI_SELECT:
      return (
        <div className="space-y-1.5">
          <Label>Options</Label>
          <CustomFieldOptionEditor
            options={draft.options}
            onChange={(options) => onChange({ ...draft, options })}
          />
        </div>
      );

    case CustomFieldType.TEXT:
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="text-mode">Length</Label>
            <Select
              value={setting('textMode', 'SHORT')}
              onValueChange={(value) => setSetting('textMode', value)}
            >
              <SelectTrigger id="text-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SHORT">Short — one line</SelectItem>
                <SelectItem value="LONG">Long — a paragraph</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="text-placeholder">Placeholder</Label>
            <Input
              id="text-placeholder"
              value={setting('placeholder', '')}
              onChange={(event) => setSetting('placeholder', event.target.value || undefined)}
              placeholder="Shown in an empty cell"
            />
          </div>
        </div>
      );

    case CustomFieldType.NUMBER:
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="number-format">Format</Label>
            <Select
              value={setting('numberFormat', 'PLAIN')}
              onValueChange={(value) => setSetting('numberFormat', value)}
            >
              <SelectTrigger id="number-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PLAIN">Plain number</SelectItem>
                <SelectItem value="PERCENTAGE">Percentage</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="decimal-places">Decimal places</Label>
            <Input
              id="decimal-places"
              type="number"
              min={0}
              max={6}
              value={String(setting('decimalPlaces', 0))}
              onChange={(event) => setSetting('decimalPlaces', Number(event.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="min-value">Minimum</Label>
            <Input
              id="min-value"
              type="number"
              value={numberValue(draft.settings['minValue'])}
              onChange={(event) => setSetting('minValue', optionalNumber(event.target.value))}
              placeholder="No minimum"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="max-value">Maximum</Label>
            <Input
              id="max-value"
              type="number"
              value={numberValue(draft.settings['maxValue'])}
              onChange={(event) => setSetting('maxValue', optionalNumber(event.target.value))}
              placeholder="No maximum"
            />
          </div>
        </div>
      );

    case CustomFieldType.DATE:
      return (
        <div className="space-y-1.5">
          <Label htmlFor="date-mode">Precision</Label>
          <Select
            value={setting('dateMode', 'DATE_ONLY')}
            onValueChange={(value) => setSetting('dateMode', value)}
          >
            <SelectTrigger id="date-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DATE_ONLY">Date only</SelectItem>
              <SelectItem value="DATE_TIME">Date and time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    case CustomFieldType.PEOPLE:
      return (
        <div className="space-y-1.5">
          <Label htmlFor="people-mode">Selection</Label>
          <Select
            value={setting('peopleMode', 'SINGLE')}
            onValueChange={(value) => setSetting('peopleMode', value)}
          >
            <SelectTrigger id="people-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SINGLE">One person</SelectItem>
              <SelectItem value="MULTIPLE">Several people</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only members of this workspace can be chosen.
          </p>
        </div>
      );

    case CustomFieldType.CHECKBOX:
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="checked-label">Label when ticked</Label>
            <Input
              id="checked-label"
              value={setting('checkedLabel', '')}
              onChange={(event) => setSetting('checkedLabel', event.target.value || undefined)}
              placeholder="Yes"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unchecked-label">Label when clear</Label>
            <Input
              id="unchecked-label"
              value={setting('uncheckedLabel', '')}
              onChange={(event) => setSetting('uncheckedLabel', event.target.value || undefined)}
              placeholder="No"
            />
          </div>
        </div>
      );

    case CustomFieldType.URL:
    case CustomFieldType.EMAIL:
      return (
        <div className="space-y-1.5">
          <Label htmlFor="link-placeholder">Placeholder</Label>
          <Input
            id="link-placeholder"
            value={setting('placeholder', '')}
            onChange={(event) => setSetting('placeholder', event.target.value || undefined)}
            placeholder={draft.type === CustomFieldType.URL ? 'https://…' : 'name@company.com'}
          />
          <p className="text-xs text-muted-foreground">
            Values are validated before they are saved, and rendered as a link once they are.
          </p>
        </div>
      );

    default:
      // A type with no panel is a type with nothing to configure, which is a
      // valid answer — not a reason to render an empty box.
      return null;
  }
}

/** `undefined` shows the placeholder; `0` is a real value and must not vanish. */
function numberValue(value: unknown): string {
  return typeof value === 'number' ? String(value) : '';
}

function optionalNumber(raw: string): number | undefined {
  return raw.trim() === '' ? undefined : Number(raw);
}
