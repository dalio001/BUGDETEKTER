export interface Config {
  databaseUrl: string;
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

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  const storageDriver = env('STORAGE_DRIVER', 'local');
  if (storageDriver !== 'local' && storageDriver !== 's3') {
    throw new Error(`STORAGE_DRIVER must be "local" or "s3", got "${storageDriver}"`);
  }
  return {
    databaseUrl: env('DATABASE_URL', 'postgres://bugdetekter:bugdetekter@127.0.0.1:5432/bugdetekter'),
    port: Number(env('PORT', '4000')),
    host: env('HOST', '0.0.0.0'),
    jwtSecret: env('JWT_SECRET', 'dev-only-jwt-secret'),
    signingSecret: env('SIGNING_SECRET', 'dev-only-signing-secret'),
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
