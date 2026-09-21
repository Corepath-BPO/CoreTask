# Project sharing and privacy

What Asana's project header, Share dialog and browse list show for privacy,
and what CoreTask renders for each. "Parity" here means the same information
in the same places, with CoreTask's own tokens, type and spacing — not pixel
copying. The rules behind it are in
[ADR 0016](../decisions/0016-project-privacy-is-a-membership-list.md); the API
in [project-members.md](../api/project-members.md).

## Reference to component

| Asana                                                   | Component today                                                    | State     |
| ------------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| Padlock beside a private project's name                 | `sharing/project-privacy-badge.tsx` — header, browse row, card     | built     |
| Members avatar stack in the header, opens Share         | `sharing/project-members-stack.tsx` (from the summary's preview)   | built     |
| **Share** button                                        | `project-header.tsx` — primary, for everyone                       | built     |
| **Join** on a public project you are not on             | `project-header.tsx`, browse row                                   | built     |
| Leave project                                           | header caret menu; the Share dialog's own row                      | built     |
| Share dialog: members list with a role per row          | `sharing/share-project-dialog.tsx` — Admin / Editor / Viewer       | built     |
| Share dialog: add people                                | the same — a workspace-member picker plus a role for the additions | built     |
| Share dialog: privacy ("Private to members")            | `sharing/project-visibility-select.tsx`, confirmed before private  | built     |
| Share dialog: copy project link                         | the same                                                           | built     |
| Share dialog: invite by e-mail                          | —                                                                  | not built |
| Share dialog: manage notifications                      | —                                                                  | not built |
| Commenter role                                          | —                                                                  | not built |
| Browse list: Members filter                             | `projects-page.tsx` — Anyone / I'm a member / Private to members   | built     |
| Browse list: Members column                             | `projects-page.tsx` — the avatar stack                             | built     |
| Create/edit project: privacy                            | `project-form-dialog.tsx` — read-only unless a project admin       | built     |
| "Admin access" hint on a private project you are not on | `project-header.tsx` badge with a tooltip                          | built     |
| Being removed while the project is open                 | `hooks/use-project-access-realtime.ts` — toast, back to Browse     | built     |

### What "not built" means for each

**Invite by e-mail.** A workspace invitation cannot carry a project today, so a
field here would either invite to the workspace and forget the project or
pretend to do something it does not. The dialog links to Members instead, which
is where an invitation actually goes.

**Manage notifications.** There is no per-project notification setting to
manage. The row is left out rather than shown disabled, because a disabled
control invites people to keep clicking it.

**Commenter.** The three roles map onto the workspace ladder that exists
(EDITOR acts as at most a MEMBER, VIEWER as at most a GUEST). A comment-only
tier would need a permission level between the two that nothing else has.

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
