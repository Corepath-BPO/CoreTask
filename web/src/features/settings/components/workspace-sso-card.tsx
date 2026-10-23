import { WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { SamlConnection, WorkspaceDomain } from '@coretask/types';
import {
  samlConnectionSchema,
  workspaceDomainSchema,
  type SamlConnectionInput,
} from '@coretask/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Globe, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { CopyButton } from '@/components/common/copy-button';
import { FormError } from '@/components/feedback/form-error';
import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/api-error';

import {
  useAddDomain,
  useConnectSaml,
  useDeleteSamlConnection,
  useRemoveDomain,
  useSamlConnection,
  useSaveSamlConnection,
  useVerifyDomain,
  useWorkspaceDomains,
} from '../hooks/use-sso-settings';

const EMPTY_DRAFT = { idpEntityId: '', idpSsoUrl: '', idpCertificate: '', enabled: false };

/**
 * Settings › Single sign-on, for admins and owners: the workspace's SAML
 * identity provider, in the order it is set up — the addresses to give the
 * provider, the provider's own details, then the domains that let it sign
 * in, and create, accounts at those addresses.
 */
export function WorkspaceSsoCard({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const canManage = hasAtLeastRole(role, WorkspaceRole.ADMIN);
  const connection = useSamlConnection(workspaceId, canManage);

  if (!canManage) return null;

  const current = connection.data ?? null;
  const state = !current ? 'Not set up' : current.enabled ? 'On' : 'Off';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Single sign-on</CardTitle>
          {!connection.isLoading && (
            <Badge variant={current?.enabled ? 'success' : 'muted'}>{state}</Badge>
          )}
        </div>
        <CardDescription>
          Let people sign in through your identity provider — Okta, Microsoft Entra ID, Google
          Workspace or any other that speaks SAML 2.0.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-1">
        {connection.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <ServiceProviderDetails workspaceId={workspaceId} connection={current} />
            <IdentityProviderForm
              key={current?.updatedAt ?? 'new'}
              workspaceId={workspaceId}
              connection={current}
            />
            <Domains workspaceId={workspaceId} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Step 1. The addresses derive from the saved connection, so a draft has to exist first. */
function ServiceProviderDetails({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: SamlConnection | null;
}) {
  const save = useSaveSamlConnection(workspaceId);

  if (!connection) {
    return (
      <Section title="1. Give your identity provider these">
        <p className="text-sm text-muted-foreground">
          Make a CoreTask app at your identity provider with CoreTask’s addresses. Nothing changes
          for anyone until you turn single sign-on on.
        </p>
        <FormError
          message={
            save.error instanceof ApiError ? save.error.message : save.error ? 'Try again.' : null
          }
        />
        <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(EMPTY_DRAFT)}>
          Get CoreTask’s addresses
        </Button>
      </Section>
    );
  }

  const rows = [
    { label: 'Entity ID (audience)', value: connection.serviceProvider.entityId },
    { label: 'ACS URL (reply URL)', value: connection.serviceProvider.acsUrl },
    { label: 'Metadata URL', value: connection.serviceProvider.metadataUrl },
  ];

  return (
    <Section title="1. Give your identity provider these">
      {rows.map((row) => {
        const id = `sp-${row.label.split(' ')[0]?.toLowerCase()}`;
        return (
          <div key={row.label} className="space-y-1.5">
            <Label htmlFor={id}>{row.label}</Label>
            <div className="flex gap-2">
              <Input id={id} value={row.value} readOnly className="font-mono text-xs" />
              <CopyButton value={row.value} label={`Copy ${row.label}`} />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Send the address as the NameID, or an <code>email</code> attribute, and sign the assertion.
      </p>
    </Section>
  );
}

/** Step 2. Saved switched off while it is being filled in; on, every field is needed. */
function IdentityProviderForm({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: SamlConnection | null;
}) {
  const save = useSaveSamlConnection(workspaceId);
  const remove = useDeleteSamlConnection(workspaceId);
  const connectMine = useConnectSaml();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<SamlConnectionInput>({
    resolver: zodResolver(samlConnectionSchema),
    defaultValues: connection
      ? {
          idpEntityId: connection.idpEntityId,
          idpSsoUrl: connection.idpSsoUrl,
          idpCertificate: connection.idpCertificate,
          enabled: connection.enabled,
        }
      : EMPTY_DRAFT,
  });

  const onSubmit = handleSubmit((values) => save.mutate(values));
  const serverError =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? 'Could not save. Try again.'
        : null;

  return (
    <Section title="2. Then fill in your identity provider’s details">
      <FormError message={serverError} />
      <form noValidate className="space-y-4" onSubmit={onSubmit}>
        <Field
          label="Identity provider entity ID"
          htmlFor="idp-entity-id"
          error={errors.idpEntityId?.message}
        >
          <Input
            {...fieldAria('idp-entity-id', errors.idpEntityId?.message)}
            {...register('idpEntityId')}
            placeholder="http://www.okta.com/exk1…"
          />
        </Field>
        <Field label="Sign-in URL" htmlFor="idp-sso-url" error={errors.idpSsoUrl?.message}>
          <Input
            {...fieldAria('idp-sso-url', errors.idpSsoUrl?.message)}
            {...register('idpSsoUrl')}
            type="url"
            placeholder="https://acme.okta.com/app/…/sso/saml"
          />
        </Field>
        <Field
          label="Signing certificate"
          htmlFor="idp-certificate"
          error={errors.idpCertificate?.message}
        >
          <Textarea
            {...fieldAria('idp-certificate', errors.idpCertificate?.message)}
            {...register('idpCertificate')}
            rows={4}
            className="font-mono text-xs"
            placeholder="-----BEGIN CERTIFICATE-----"
          />
        </Field>
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <Label htmlFor="sso-enabled" className="font-normal">
                Let people sign in with it
              </Label>
              <Switch id="sso-enabled" checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>
            Save
          </Button>
          {connection?.enabled && (
            <Button
              type="button"
              variant="outline"
              loading={connectMine.isPending}
              onClick={() => connectMine.mutate(workspaceId)}
            >
              Connect my account
            </Button>
          )}
          {connection && (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-destructive"
              loading={remove.isPending}
              onClick={() => setConfirmRemove(true)}
            >
              Remove single sign-on
            </Button>
          )}
        </div>
      </form>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove single sign-on?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone’s connection to your identity provider goes with it. Their accounts stay;
              people with no password set one from the sign-in page’s “Forgot password?”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

/** Step 3. A verified domain is what lets the provider speak for every address in it. */
function Domains({ workspaceId }: { workspaceId: string }) {
  const domains = useWorkspaceDomains(workspaceId);
  const add = useAddDomain(workspaceId);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  const onAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = workspaceDomainSchema.safeParse({ domain: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a domain such as example.com.');
      return;
    }
    setError(undefined);
    add.mutate(parsed.data.domain, {
      onSuccess: () => setValue(''),
      onError: (failure) =>
        setError(failure instanceof ApiError ? failure.message : 'Could not add it. Try again.'),
    });
  };

  return (
    <Section title="3. Verify your e-mail domains">
      <p className="text-sm text-muted-foreground">
        Once a domain is verified, anyone your identity provider signs in with an address there gets
        in — as a member, with an account made for them if they have none. Until then it signs in
        only people who connected it themselves.
      </p>

      {domains.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <ul className="space-y-2">
          {(domains.data ?? []).map((domain) => (
            <DomainRow key={domain.id} workspaceId={workspaceId} domain={domain} />
          ))}
        </ul>
      )}

      <form noValidate className="flex items-start gap-2" onSubmit={onAdd}>
        <div className="flex-1">
          <Field label="Domain" htmlFor="sso-domain" error={error}>
            <Input
              {...fieldAria('sso-domain', error)}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="example.com"
            />
          </Field>
        </div>
        <Button type="submit" variant="outline" className="mt-[1.6rem]" loading={add.isPending}>
          Add
        </Button>
      </form>
    </Section>
  );
}

function DomainRow({ workspaceId, domain }: { workspaceId: string; domain: WorkspaceDomain }) {
  const verify = useVerifyDomain(workspaceId);
  const remove = useRemoveDomain(workspaceId);

  return (
    <li className="space-y-2 rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{domain.domain}</span>
        {domain.verified ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden="true" />
            Verified
          </Badge>
        ) : (
          <Badge variant="muted">Not verified</Badge>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${domain.domain}`}
          loading={remove.isPending}
          onClick={() => remove.mutate(domain.id)}
        >
          <Trash2 />
        </Button>
      </div>
      {!domain.verified && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Publish this TXT record at <strong className="text-foreground">{domain.domain}</strong>,
            then check it. DNS changes can take a while to show up.
          </p>
          <div className="flex gap-2">
            <Input
              value={domain.txtRecord}
              readOnly
              aria-label={`TXT record for ${domain.domain}`}
              className="font-mono text-xs"
            />
            <CopyButton
              value={domain.txtRecord}
              label={`Copy the TXT record for ${domain.domain}`}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              loading={verify.isPending}
              onClick={() => verify.mutate(domain.id)}
            >
              Verify
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
