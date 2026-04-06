import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { argon2Verify, argon2id } from 'hash-wasm';

@Injectable()
export class PasswordHasherService {
  async hash(plainText: string): Promise<string> {
    return argon2id({
      password: plainText,
      salt: randomBytes(16),
      memorySize: 19456,
      iterations: 2,
      parallelism: 1,
      hashLength: 32,
      outputType: 'encoded',
    });
  }

  async verify(hash: string, plainText: string): Promise<boolean> {
    return argon2Verify({
      password: plainText,
      hash,
    });
  }
}
