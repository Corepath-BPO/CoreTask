import { Resolver } from 'node:dns/promises';

import { Injectable } from '@nestjs/common';

/**
 * Reads a domain's TXT records. Its own class so the tests can answer for
 * DNS, and so a slow resolver gives up after a few seconds rather than
 * holding the admin's request open.
 */
@Injectable()
export class DomainTxtResolver {
  private readonly resolver = new Resolver({ timeout: 5_000, tries: 2 });

  /** Each record as the chunks DNS splits it into; join them to read it. */
  resolveTxt(domain: string): Promise<string[][]> {
    return this.resolver.resolveTxt(domain);
  }
}
