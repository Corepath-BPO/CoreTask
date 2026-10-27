import type { Queue } from 'bullmq';

import { ImportJob } from '../queue-names';

import { ImportQueue } from './import.queue';

describe('ImportQueue', () => {
  it('tries a run again when its worker stopped before the outcome was written', async () => {
    const add = jest.fn(async () => undefined);
    await new ImportQueue({ add } as unknown as Queue).enqueueAsana('run-1');

    expect(add).toHaveBeenCalledWith(
      ImportJob.ASANA,
      { runId: 'run-1' },
      expect.objectContaining({
        jobId: 'asana-run-1',
        backoff: { type: 'fixed', delay: 30_000 },
      }),
    );
    const [, , options] = add.mock.calls[0] as unknown as [string, unknown, { attempts: number }];
    expect(options.attempts).toBeGreaterThan(1);
  });
});
