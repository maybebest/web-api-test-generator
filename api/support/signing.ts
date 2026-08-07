import { createHash, createHmac } from 'node:crypto';

export type AuthChannel = {
  id: string;
  in: number;
  out: number;
};

/** HMAC salt of the auth `request` step (SMS send). */
export const REQUEST_SALT = '61541EH0iC9h';

/**
 * Request signature of the phone auth flow (v2 mobile contract), ported from
 * the verified client implementation:
 *
 *   key       = channel.id.substring(channel.in, channel.out)
 *   composite = reverse(utf8(key)) + reverse(utf8(salt)) + reverse(utf8(channel.id))
 *   hmacKey   = MD5(composite)            // raw 16 bytes, not a hex string
 *   requestId = HMAC_SHA256(hmacKey, utf8(userUuid)) as UPPERCASE hex
 *
 * On the confirm step the salt is the SMS code itself — swapping the salt IS
 * the code verification; there is no separate verify endpoint.
 */
export function signAuthRequest(channel: AuthChannel, salt: string, userUuid: string): string {
  const reversed = (value: string): Buffer => Buffer.from(value, 'utf8').reverse();
  const key = channel.id.slice(channel.in, channel.out);
  const composite = Buffer.concat([reversed(key), reversed(salt), reversed(channel.id)]);
  const hmacKey = createHash('md5').update(composite).digest();
  return createHmac('sha256', hmacKey).update(userUuid, 'utf8').digest('hex').toUpperCase();
}
