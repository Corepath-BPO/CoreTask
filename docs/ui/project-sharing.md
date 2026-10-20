# Project sharing and privacy

What Asana's project header, Share dialog and browse list show for privacy,
and what CoreTask renders for each. "Parity" here means the same information
in the same places, with CoreTask's own tokens, type and spacing — not pixel
copying. The rules behind it are in
[ADR 0016](../decisions/0016-project-privacy-is-a-membership-list.md); the API
in [project-members.md](../api/project-members.md).

## Reference to component

| Asana                                                   | Component today                                                           | State |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ----- |
| Padlock beside a private project's name                 | `sharing/project-privacy-badge.tsx` — header, browse row, card            | built |
| Members avatar stack in the header, opens Share         | `sharing/project-members-stack.tsx` (from the summary's preview)          | built |
| **Share** button                                        | `project-header.tsx` — primary, for everyone                              | built |
| **Join** on a public project you are not on             | `project-header.tsx`, browse row                                          | built |
| Leave project                                           | header caret menu; the Share dialog's own row                             | built |
| Share dialog: members list with a role per row          | `sharing/share-project-dialog.tsx` — Admin / Editor / Viewer              | built |
| Share dialog: add people                                | the same — a workspace-member picker plus a role for the additions        | built |
| Share dialog: privacy ("Private to members")            | `sharing/project-visibility-select.tsx`, confirmed before private         | built |
| Share dialog: copy project link                         | the same                                                                  | built |
| Share dialog: invite by e-mail                          | the same — type an address that is not in the workspace                   | built |
| Share dialog: manage notifications                      | `project-notifications-button.tsx` — a bell beside the star, members only | built |
| Commenter role                                          | the same role pickers — reads, comments, likes, replies; edits nothing    | built |
| Browse list: Members filter                             | `projects-page.tsx` — Anyone / I'm a member / Private to members          | built |
| Browse list: Members column                             | `projects-page.tsx` — the avatar stack                                    | built |
| Create/edit project: privacy                            | `project-form-dialog.tsx` — read-only unless a project admin              | built |
| "Admin access" hint on a private project you are not on | `project-header.tsx` badge with a tooltip                                 | built |
| Being removed while the project is open                 | `hooks/use-project-access-realtime.ts` — toast, back to Browse            | built |

### What "not built" means for each

**Invite by e-mail.** Typing an address that belongs to nobody in the
workspace offers _Invite …_ in the Add people picker, at the role chosen beside
it. The invitation is a workspace invitation that also names the project; the
e-mail and the accept page say which project, and accepting opens it. Waiting
invitations are listed under **Invited**, with a × to revoke. Only workspace
admins may invite someone new, as on Members; a project admin who is not one
sees the option greyed with that reason, and the hint under the picker says to
ask one.

**Manage notifications.** It is a bell beside the star rather than a row in
the Share dialog. It is a person's own choice, made where they read the
project, not where admins manage its people. Only members see it, because
only members hear from a project: status updates, messages, tasks added and
tasks completed, each a checkbox. The bell shows struck through once all of
them are off.

**Commenter.** It is a fourth role, between Editor and Viewer. For the work it
is capped like a viewer, at GUEST. For the conversation it counts as an
editor (`effectiveConversationRole`), so the task panel stays read-only while
its comment box stays open, and message replies are open too. No new rung on
the workspace ladder was needed. The Share dialog says "can comment, not
edit" on a commenter's row, or "a guest, so read-only here" when their
workspace role is GUEST: a project role never raises the workspace one.

## Rules the UI states before the API does

- The role picker and the remove control on the **last admin of a private
  project** are disabled with the reason in their tooltip, computed from the
  dialog's full roster, never from the header's preview.
- Making a project private asks first, and says that workspace admins keep
  access and that the actor becomes a member.
- Leaving a private project asks first; leaving a public one does not, because
  the reader can join again.
- A person's row says "acts as guest here" when their project role caps their
  workspace role, so nobody wonders why a workspace manager cannot edit.
- The account behind an API key is not offered by the picker; it is added from
  the integrations side by someone who knows what the key is for.
