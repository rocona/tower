import crypto from 'node:crypto';

const ENC_PREFIX = 'enc:v1:';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function deriveAesKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

export class SecretCipher {
  private readonly key: Buffer;

  constructor(rawKey: string) {
    this.key = deriveAesKey(rawKey);
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    if (!payload.startsWith(ENC_PREFIX)) {
      return payload;
    }
    const parts = payload.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted payload');
    }
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  encryptNullable(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    return this.encrypt(value);
  }

  decryptNullable(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    return this.decrypt(value);
  }
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
  return `scrypt:v1:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
    return false;
  }
  const salt = Buffer.from(parts[2], 'base64url');
  const expected = Buffer.from(parts[3], 'base64url');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      expected.length,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionPayload {
  ver: number;
  iat: number;
  exp: number;
}

export function signSessionToken(
  payload: SessionPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  expectedVersion: number,
): SessionPayload | null {
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0) return null;
  const body = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (
      typeof parsed.ver !== 'number' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }
    if (parsed.ver !== expectedVersion) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
