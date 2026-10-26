import {
  WEBHOOK_EXTRA_FIELDS_MAX,
  webhookExtraFieldRows,
  type WebhookExtraField,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';
import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Radix `Select` treats `''` as "no value", so "a URL I type" needs a real token. */
const AD_HOC = '__url__';

interface SendWebhookFieldsProps {
  configuration: Record<string, unknown>;
  metadata: AutomationMetadata | undefined;
  onChange: (configuration: Record<string, unknown>) => void;
}

/**
 * Where a "Send a webhook" step sends, and what extra it says.
 *
 * Two destinations: an endpoint registered under Integrations (signed with its
 * secret, listed with its deliveries) or a URL typed here (unsigned — there is
 * no secret in a rule, because every member can read a rule). Extra fields are
 * plain key/value pairs merged into the payload as `data.extra`, so a flow can
 * tell one rule's sends from another's.
 */
export function SendWebhookFields({ configuration, metadata, onChange }: SendWebhookFieldsProps) {
  const endpointId =
    typeof configuration['endpointId'] === 'string' ? configuration['endpointId'] : '';
  const url = typeof configuration['url'] === 'string' ? configuration['url'] : '';
  const rows = webhookExtraFieldRows(configuration['extraFields']);
  const endpoints = metadata?.webhookEndpoints ?? [];

  // One destination at a time: choosing an endpoint clears the URL and vice
  // versa, so a stored step never carries both and leaves the runner guessing.
  const chooseDestination = (value: string) => {
    if (value === AD_HOC) {
      onChange({ ...configuration, endpointId: '', url });
    } else {
      onChange({ ...configuration, endpointId: value, url: '' });
    }
  };

  const setUrl = (next: string) => onChange({ ...configuration, endpointId: '', url: next });

  const writeRows = (next: WebhookExtraField[]) =>
    onChange({ ...configuration, extraFields: next });

  const urlError =
    url !== '' && !z.url().safeParse(url).success
      ? 'Enter a full URL, starting with https:// or http://.'
      : undefined;

  const destination = endpointId !== '' ? endpointId : url !== '' ? AD_HOC : '';

  return (
    <div className="space-y-4">
      <Field
        label="Send to"
        htmlFor="step-webhook-destination"
        hint={
          endpoints.length === 0
            ? 'No webhook endpoints are set up yet. Add one under Integrations to sign deliveries, or enter a URL.'
            : 'Endpoints from Integrations are signed; a URL entered here is not.'
        }
      >
        <Select value={destination} onValueChange={chooseDestination}>
          <SelectTrigger id="step-webhook-destination" className="w-full">
            <SelectValue placeholder="Choose an endpoint or a URL" />
          </SelectTrigger>
          <SelectContent>
            {endpoints.map((endpoint) => (
              <SelectItem key={endpoint.id} value={endpoint.id} disabled={!endpoint.enabled}>
                {endpoint.name}
                <span className="ml-1 text-xs text-muted-foreground">
                  · {endpoint.host}
                  {endpoint.enabled ? '' : ' (disabled)'}
                </span>
              </SelectItem>
            ))}
            <SelectItem value={AD_HOC}>A URL I enter…</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {destination === AD_HOC && (
        <Field
          label="URL"
          htmlFor="step-webhook-url"
          error={urlError}
          hint="Sent unsigned. Local and private addresses need the deployment to allow them."
        >
          <Input
            {...fieldAria('step-webhook-url', urlError)}
            type="url"
            inputMode="url"
            placeholder="https://n8n.example.com/webhook/coretask"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Extra fields</p>
          <span className="text-xs text-muted-foreground">Added to the payload as data.extra</span>
        </div>

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Optional. A name or tag so the receiver knows which rule sent this.
          </p>
        )}

        <ul className="space-y-2" aria-label="Extra fields">
          {rows.map((row, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Field ${index + 1} name`}
                placeholder="key"
                value={row.key}
                className="font-mono text-xs"
                onChange={(event) =>
                  writeRows(
                    rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)),
                  )
                }
              />
              <Input
                aria-label={`Field ${index + 1} value`}
                placeholder="value"
                value={row.value}
                onChange={(event) =>
                  writeRows(
                    rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)),
                  )
                }
              />
              <button
                type="button"
                aria-label={`Remove field ${index + 1}`}
                onClick={() => writeRows(rows.filter((_, i) => i !== index))}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>

        {rows.length < WEBHOOK_EXTRA_FIELDS_MAX && (
          <button
            type="button"
            onClick={() => writeRows([...rows, { key: '', value: '' }])}
            className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add field
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Deliveries from this rule are listed under Integrations → Webhooks.
      </p>
    </div>
  );
}
