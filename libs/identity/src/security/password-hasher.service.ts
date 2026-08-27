import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const DUMMY_SALT = 'feebdaed8a45aaea94528b260b4e9ceb';
const DUMMY_HASH =
  'f39336e38fc07b80494e3f3f208842fd23ed200780ce4813c6a0c2bda58311ef74e9bb8cd5a9e950fd696c9829dbd02bd895678597156147322b144a799c4744';

@Injectable()
export class PasswordHasherService {
  public async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = await this.derive(password, salt);
    return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${derived.toString('hex')}`;
  }

  public async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, cost, blockSize, parallelization, salt, expectedHex] = encoded.split('$');
    if (
      algorithm !== 'scrypt' ||
      Number(cost) !== SCRYPT_COST ||
      Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
      Number(parallelization) !== SCRYPT_PARALLELIZATION ||
      !salt ||
      !expectedHex
    ) {
      return false;
    }
    const expected = Buffer.from(expectedHex, 'hex');
    if (expected.length !== KEY_LENGTH) {
      return false;
    }
    const actual = await this.derive(password, salt);
    return timingSafeEqual(actual, expected);
  }

  public async consumeDummyWork(password: string): Promise<void> {
    const actual = await this.derive(password, DUMMY_SALT);
    timingSafeEqual(actual, Buffer.from(DUMMY_HASH, 'hex'));
  }

  private derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        KEY_LENGTH,
        { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
        (error, derivedKey) => {
          if (error) {
            reject(error);
          } else {
            resolve(derivedKey);
          }
        },
      );
    });
  }
}
