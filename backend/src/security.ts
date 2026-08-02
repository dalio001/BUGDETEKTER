import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// --- Password hashing (scrypt, no native deps) ---

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// --- Opaque keys/tokens ---

export function generateIngestKey(): string {
  return `pk_${randomBytes(16).toString('hex')}`;
}

export function generateApiToken(): string {
  return `bd_${randomBytes(20).toString('hex')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// --- Minimal HS256 JWT (header.payload.signature) ---

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(
    Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds }))
  );
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- Signed, expiring URLs for attachments ---

export function signAttachmentUrl(id: string, secret: string, ttlSeconds = 3600): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex');
  return { exp, sig };
}

export function verifyAttachmentSig(id: string, exp: number, sig: string, secret: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = createHmac('sha256', secret).update(`${id}.${exp}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
