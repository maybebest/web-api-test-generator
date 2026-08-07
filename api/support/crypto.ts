import { createHash, createHmac, randomUUID } from 'node:crypto';

/** Small crypto helpers used by the sign-up and login flows. */

export function md5Hex(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

export function hmacSha256Hex(key: string, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

export function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function uuid(): string {
  return randomUUID();
}

/** Short random suffix, used to keep nicknames and e-mails unique. */
export function rnd(length = 5): string {
  return randomUUID().replace(/-/g, '').slice(0, length);
}
