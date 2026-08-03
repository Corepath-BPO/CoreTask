import { hash, verify } from '@node-rs/argon2';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Argon2id password hashing.
 *
 * `@node-rs/argon2` ships prebuilt binaries for every platform we target, so a
 * developer on Windows does not need a C toolchain and the production image
 * stays free of build dependencies.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * Argon2id (19 MiB memory, 2 iterations, 1 degree of parallelism).
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private dummyHash: Promise<string> | null = null;

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
  }

  /**
   * Performs a real Argon2 verification against a throwaway hash.
   *
   * Login calls this when the account does not exist so that response time does
   * not reveal which e-mail addresses are registered. Computed once per process
   * and reused; always resolves to `false`.
   */
  async verifyAgainstDummy(plaintext: string): Promise<false> {
    this.dummyHash ??= this.hash('coretask::timing-equalizer');
    await this.verify(await this.dummyHash, plaintext);
    return false;
  }

  /**
   * Returns false rather than throwing on a malformed stored hash: a corrupt
   * row must not turn a failed login into a 500.
   */
  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, ARGON2_OPTIONS);
    } catch (error) {
      this.logger.warn({ err: error }, 'Password verification failed to run');
      return false;
    }
  }
}
