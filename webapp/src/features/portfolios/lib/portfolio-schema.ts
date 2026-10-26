import { DESCRIPTION_MAX_LENGTH, HEX_COLOR_PATTERN } from '@coretask/contracts';
import { z } from 'zod';

export const PORTFOLIO_NAME_MAX_LENGTH = 80;

/**
 * Local to the feature rather than `@coretask/validation`, because the server
 * has no portfolio endpoint to share it with. If portfolios grow an API, this
 * moves there and both sides validate the same shape.
 */
export const portfolioFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Portfolio name is required.')
    .max(PORTFOLIO_NAME_MAX_LENGTH, `Must be at most ${PORTFOLIO_NAME_MAX_LENGTH} characters.`),
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH),
  color: z.string().trim().regex(HEX_COLOR_PATTERN, 'Enter a valid hex colour.'),
});

export type PortfolioFormInput = z.input<typeof portfolioFormSchema>;
