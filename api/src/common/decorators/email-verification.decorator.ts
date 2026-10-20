import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_EMAIL_KEY = 'coretask:allowUnverifiedEmail';
export const REQUIRE_VERIFIED_EMAIL_KEY = 'coretask:requireVerifiedEmail';

/**
 * Lets a route through after the account's confirmation deadline has passed:
 * the routes that confirm, change or resend the address, sign out, and delete
 * the account. Everything else answers EMAIL_NOT_VERIFIED until it is
 * confirmed — see `EmailVerificationGuard`.
 */
export const AllowUnverifiedEmail = () => SetMetadata(ALLOW_UNVERIFIED_EMAIL_KEY, true);

/**
 * Needs a confirmed address from the start, deadline or not: actions that
 * send mail to other people or hand out access — inviting someone, creating
 * an API key, a webhook or an OAuth app, installing Slack.
 */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
