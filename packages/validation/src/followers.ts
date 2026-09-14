import { MAX_FOLLOWERS_PER_ADD } from '@coretask/contracts';
import { z } from 'zod';

export const addFollowersSchema = z.object({
  userIds: z
    .array(z.string().uuid())
    .min(1, 'Choose at least one person.')
    .max(MAX_FOLLOWERS_PER_ADD, `At most ${MAX_FOLLOWERS_PER_ADD} people at a time.`),
});
export type AddFollowersInput = z.input<typeof addFollowersSchema>;
