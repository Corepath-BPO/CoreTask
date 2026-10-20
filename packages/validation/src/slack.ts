import { z } from 'zod';

/** What Slack hands back to `/integrations/slack/callback`, posted on by the page. */
export const completeSlackInstallSchema = z.object({
  code: z.string().trim().min(1, 'Slack sent no code.').max(512),
  state: z.string().trim().min(1, 'Slack sent no state.').max(2048),
});

/** The token from a "Link your account" button. */
export const slackLinkSchema = z.object({
  token: z.string().trim().min(1, 'The link is missing its token.').max(2048),
});
