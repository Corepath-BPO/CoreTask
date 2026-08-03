import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'coretask:isPublic';

/**
 * Opts a route out of the globally registered {@link JwtAuthGuard}.
 *
 * Authentication is on by default; every anonymous endpoint has to say so
 * explicitly, which makes an accidentally unprotected route hard to write.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
