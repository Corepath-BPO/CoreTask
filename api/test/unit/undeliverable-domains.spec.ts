import { isUndeliverableAddress } from '../../src/integrations/email/undeliverable-domains';

/**
 * The guard that stops a test run putting hundreds of guaranteed bounces through
 * a real mailbox. Both halves matter: missing a reserved domain lets the bounces
 * out, and catching a real one silently drops mail somebody was waiting for.
 */
describe('isUndeliverableAddress', () => {
  describe('blocks addresses that can never be delivered', () => {
    it.each([
      'user-abc@coretask.test',
      'someone@example.com',
      'someone@example.net',
      'someone@example.org',
      'probe@example.invalid',
      'root@localhost',
      'dev@my-machine.local',
      'a@nested.sub.test',
      // Case and a trailing root dot are still the same domain.
      'Someone@EXAMPLE.COM',
      'someone@example.com.',
    ])('%s', (address) => {
      expect(isUndeliverableAddress(address)).toBe(true);
    });

    it('treats a malformed address as undeliverable rather than trying it', () => {
      expect(isUndeliverableAddress('not-an-address')).toBe(true);
      expect(isUndeliverableAddress('trailing@')).toBe(true);
    });
  });

  describe('lets real addresses through', () => {
    it.each([
      'appdev@texasrenters.com',
      'ernie@erniecodev.win',
      'someone@gmail.com',
      'demo@coretask.dev',
      // Only the final label is the TLD: `.test` here is a subdomain, and
      // `testing.com` merely starts with the same letters.
      'user@test.example-company.com',
      'user@testing.com',
      'user@protest.org',
    ])('%s', (address) => {
      expect(isUndeliverableAddress(address)).toBe(false);
    });
  });
});
