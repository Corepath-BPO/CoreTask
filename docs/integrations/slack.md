# The CoreTask Slack app

Two-way Slack, the way Asana's Slack app works:

- **From Slack into CoreTask.** `/coretask <task name>` opens a form for the
  project, assignee, due date and description; **Create a CoreTask task** on
  any message makes a task from it, with a link back to the message; buttons
  under a project's posts mark the task complete or assign it to whoever
  pressed them.
- **From CoreTask into Slack.** A project posts its updates to a channel
  (Customize › Apps), as the CoreTask app — so its posts carry those buttons —
  or through an incoming webhook as before.

Everything done from Slack is done in CoreTask _as a person_: each Slack user
links their CoreTask account once, and from then on gets exactly the access
they have in the app. A private project they are not in does not appear in
the form's project menu, and its tasks' buttons tell them nothing changed.
Nobody unlinked can do anything but be asked to link.

## Setting it up

### 1. Create the Slack app

At [api.slack.com/apps](https://api.slack.com/apps) choose **Create New App ›
From a manifest**, pick the workspace you develop in, and paste the manifest
below with the two addresses replaced:

- `API_PUBLIC` — where Slack reaches the API over HTTPS, e.g.
  `https://coretask-api.example.org`. Until there is a domain, a tunnel to the
  API's port (3010 in Docker): `cloudflared tunnel --url http://localhost:3010`
  or `ngrok http 3010`.
- `WEB_PUBLIC` — where the web app is opened, e.g. `https://app.example.org`.
  Slack sends the browser back here after an install. Slack asks for HTTPS
  redirect URLs; while developing, open the web app through a tunnel to 5173
  too, and put that address **first** in `WEB_URL` (it may hold several,
  comma-separated) — the first is the one CoreTask tells Slack to return to.

```yaml
display_information:
  name: CoreTask
  description: Make tasks and act on them without leaving the conversation.
  background_color: "#1f2937"
features:
  bot_user:
    display_name: CoreTask
    always_online: false
  slash_commands:
    - command: /coretask
      url: API_PUBLIC/api/v1/integrations/slack/commands
      description: Make a task, or link your CoreTask account
      usage_hint: "<task name> | link | unlink | help"
      should_escape: false
  shortcuts:
    - name: Create a CoreTask task
      type: message
      callback_id: coretask_create_from_message
      description: A task from this message, with a link back to it
    - name: New CoreTask task
      type: global
      callback_id: coretask_create_task
      description: Make a task in CoreTask
oauth_config:
  redirect_urls:
    - WEB_PUBLIC/integrations/slack/callback
  scopes:
    bot:
      - commands
      - chat:write
      - chat:write.public
      - channels:read
      - groups:read
settings:
  interactivity:
    is_enabled: true
    request_url: API_PUBLIC/api/v1/integrations/slack/interactions
    message_menu_options_url: API_PUBLIC/api/v1/integrations/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

The scopes are the five in `SLACK_BOT_SCOPES` (contracts `slack.ts`), each a
line on Slack's consent screen: `commands` for the command and shortcuts,
`chat:write` to post and to redraw a post after a button press,
`chat:write.public` to post in a public channel without being invited, and
`channels:read` / `groups:read` for the channel picker.

### 2. Give CoreTask the app's credentials

From the app's **Basic Information** page, into `.env` — all three or none;
the API refuses to start with a partial set:

```dotenv
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
```

Then `docker compose up -d` so the API and worker pick them up.

### 3. Connect a workspace

A workspace admin opens **Integrations › Slack › Add to Slack**, allows the
app in Slack, and lands back on the Slack tab, connected. Whoever approved it
in Slack is linked to their CoreTask account on the spot. Everyone else types
`/coretask link` in Slack and follows the button.

One Slack workspace serves one CoreTask workspace — a command has to know
where it is — so connecting a Slack workspace that already serves another
CoreTask workspace is refused, naming it.

## How it works

| Piece                                             | Where                                                     |
| ------------------------------------------------- | --------------------------------------------------------- |
| Install, disconnect, account links                | `api/src/modules/slack/slack.service.ts`                  |
| Commands, shortcuts, modal, menus, buttons        | `api/src/modules/slack/slack-interactions.service.ts`     |
| Block Kit (the form, the buttons, the replies)    | `api/src/modules/slack/lib/slack-blocks.ts`               |
| Request signatures                                | `api/src/modules/slack/lib/slack-signature.ts`, the guard |
| Slack's Web API                                   | `api/src/integrations/slack/slack-api.client.ts`          |
| Posting as the bot                                | `WebhookDeliveryService.postAsSlackBot`                   |
| Integrations › Slack, the callback and link pages | `webapp/src/features/integrations/pages/slack-*.tsx`      |
| The channel picker                                | `customize-apps-section.tsx`                              |

**Installing.** `POST /workspaces/:id/slack/install` (admins, signed in)
answers Slack's consent address with a `state` CoreTask signed: the workspace,
the admin, ten minutes. Slack returns the browser to the web app's
`/integrations/slack/callback`, which posts the code and state to
`POST /integrations/slack/install` _with the admin's session_. The state must
name the person posting it, so a link someone else started cannot be
finished by you, nor yours by them. The bot token is stored encrypted with
the same key as webhook signing secrets (`WEBHOOK_SECRET_ENCRYPTION_KEY`).

**Linking.** `/coretask link` — or any action by someone unlinked — answers
with a button only that Slack user sees, to `/integrations/slack/link?token=…`.
The token is signed and names the installation and the Slack user, for 30
minutes. The page says which Slack workspace, which CoreTask workspace, and
who you are signed in as, then links on your say-so. A Slack account is one
person and a person has one Slack account per Slack workspace, so linking
replaces either side's earlier link. Only members of the connected workspace
can link.

**Slack's requests.** `/integrations/slack/commands` and `/interactions` have
no session: `SlackSignatureGuard` checks Slack's `v0` HMAC over the raw body
(the app keeps it: `rawBody: true` in `create-app.ts`) and refuses anything
signed more than five minutes ago. Answers are Slack's shapes, not the
envelope. Slack waits three seconds; every path is a database read or two and
at most one call back to Slack.

**The form.** Project and assignee are `external_select` menus, searched as
you type through `block_suggestion` on the interactions URL — any number of
projects or people fits. Projects are those the person can see. On submit the
task is made by `TasksService.create` as the linked person, in the project's
first section, and the modal turns into a confirmation linking to the task.
Errors appear beside the field they are about.

**Buttons.** A channel post from the bot carries **Mark complete**, **Assign
to me** and **Open in CoreTask** (an approval gets no Mark complete — it is
decided in CoreTask; a completed task keeps only Open). A press is done by
`TasksService.update` as the presser, then the post is redrawn with
`chat.update`: a line saying who did what, and the buttons for the task as it
is now. Someone unlinked, or without access, gets a small modal instead, and
nothing changes.

**Channels.** Customize › Apps › Slack offers **As the CoreTask app** when the
workspace has Slack: a channel picker (public channels, and private ones the
app was invited to), checked with Slack on save. Underneath it is the same
webhook endpoint as an incoming-webhook app — retries, the delivery log,
switching off after repeated failures — whose `url` is
`slack://channel/<id>` and which the delivery service posts with
`chat.postMessage` instead of an HTTP POST. Slack's own error code decides a
retry: `ratelimited` waits, `channel_not_found` fails for good.

**Disconnecting.** Revokes the bot token (Slack removes the app with it),
forgets every link, and switches off the channels the app posted to with
_Slack was disconnected from this workspace._ — they stay listed, and cannot
be switched back on until Slack is connected again.

## Testing without Slack

`api/test/e2e/slack.e2e-spec.ts` stands a small HTTP server in for Slack's Web
API (`SLACK_API_BASE_URL`, `SLACK_AUTHORIZE_URL`) and signs requests to
CoreTask with a test signing secret, exactly as Slack signs them — install,
linking, the command, the form, the menus, posting, both buttons, retries and
disconnecting. Nothing leaves the machine.
