import {
  MAX_OAUTH_REDIRECT_URIS,
  OAUTH_APP_DESCRIPTION_MAX_LENGTH,
  OAUTH_APP_NAME_MAX_LENGTH,
  OAUTH_APP_POLICIES,
  OAUTH_CLIENT_TYPES,
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_REDIRECT_URI_MAX_LENGTH,
  type OAuthAppPolicy,
  OAuthClientType,
  OAUTH_SCOPES,
  OAuthScope,
  normaliseOAuthScopes,
  redirectUriProblem,
} from '@coretask/contracts';
import { z } from 'zod';

import { webhookEventsSchema, webhookNameSchema, webhookUrlSchema } from './webhook.js';

const appNameSchema = z
  .string()
  .trim()
  .min(1, 'Name the app — people see this name when they allow it.')
  .max(OAUTH_APP_NAME_MAX_LENGTH, `Must be at most ${OAUTH_APP_NAME_MAX_LENGTH} characters.`);

const descriptionSchema = z
  .string()
  .trim()
  .max(
    OAUTH_APP_DESCRIPTION_MAX_LENGTH,
    `Must be at most ${OAUTH_APP_DESCRIPTION_MAX_LENGTH} characters.`,
  )
  .nullable()
  .optional();

const websiteSchema = z
  .string()
  .trim()
  .max(OAUTH_REDIRECT_URI_MAX_LENGTH)
  .pipe(z.url('Enter a full URL, starting with https://.'))
  .nullable()
  .optional();

/**
 * One redirect URI's shape. Whether it suits the app — an app scheme only for
 * a public client — is checked against the app's type: by the create schema
 * below, and by the service on an update, where the type is stored.
 */
export const redirectUriSchema = z
  .string()
  .trim()
  .max(
    OAUTH_REDIRECT_URI_MAX_LENGTH,
    `Must be at most ${OAUTH_REDIRECT_URI_MAX_LENGTH} characters.`,
  )
  .superRefine((value, ctx) => {
    const problem = redirectUriProblem(value, { publicClient: true });
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const redirectUrisSchema = z
  .array(redirectUriSchema)
  .min(1, 'Add the URL CoreTask sends people back to.')
  .max(MAX_OAUTH_REDIRECT_URIS, `At most ${MAX_OAUTH_REDIRECT_URIS} redirect URIs.`)
  .transform((uris) => [...new Set(uris)]);

export const createOAuthAppSchema = z
  .object({
    name: appNameSchema,
    description: descriptionSchema,
    websiteUrl: websiteSchema,
    redirectUris: redirectUrisSchema,
    clientType: z
      .enum(OAUTH_CLIENT_TYPES as unknown as [OAuthClientType, ...OAuthClientType[]])
      .default(OAuthClientType.CONFIDENTIAL),
  })
  .superRefine((value, ctx) => {
    value.redirectUris.forEach((uri, index) => {
      const problem = redirectUriProblem(uri, {
        publicClient: value.clientType === OAuthClientType.PUBLIC,
      });
      if (problem)
        ctx.addIssue({ code: 'custom', message: problem, path: ['redirectUris', index] });
    });
  });
export type CreateOAuthAppInput = z.input<typeof createOAuthAppSchema>;

export const updateOAuthAppSchema = z
  .object({
    name: appNameSchema.optional(),
    description: descriptionSchema,
    websiteUrl: websiteSchema,
    redirectUris: redirectUrisSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change.',
  });
export type UpdateOAuthAppInput = z.input<typeof updateOAuthAppSchema>;

/**
 * The authorization request, as the consent page forwards it.
 *
 * Space-separated scopes, absent meaning `default`, as the RFC has it. Shape
 * only: whether the client exists and the URI is registered is the API's call.
 */
export const oauthAuthorizationSchema = z.object({
  clientId: z.string().trim().min(1, 'The request names no app.').max(100),
  redirectUri: z.string().trim().min(1, 'The request names no redirect URI.').max(2048),
  responseType: z.string().trim().default('code'),
  scope: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.split(/\s+/) : [OAuthScope.DEFAULT]))
    .pipe(
      z
        .array(z.enum(OAUTH_SCOPES as unknown as [string, ...string[]], 'Unknown scope.'))
        .min(1)
        .transform((scopes) => normaliseOAuthScopes(scopes as OAuthScope[])),
    ),
  state: z.string().max(1024).nullable().optional(),
  codeChallenge: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43,128}$/, 'The code challenge is not a S256 challenge.')
    .nullable()
    .optional(),
  codeChallengeMethod: z
    .literal(OAUTH_CODE_CHALLENGE_METHOD, 'Only S256 code challenges are accepted.')
    .nullable()
    .optional(),
});
export type OAuthAuthorizationInput = z.input<typeof oauthAuthorizationSchema>;

export const oauthDecisionSchema = oauthAuthorizationSchema.extend({
  approve: z.boolean(),
});
export type OAuthDecisionInput = z.input<typeof oauthDecisionSchema>;

/** A webhook an integration subscribes through the API: one project, its events. */
export const createWebhookSubscriptionSchema = z.object({
  projectId: z.uuid('Choose the project to watch.'),
  url: webhookUrlSchema,
  events: webhookEventsSchema,
  name: webhookNameSchema.optional(),
});
export type CreateWebhookSubscriptionInput = z.input<typeof createWebhookSubscriptionSchema>;

/** An admin adds an app to the workspace's directory by its client id. */
export const approveWorkspaceAppSchema = z.object({
  clientId: z.string().trim().min(1, 'Enter the app’s client id.').max(200),
});
export type ApproveWorkspaceAppInput = z.input<typeof approveWorkspaceAppSchema>;

export const updateAppPolicySchema = z.object({
  policy: z.enum(OAUTH_APP_POLICIES as unknown as [OAuthAppPolicy, ...OAuthAppPolicy[]]),
});
export type UpdateAppPolicyInput = z.input<typeof updateAppPolicySchema>;
