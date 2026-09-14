import { AppException } from '../../src/common/exceptions/app.exception';
import {
  assertDeliverableUrl,
  assertResolvesToAllowedAddress,
  isPrivateAddress,
} from '../../src/modules/webhooks/lib/url-policy';

const strict = { allowPrivate: false };
const relaxed = { allowPrivate: true };

describe('webhook URL policy', () => {
  it('knows the private, loopback, link-local and multicast ranges', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.117',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12::3',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }

    for (const address of [
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '100.63.0.1',
      '2606:4700::1111',
    ]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
    expect(isPrivateAddress('not-an-ip')).toBe(false);
  });

  it('accepts public http(s) URLs and returns them parsed', () => {
    expect(assertDeliverableUrl('https://n8n.example.com/webhook/x', strict).host).toEqual(
      'n8n.example.com',
    );
    expect(assertDeliverableUrl('http://example.com:8080/hook', strict).port).toEqual('8080');
  });

  it('refuses other schemes and embedded credentials whatever the setting', () => {
    for (const options of [strict, relaxed]) {
      expect(() => assertDeliverableUrl('ftp://example.com/x', options)).toThrow(AppException);
      expect(() => assertDeliverableUrl('https://user:pw@example.com/x', options)).toThrow(
        /credentials/,
      );
      expect(() => assertDeliverableUrl('not a url', options)).toThrow(/full URL/);
    }
  });

  it('refuses local and private addresses unless the deployment allows them', () => {
    const local = [
      'http://localhost:5678/webhook-test/x',
      'http://127.0.0.1:5678/hook',
      'http://[::1]:5678/hook',
      'http://192.168.1.10/hook',
      'http://10.0.0.5/hook',
      'http://n8n.local/hook',
      'http://vault.internal/hook',
      'http://[::ffff:10.0.0.1]/hook',
    ];

    for (const url of local) {
      let thrown: unknown;
      try {
        assertDeliverableUrl(url, strict);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppException);
      expect((thrown as AppException).code).toEqual('WEBHOOK_URL_NOT_ALLOWED');
      expect((thrown as AppException).getStatus()).toEqual(422);

      expect(() => assertDeliverableUrl(url, relaxed)).not.toThrow();
    }
  });

  /** IP literals are decided without a lookup, so the check is exact and offline. */
  it('re-checks literal addresses at delivery time', async () => {
    await expect(
      assertResolvesToAllowedAddress(new URL('http://127.0.0.1/hook'), strict),
    ).rejects.toThrow(/private address/);
    await expect(
      assertResolvesToAllowedAddress(new URL('http://8.8.8.8/hook'), strict),
    ).resolves.toBeUndefined();
    await expect(
      assertResolvesToAllowedAddress(new URL('http://127.0.0.1/hook'), relaxed),
    ).resolves.toBeUndefined();
  });
});
