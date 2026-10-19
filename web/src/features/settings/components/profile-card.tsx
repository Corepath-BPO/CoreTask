import {
  OUT_OF_OFFICE_NOTE_MAX,
  PROFILE_ABOUT_ME_MAX,
  PROFILE_DEPARTMENT_MAX,
  PROFILE_JOB_TITLE_MAX,
  PROFILE_PRONOUNS_MAX,
} from '@coretask/contracts';
import type { AuthUser } from '@coretask/types';
import { useMemo, useState } from 'react';

import { OutOfOfficeHint } from '@/components/data-display/out-of-office';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { timeZones } from '@/features/automations/builder/configuration/timed-triggers';
import { ymd } from '@/lib/utils';

import { useUpdateProfile } from '../hooks/use-profile';

interface Draft {
  name: string;
  pronouns: string;
  jobTitle: string;
  department: string;
  aboutMe: string;
  timezone: string;
  away: boolean;
  from: string;
  until: string;
  note: string;
}

const draftOf = (user: AuthUser): Draft => ({
  name: user.name,
  pronouns: user.pronouns ?? '',
  jobTitle: user.jobTitle ?? '',
  department: user.department ?? '',
  aboutMe: user.aboutMe ?? '',
  timezone: user.timezone,
  away: user.outOfOffice !== null,
  from: user.outOfOffice?.from ?? ymd(new Date()),
  until: user.outOfOffice?.until ?? ymd(new Date()),
  note: user.outOfOffice?.note ?? '',
});

/**
 * Asana's "My profile settings": your name and how the workspace sees you —
 * pronouns, title, department, a line about yourself, your time zone — and
 * time off, which pickers show beside your name while it lasts.
 */
export function ProfileCard({ user }: { user: AuthUser }) {
  const update = useUpdateProfile();
  const [draft, setDraft] = useState<Draft>(() => draftOf(user));
  const zones = useMemo(() => [...new Set([user.timezone, ...timeZones()])], [user.timezone]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const saved = draftOf(user);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const nameError = draft.name.trim() === '' ? 'Your name cannot be empty.' : null;
  const awayError =
    draft.away && (!draft.from || !draft.until || draft.until < draft.from)
      ? 'Time off has to end on or after it starts.'
      : null;

  const save = () =>
    update.mutate({
      name: draft.name.trim(),
      pronouns: draft.pronouns,
      jobTitle: draft.jobTitle,
      department: draft.department,
      aboutMe: draft.aboutMe,
      timezone: draft.timezone,
      outOfOffice: draft.away
        ? { from: draft.from, until: draft.until, note: draft.note.trim() || null }
        : null,
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>How people in your workspaces see you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={draft.name}
            maxLength={120}
            aria-invalid={Boolean(nameError)}
            onChange={(event) => set('name', event.target.value)}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-pronouns">Pronouns</Label>
            <Input
              id="profile-pronouns"
              value={draft.pronouns}
              maxLength={PROFILE_PRONOUNS_MAX}
              placeholder="she/her"
              onChange={(event) => set('pronouns', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-title">Job title</Label>
            <Input
              id="profile-title"
              value={draft.jobTitle}
              maxLength={PROFILE_JOB_TITLE_MAX}
              onChange={(event) => set('jobTitle', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-department">Department</Label>
            <Input
              id="profile-department"
              value={draft.department}
              maxLength={PROFILE_DEPARTMENT_MAX}
              onChange={(event) => set('department', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-timezone">Time zone</Label>
            <select
              id="profile-timezone"
              value={draft.timezone}
              onChange={(event) => set('timezone', event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-about">About me</Label>
          <Textarea
            id="profile-about"
            rows={3}
            value={draft.aboutMe}
            maxLength={PROFILE_ABOUT_ME_MAX}
            onChange={(event) => set('aboutMe', event.target.value)}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            Out of office
            <Switch checked={draft.away} onCheckedChange={(checked) => set('away', checked)} />
          </label>
          {draft.away && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-away-from">From</Label>
                  <Input
                    id="profile-away-from"
                    type="date"
                    value={draft.from}
                    onChange={(event) => set('from', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-away-until">Until</Label>
                  <Input
                    id="profile-away-until"
                    type="date"
                    value={draft.until}
                    onChange={(event) => set('until', event.target.value)}
                  />
                </div>
              </div>
              <Input
                aria-label="Note for people assigning you work"
                value={draft.note}
                maxLength={OUT_OF_OFFICE_NOTE_MAX}
                placeholder="Back on Monday; ask Bea in the meantime"
                onChange={(event) => set('note', event.target.value)}
              />
              {awayError ? (
                <p className="text-xs text-destructive">{awayError}</p>
              ) : (
                <OutOfOfficeHint period={{ from: draft.from, until: draft.until }} />
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={!dirty || Boolean(nameError) || Boolean(awayError) || update.isPending}
          >
            Save profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
