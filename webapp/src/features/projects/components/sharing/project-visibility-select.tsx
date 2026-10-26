import { ProjectVisibility } from '@coretask/contracts';
import { Globe, Lock } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const OPTIONS: {
  value: ProjectVisibility;
  label: string;
  hint: string;
  Icon: typeof Globe;
}[] = [
  {
    value: ProjectVisibility.PUBLIC,
    label: 'Public to workspace',
    hint: 'Everyone in the workspace can find and open it.',
    Icon: Globe,
  },
  {
    value: ProjectVisibility.PRIVATE,
    label: 'Private to members',
    hint: 'Only members and workspace admins can see it.',
    Icon: Lock,
  },
];

/** The two-way privacy choice, used by the Share dialog and the project form. */
export function ProjectVisibilitySelect({
  id,
  value,
  onValueChange,
  disabled = false,
  ariaLabel,
}: {
  id?: string;
  value: ProjectVisibility;
  onValueChange: (value: ProjectVisibility) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as ProjectVisibility)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className="w-full"
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map(({ value: option, label, hint, Icon }) => (
          <SelectItem key={option} value={option} textValue={label}>
            <span className="flex items-start gap-2">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex flex-col">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
