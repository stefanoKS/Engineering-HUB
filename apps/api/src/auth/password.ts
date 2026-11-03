import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { DomainError } from '@eh/domain';
const N = 131072;
function derive(password: string, salt: string): Promise<Buffer> {
 return new Promise((resolve, reject) => scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
 if (password.length < 4 || password.length > 128) throw new DomainError('VALIDATION_FAILED', 'Password must contain 4–128 characters');
 const salt = randomBytes(16).toString('hex');
 return ['scrypt', salt, (await derive(password, salt)).toString('hex')].join('$');
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
 const [algorithm, salt, hash] = encoded.split('$');
 if (algorithm !== 'scrypt' || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
 return timingSafeEqual(await derive(password, salt), Buffer.from(hash, 'hex'));
}
export const dummyPassword = hashPassword(randomBytes(32).toString('hex'));
