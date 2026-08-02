import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Config {
  databaseUrl: string;
  /** Apply pending migrations during boot, before the port opens. */
  migrateOnBoot: boolean;
  port: number;
  host: string;
  jwtSecret: string;
  signingSecret: string;
  cookieSecure: boolean;
  /** Extra origins allowed to make credentialed API calls (dashboard hosted separately). */
  corsOrigins: string[];
  storageDriver: 'local' | 's3';
  storageDir: string;
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle: boolean;
  };
}

export const DEV_JWT_SECRET = 'dev-only-jwt-secret';
export const DEV_SIGNING_SECRET = 'dev-only-signing-secret';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/**
 * Load backend/.env into process.env. Real environment variables win, so a
 * container's env still overrides the file. Without this the documented
 * `cp .env.example .env` workflow would silently do nothing and the server
 * would fall back to the dev secrets below.
 */
export function loadEnvFile(): void {
  const envPath = process.env.BUGDETEKTER_ENV_FILE ?? path.join(packageRoot, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    throw new Error(`Failed to read env file ${envPath}: ${(err as Error).message}`);
  }
}

/** Values shipped in this repo (defaults, .env.example, docker-compose) — never safe. */
const PLACEHOLDER_SECRETS = new Set([
  DEV_JWT_SECRET,
  DEV_SIGNING_SECRET,
  'change-me-jwt-secret',
  'change-me-signing-secret'
]);

/** Refuse to run a public deployment on a secret that is published in this repository. */
function assertSecretsAreSafe(jwtSecret: string, signingSecret: string): void {
  const usingDefaults: string[] = [];
  if (PLACEHOLDER_SECRETS.has(jwtSecret)) usingDefaults.push('JWT_SECRET');
  if (PLACEHOLDER_SECRETS.has(signingSecret)) usingDefaults.push('SIGNING_SECRET');
  if (usingDefaults.length === 0) return;

  const message =
    `${usingDefaults.join(' and ')} still set to a placeholder value shipped in this repo. ` +
    `These values are public in the repository — anyone could forge sessions or attachment URLs. ` +
    `Set them in backend/.env (generate with: openssl rand -hex 32).`;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to start: ${message}`);
  }
  console.warn(`[bugdetekter] WARNING: ${message}`);
}

export function loadConfig(): Config {
  loadEnvFile();
  const storageDriver = env('STORAGE_DRIVER', 'local');
  if (storageDriver !== 'local' && storageDriver !== 's3') {
    throw new Error(`STORAGE_DRIVER must be "local" or "s3", got "${storageDriver}"`);
  }
  const jwtSecret = env('JWT_SECRET', DEV_JWT_SECRET);
  const signingSecret = env('SIGNING_SECRET', DEV_SIGNING_SECRET);
  assertSecretsAreSafe(jwtSecret, signingSecret);

  return {
    databaseUrl: env('DATABASE_URL', 'postgres://bugdetekter:bugdetekter@127.0.0.1:5432/bugdetekter'),
    // Default off so the documented local workflow (`npm run migrate`) is unchanged;
    // the container and the systemd unit switch it on.
    migrateOnBoot: env('MIGRATE_ON_BOOT', 'false') === 'true',
    port: Number(env('PORT', '4000')),
    host: env('HOST', '0.0.0.0'),
    jwtSecret,
    signingSecret,
    cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
    corsOrigins: env('CORS_ORIGINS', '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    storageDriver,
    storageDir: env('STORAGE_DIR', './data/uploads'),
    s3: {
      bucket: env('S3_BUCKET', 'bugdetekter'),
      region: env('S3_REGION', 'us-east-1'),
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env('S3_FORCE_PATH_STYLE', 'false') === 'true'
    }
  };
}
