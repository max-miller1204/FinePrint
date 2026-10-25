import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
export const capability = () => randomBytes(32).toString('base64url');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const derive = (pin: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(pin, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(pin, salt)).toString('hex')}`;
}
export async function checkPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(':');
  return !!salt && !!hash && timingSafeEqual(await derive(pin, salt), Buffer.from(hash, 'hex'));
}
export function browserFamily(ua = '') {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

// Cloud Run terminates TLS before the Node socket. Production report links
// always use HTTPS; HTTP is allowed only in the explicit emulator lane.
export function reportOrigin(url: string, emulated = !!process.env.FIRESTORE_EMULATOR_HOST) {
  const origin = new URL(url);
  if (!emulated) origin.protocol = 'https:';
  return origin.origin;
}
