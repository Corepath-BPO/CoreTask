import { CustomFieldType } from '@coretask/contracts';
import {
  AtSign,
  CalendarDays,
  CheckSquare,
  Hash,
  Link as LinkIcon,
  List,
  ListChecks,
  Type,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * One glyph per field type, so a list of names is scannable.
 *
 * A lookup rather than a switch in the picker: the icon belongs to the type, and
 * the same mapping is wanted by the column header, the builder and the library
 * dialog. Anything unrecognised falls back to the text glyph rather than
 * rendering nothing, because a row with a hole where its icon should be reads as
 * broken.
 */
const ICONS: Record<string, typeof Type> = {
  [CustomFieldType.TEXT]: Type,
  [CustomFieldType.NUMBER]: Hash,
  [CustomFieldType.DATE]: CalendarDays,
  [CustomFieldType.CHECKBOX]: CheckSquare,
  [CustomFieldType.SINGLE_SELECT]: List,
  [CustomFieldType.MULTI_SELECT]: ListChecks,
  [CustomFieldType.PEOPLE]: Users,
  [CustomFieldType.URL]: LinkIcon,
  [CustomFieldType.EMAIL]: AtSign,
};

export function FieldTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type] ?? Type;

  // Decorative: the field's name is right beside it, and announcing "list icon"
  // before every entry would make the list slower to listen to, not clearer.
  return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} aria-hidden="true" />;
}
