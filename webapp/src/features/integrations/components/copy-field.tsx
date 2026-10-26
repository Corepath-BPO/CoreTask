import { CopyButton } from '@/components/common/copy-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CopyFieldProps {
  label: string;
  value: string;
  id: string;
}

/** A value that is not secret — a client id, a URL — with a copy button beside it. */
export function CopyField({ label, value, id }: CopyFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton value={value} label={`Copy ${label}`} size="icon" />
      </div>
    </div>
  );
}
