# Integrations: API keys and webhooks

Base URL: `/api/v1`. Interactive reference: `/api/docs`. Both features are managed
under **Integrations** in the app by a workspace admin.

## Two directions

| Direction | Mechanism                                   | Typical use                                     |
| --------- | ------------------------------------------- | ----------------------------------------------- |
| Inbound   | Workspace API key on the existing REST API  | n8n creates a task, later completes it          |
| Outbound  | Signed webhook `POST` to a URL you register | n8n reacts when a task is completed in CoreTask |

## Inbound: API keys

See [authentication.md](authentication.md#api-keys-integrations) for the security
model. The short version: a key is `ctk_` plus 43 URL-safe characters, sent as
`X-API-Key: ctk_…` (or `Authorization: Bearer ctk_…`), and acts as a hidden
service account in one workspace with the role it was given.

Everything a key does is attributed to that account under the key's name, and
the app badges it **Integration** wherever an author or actor is shown. User
objects in responses carry `isServiceAccount: true` for it.

### The n8n recipe

1. Create a key under **Integrations → API keys**. Copy it; it is shown once.
2. In n8n, add a **Header Auth** credential: name `X-API-Key`, value the key.
3. Add an **HTTP Request** node using that credential.

Check the key and learn the workspace id:

```http
GET /api/v1/integration/whoami
```

```json
{
  "principal": "api_key",
  "user": { "id": "…", "name": "n8n", "email": "api-key-…@integrations.coretask.invalid" },
  "workspace": { "id": "01a0…", "name": "CoreTask Demo", "slug": "coretask-demo" },
  "apiKey": { "id": "…", "name": "n8n", "role": "MEMBER" }
}
```

Find where to file work:

```http
GET /api/v1/workspaces/{workspaceId}/projects
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/sections
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/field-metadata
```

Create a task and keep its id:

```http
POST /api/v1/workspaces/{workspaceId}/tasks
{ "title": "Filed from n8n", "sectionId": "…", "description": "…", "priority": "HIGH" }
```

The response's `data.id` is the task. Complete it later:

```http
PATCH /api/v1/workspaces/{workspaceId}/tasks/{taskId}
{ "status": "DONE" }
```

Comment on it:

```http
POST /api/v1/workspaces/{workspaceId}/tasks/{taskId}/comments
{ "body": "Synced from the CRM." }
```

Set custom fields inline by creating through the project's work-items route
instead (`POST …/projects/{projectId}/work-items` with `customFieldValues`), or
per field with `PUT …/tasks/{taskId}/custom-fields/{fieldId}`.

Every response is the standard envelope: `{ success, data, meta }` or
`{ success: false, error: { code, message } }`. Branch on `error.code`:

| Code                          | Status | What to do                                 |
| ----------------------------- | ------ | ------------------------------------------ |
| `API_KEY_INVALID`             | 401    | The key is wrong; check the credential     |
| `API_KEY_REVOKED`             | 401    | An admin revoked it; create a new key      |
| `API_KEY_EXPIRED`             | 401    | Past its expiry; create a new key          |
| `API_KEY_NOT_ALLOWED`         | 403    | That route needs a signed-in person        |
| `WORKSPACE_ACCESS_DENIED`     | 403    | Wrong workspace id for this key            |
| `INSUFFICIENT_WORKSPACE_ROLE` | 403    | The key's role cannot do that              |
| `VALIDATION_FAILED`           | 422    | `error.details.issues` names the bad field |
| `RATE_LIMIT_EXCEEDED`         | 429    | Slow down; the limit is per key            |

### Safe retries: `Idempotency-Key`

A workflow that retries on a timeout can create the same task twice. Send an
`Idempotency-Key` header with any create — tasks, tickets, comments and work
items accept it — and a repeat within 24 hours gets the first response back
instead of a second record:

```http
POST /api/v1/workspaces/{workspaceId}/tasks
Idempotency-Key: {{ $execution.id }}-{{ $itemIndex }}
{ "title": "Filed from n8n", "sectionId": "…" }
```

- The key is anything unique to the attempt, up to 255 characters. In n8n,
  the execution id plus the item index works well.
- A replayed response carries `Idempotency-Replayed: true` and is byte-for-byte
  the original.
- The same key with a different body or path is refused with 422
  `IDEMPOTENCY_KEY_REUSED`. A repeat while the first request is still running
  gets 409 `IDEMPOTENCY_IN_PROGRESS`.
- Keys are scoped to the caller: two API keys may use the same value.
- A request that failed is not remembered, so the retry runs for real.

## Outbound: webhooks

An admin registers an endpoint under **Integrations → Webhooks**: a URL, the
events it wants, optionally one project. CoreTask then POSTs a JSON event to it
whenever one of those things happens, signs every request, retries failures, and
lists every attempt on the page.

### Events

| Type                    | When                                     | `data`                           |
| ----------------------- | ---------------------------------------- | -------------------------------- |
| `task.created`          | A task is created                        | `{ task }`                       |
| `task.updated`          | Any field edit, with `changes`           | `{ task }`                       |
| `task.completed`        | Status becomes done                      | `{ task }`                       |
| `task.moved`            | Moved to another section                 | `{ task }`                       |
| `task.assigned`         | Assignee changes                         | `{ task }`                       |
| `task.due_date_changed` | Due date changes                         | `{ task }`                       |
| `comment.created`       | A comment is added to a task or ticket   | `{ comment, task, ticket }`      |
| `ticket.created`        | A ticket is reported                     | `{ ticket }`                     |
| `ticket.status_changed` | Ticket status changes                    | `{ ticket }`                     |
| `custom_field.changed`  | A custom field value changes             | `{ task, field, value }`         |
| `ping`                  | "Send test event" was pressed            | `{ endpointId, name, message }`  |
| `automation.webhook`    | A "Send a webhook" automation action ran | `{ task, rule, trigger, extra }` |

One edit can raise several events: completing a task raises `task.updated` and
`task.completed`. Subscribe to `task.updated` alone if you want one notification
per edit; its `changes` object says what changed.

### Payload

```json
{
  "id": "01a0…",
  "type": "task.completed",
  "createdAt": "2026-09-15T08:12:44.201Z",
  "workspaceId": "…",
  "projectId": "…",
  "actor": { "id": "…", "name": "Demo Owner", "kind": "user" },
  "causedByRuleId": null,
  "correlationId": "…",
  "data": { "task": { "id": "…", "title": "…", "status": "DONE", "…": "…" } },
  "changes": { "status": { "before": "IN_PROGRESS", "after": "DONE" } }
}
```

- `id` is stable across retries: treat it as your idempotency key.
- `actor.kind` is `integration` when an API key's service account made the change,
  so a tool can ignore its own writes.
- `causedByRuleId` is set when an automation rule made the change.
- `data.task` is exactly what `GET /tasks/{id}` returns at delivery time; `null`
  if the item was deleted in between.

### Headers

| Header                 | Value                                                   |
| ---------------------- | ------------------------------------------------------- |
| `X-CoreTask-Event`     | The event type                                          |
| `X-CoreTask-Event-Id`  | Same as the payload `id`                                |
| `X-CoreTask-Delivery`  | This attempt's delivery id                              |
| `X-CoreTask-Workspace` | The workspace id                                        |
| `X-CoreTask-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` |
| `User-Agent`           | `CoreTask-Webhooks/1.0`                                 |

### Verifying the signature

The secret is shown once when the endpoint is created (or rotated). Compute
HMAC-SHA256 over the string `"<t>.<raw body>"` with it and compare to `v1`;
reject if `|now − t|` is more than 300 seconds.

In an n8n **Webhook** node, enable _Raw Body_, then in a **Code** node:

```js
const crypto = require("crypto");
const secret = $env.CORETASK_WEBHOOK_SECRET;
const header = $input.first().headers["x-coretask-signature"];
const raw = $input.first().binary.data
  ? Buffer.from($input.first().binary.data.data, "base64").toString()
  : JSON.stringify($input.first().json.body);

const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
if (expected !== parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) {
  throw new Error("Bad CoreTask signature");
}
return $input.all();
```

### Delivery, retries and health

- Timeout 10 s; redirects are not followed.
- A 2xx is success. 408, 425, 429 and 5xx (and network errors) are retried with
  exponential backoff from 30 s, five attempts by default. Other 4xx are final.
- After 20 consecutive final failures the endpoint disables itself and says so
  on the page; re-enabling it clears the count.
- A settled delivery can be pushed again — **Redeliver** in the deliveries
  panel, or the endpoint below. The same bytes go out, signed afresh, and the
  earlier attempts stay on the record.
- Delivery records are kept for 30 days (`WEBHOOK_DELIVERY_RETENTION_DAYS`);
  the worker purges older settled ones daily.
- Deliveries are made by the worker process, so it must be running.

Environment: `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`,
`WEBHOOK_RETRY_BASE_DELAY_MS`, `WEBHOOK_AUTO_DISABLE_AFTER`,
`WEBHOOK_DELIVERY_RETENTION_DAYS`, `WEBHOOK_ALLOW_PRIVATE_URLS` (allow localhost
and private networks — needed when n8n runs on the same machine),
`WEBHOOK_SECRET_ENCRYPTION_KEY` (required in production).

### Management endpoints

All require ADMIN and a signed-in session (never an API key).

| Method | Path                                                 | Purpose                                    |
| ------ | ---------------------------------------------------- | ------------------------------------------ |
| GET    | `/workspaces/{ws}/webhooks`                          | List endpoints (never the secret)          |
| POST   | `/workspaces/{ws}/webhooks`                          | Add; returns `{ endpoint, secret }` once   |
| GET    | `/workspaces/{ws}/webhooks/{id}`                     | One endpoint                               |
| PATCH  | `/workspaces/{ws}/webhooks/{id}`                     | Change name, URL, events, project, enabled |
| DELETE | `/workspaces/{ws}/webhooks/{id}`                     | Remove, with its deliveries                |
| POST   | `/workspaces/{ws}/webhooks/{id}/rotate-secret`       | New secret, returned once                  |
| POST   | `/workspaces/{ws}/webhooks/{id}/test`                | Queue a `ping`                             |
| GET    | `/workspaces/{ws}/webhook-deliveries?endpointId=…`   | Deliveries, newest first, `before` cursor  |
| GET    | `/workspaces/{ws}/webhook-deliveries/{id}`           | Payload, response and every attempt        |
| POST   | `/workspaces/{ws}/webhook-deliveries/{id}/redeliver` | Queue a settled delivery again (202)       |
