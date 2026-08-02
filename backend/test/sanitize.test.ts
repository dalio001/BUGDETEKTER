import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_IMAGE_TYPES } from '../src/routes/reports.js';
import { isUsableTimestamp } from '../src/routes/ingest.js';

test('SVG uploads are rejected — they are active documents, not inert images', () => {
  assert.equal(ALLOWED_IMAGE_TYPES.has('image/svg+xml'), false);
  assert.equal(ALLOWED_IMAGE_TYPES.has('image/png'), true);
  assert.equal(ALLOWED_IMAGE_TYPES.has('image/jpeg'), true);
});

test('out-of-range timestamps are dropped instead of failing the batch', () => {
  // Postgres raises "timestamp out of range" for these, which used to roll
  // back every event in the same ingest batch.
  assert.equal(isUsableTimestamp(1e18), false);
  assert.equal(isUsableTimestamp(-1e18), false);
  assert.equal(isUsableTimestamp(Number.NaN), false);
  assert.equal(isUsableTimestamp(Number.POSITIVE_INFINITY), false);
  assert.equal(isUsableTimestamp('1700000000000'), false);
});

test('plausible timestamps are kept', () => {
  assert.equal(isUsableTimestamp(Date.now()), true);
  assert.equal(isUsableTimestamp(Date.now() - 60_000), true);
  // small clock skew forward is tolerated, far-future is not
  assert.equal(isUsableTimestamp(Date.now() + 3_600_000), true);
  assert.equal(isUsableTimestamp(Date.now() + 30 * 24 * 3600 * 1000), false);
});
