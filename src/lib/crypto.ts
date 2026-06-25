import crypto from 'crypto';
import { env } from './env';

// AES-256-GCM at-rest encryption for third-party secrets (e.g. Spotify OAuth
// tokens). The key is derived from SESSION_SECRET so there is no extra env var
// to manage; rotating SESSION_SECRET invalidates stored tokens (users reconnect).
const key = crypto.scryptSync(env.sessionSecret, 'mythbindr.secret-box.v1', 32);

/** Encrypt a UTF-8 string to a self-describing `iv.tag.ciphertext` token (base64url). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/** Reverse {@link encryptSecret}. Throws if the payload is malformed or tampered with. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}
