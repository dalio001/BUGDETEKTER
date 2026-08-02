import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEV_JWT_SECRET, loadConfig } from '../src/config.js';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = { ...process.env };
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    process.env = saved;
  }
}

function writeEnvFile(contents: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'bd-env-')), '.env');
  writeFileSync(file, contents);
  return file;
}

test('values in the env file are actually applied', () => {
  // Regression: nothing loaded backend/.env, so the documented
  // `cp .env.example .env` workflow silently ran on dev defaults.
  const file = writeEnvFile('DATABASE_URL=postgres://u:p@db.test:5432/mine\nJWT_SECRET=from-file-jwt\nSIGNING_SECRET=from-file-sig\n');
  withEnv(
    { BUGDETEKTER_ENV_FILE: file, DATABASE_URL: undefined, JWT_SECRET: undefined, SIGNING_SECRET: undefined, NODE_ENV: 'test' },
    () => {
      const config = loadConfig();
      assert.equal(config.databaseUrl, 'postgres://u:p@db.test:5432/mine');
      assert.equal(config.jwtSecret, 'from-file-jwt');
    }
  );
});

test('real environment variables win over the env file', () => {
  const file = writeEnvFile('JWT_SECRET=from-file\n');
  withEnv({ BUGDETEKTER_ENV_FILE: file, JWT_SECRET: 'from-environment', SIGNING_SECRET: 'x', NODE_ENV: 'test' }, () => {
    assert.equal(loadConfig().jwtSecret, 'from-environment');
  });
});

test('production refuses to start on the public dev secrets', () => {
  withEnv({ BUGDETEKTER_ENV_FILE: '/nonexistent/.env', JWT_SECRET: undefined, SIGNING_SECRET: undefined, NODE_ENV: 'production' }, () => {
    assert.throws(() => loadConfig(), /Refusing to start/);
  });
});

test('production also rejects the docker-compose change-me placeholders', () => {
  withEnv(
    {
      BUGDETEKTER_ENV_FILE: '/nonexistent/.env',
      JWT_SECRET: 'change-me-jwt-secret',
      SIGNING_SECRET: 'change-me-signing-secret',
      NODE_ENV: 'production'
    },
    () => assert.throws(() => loadConfig(), /Refusing to start/)
  );
});

test('production starts once real secrets are supplied', () => {
  withEnv({ BUGDETEKTER_ENV_FILE: '/nonexistent/.env', JWT_SECRET: 'real-secret-a', SIGNING_SECRET: 'real-secret-b', NODE_ENV: 'production' }, () => {
    assert.equal(loadConfig().jwtSecret, 'real-secret-a');
  });
});

test('development still boots on defaults (with a warning)', () => {
  withEnv({ BUGDETEKTER_ENV_FILE: '/nonexistent/.env', JWT_SECRET: undefined, SIGNING_SECRET: undefined, NODE_ENV: 'development' }, () => {
    assert.equal(loadConfig().jwtSecret, DEV_JWT_SECRET);
  });
});
