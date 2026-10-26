import { CustomFieldType, RATING_MAX_STARS, RATING_MIN_STARS } from '@coretask/contracts';
import { Star } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { FormulaCandidate } from '../../lib/formula-labels';
import { currencyCodes, currencySymbol } from '../cells/currency-codes';

import { CustomFieldOptionEditor } from './custom-field-option-editor';
import { FormulaEditor } from './formula-editor';
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
  referenceFields = [],
  selfId,
}: {
  draft: FieldDraft;
  onChange: (draft: FieldDraft) => void;
  /** The project's fields, for a formula to name. */
  referenceFields?: readonly FormulaCandidate[];
  /** The field being edited, so a formula cannot name itself. */
  selfId?: string;
}) {
  const setSetting = (key: string, value: unknown) =>
    onChange({ ...draft, settings: { ...draft.settings, [key]: value } });

  const setSettings = (patch: Record<string, unknown>) =>
    onChange({ ...draft, settings: { ...draft.settings, ...patch } });

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
                <SelectItem value="SHORT">Short: one line</SelectItem>
                <SelectItem value="LONG">Long: a paragraph</SelectItem>
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
          <NumberDisplayControls settings={draft.settings} onChange={setSettings} />

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

    case CustomFieldType.RATING: {
      const stars = setting('maxRating', 5);
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="max-rating">Number of stars</Label>
            <Input
              id="max-rating"
              type="number"
              min={RATING_MIN_STARS}
              max={RATING_MAX_STARS}
              step={1}
              value={String(stars)}
              onChange={(event) => setSetting('maxRating', Number(event.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Between {RATING_MIN_STARS} and {RATING_MAX_STARS}.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Preview</Label>
            <span
              className="flex h-9 items-center gap-0.5"
              role="img"
              aria-label={`${stars} stars`}
            >
              {Array.from({ length: clampStars(stars) }, (_, index) => (
                <Star
                  key={index}
                  className={cn(
                    'size-4',
                    index < Math.ceil(clampStars(stars) / 2)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted-foreground/40',
                  )}
                  aria-hidden="true"
                />
              ))}
            </span>
          </div>
        </div>
      );
    }

    case CustomFieldType.FORMULA:
      return (
        <div className="space-y-4">
          <FormulaEditor
            expression={setting('expression', '')}
            fields={referenceFields}
            selfId={selfId}
            onChange={(expression) => setSetting('expression', expression)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberDisplayControls settings={draft.settings} onChange={setSettings} />
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

/**
 * How a number is written: plain, percentage, a currency or a custom unit.
 *
 * Shared by NUMBER and FORMULA, which display the same way. Choosing Currency
 * bumps a zero decimal-places setting to two, because "€1" for one euro fifty
 * is the kind of default that gets a field created wrong and noticed later.
 */
function NumberDisplayControls({
  settings,
  onChange,
}: {
  settings: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const format = (settings['numberFormat'] as string | undefined) ?? 'PLAIN';
  const decimals = typeof settings['decimalPlaces'] === 'number' ? settings['decimalPlaces'] : 0;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="number-format">Format</Label>
        <Select
          value={format}
          onValueChange={(value) => {
            const patch: Record<string, unknown> = { numberFormat: value };
            if (value !== 'CURRENCY') patch['currencyCode'] = undefined;
            if (value !== 'CUSTOM_UNIT') {
              patch['unitLabel'] = undefined;
              patch['unitPosition'] = undefined;
            }
            if (value === 'CURRENCY' && decimals === 0) patch['decimalPlaces'] = 2;
            if (value === 'CUSTOM_UNIT' && settings['unitPosition'] === undefined) {
              patch['unitPosition'] = 'SUFFIX';
            }
            onChange(patch);
          }}
        >
          <SelectTrigger id="number-format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PLAIN">Plain number</SelectItem>
            <SelectItem value="PERCENTAGE">Percentage</SelectItem>
            <SelectItem value="CURRENCY">Currency</SelectItem>
            <SelectItem value="CUSTOM_UNIT">Custom unit</SelectItem>
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
          value={String(decimals)}
          onChange={(event) => onChange({ decimalPlaces: Number(event.target.value) })}
        />
      </div>

      {format === 'CURRENCY' && (
        <div className="space-y-1.5">
          <Label htmlFor="currency-code">Currency</Label>
          <Select
            value={(settings['currencyCode'] as string | undefined) ?? ''}
            onValueChange={(value) => onChange({ currencyCode: value })}
          >
            <SelectTrigger id="currency-code">
              <SelectValue placeholder="Choose a currency" />
            </SelectTrigger>
            <SelectContent>
              {currencyCodes().map((code) => (
                <SelectItem key={code} value={code}>
                  <span className="flex items-center gap-2">
                    <span className="w-6 text-muted-foreground">{currencySymbol(code)}</span>
                    {code}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {format === 'CUSTOM_UNIT' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="unit-label">Unit</Label>
            <Input
              id="unit-label"
              maxLength={12}
              value={(settings['unitLabel'] as string | undefined) ?? ''}
              onChange={(event) => onChange({ unitLabel: event.target.value || undefined })}
              placeholder="pts, hrs, kg"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit-position">Unit position</Label>
            <Select
              value={(settings['unitPosition'] as string | undefined) ?? 'SUFFIX'}
              onValueChange={(value) => onChange({ unitPosition: value })}
            >
              <SelectTrigger id="unit-position">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PREFIX">Before the number</SelectItem>
                <SelectItem value="SUFFIX">After the number</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </>
  );
}

function clampStars(value: unknown): number {
  const stars = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 5;
  return Math.min(RATING_MAX_STARS, Math.max(1, stars));
}

/** `undefined` shows the placeholder; `0` is a real value and must not vanish. */
function numberValue(value: unknown): string {
  return typeof value === 'number' ? String(value) : '';
}

function optionalNumber(raw: string): number | undefined {
  return raw.trim() === '' ? undefined : Number(raw);
}
