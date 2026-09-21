import { describe, expect, it } from 'vitest';

import { WEBHOOK_EXTRA_FIELDS_MAX, webhookExtraFieldRows, webhookExtraFields } from './webhooks';

describe('webhook extra fields', () => {
  it('reads the builder rows leniently, so a half-typed row survives a re-render', () => {
    expect(webhookExtraFieldRows([{ key: 'flow' }, { value: 'x' }, 'junk', null])).toEqual([
      { key: 'flow', value: '' },
      { key: '', value: 'x' },
    ]);
    expect(webhookExtraFieldRows(undefined)).toEqual([]);
    expect(webhookExtraFieldRows({ key: 'not', value: 'an array' })).toEqual([]);
  });

  it('drops blank keys, trims, caps sizes and lets a later duplicate win', () => {
    const rows = [
      { key: '  flow ', value: ' renewals ' },
      { key: '', value: 'ignored' },
      { key: 'flow', value: 'second' },
      { key: 'k'.repeat(100), value: 'v'.repeat(300) },
    ];

    const extra = webhookExtraFields(rows);

    expect(extra['flow']).toEqual('second');
    expect(Object.keys(extra)).toHaveLength(2);
    expect(Object.keys(extra)[1]).toHaveLength(60);
    expect(extra['k'.repeat(60)]).toHaveLength(200);
  });

  it('keeps only the first rows past the cap', () => {
    const rows = Array.from({ length: WEBHOOK_EXTRA_FIELDS_MAX + 5 }, (_, i) => ({
      key: `k${i}`,
      value: `${i}`,
    }));

    expect(Object.keys(webhookExtraFields(rows))).toHaveLength(WEBHOOK_EXTRA_FIELDS_MAX);
  });
});
