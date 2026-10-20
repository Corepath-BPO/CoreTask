import { SetMetadata } from '@nestjs/common';

export const READ_SCOPE_OK_KEY = 'coretask:readScopeOk';

/**
 * Marks a write an OAuth app granted only the `read` scope may still make,
 * because it changes nothing in anybody's work — subscribing a webhook to hear
 * about it, say. Every other non-GET is refused to a read-only app by
 * `JwtAuthGuard`.
 */
export const AllowedForReadScope = () => SetMetadata(READ_SCOPE_OK_KEY, true);
