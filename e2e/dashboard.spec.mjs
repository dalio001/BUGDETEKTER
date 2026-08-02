// End-to-end dashboard flow: login → issues list → detail (stack, chart,
// status change, comment) → manual report with image upload → filters.
// Usage: node dashboard.spec.mjs   (expects backend on :4000 serving dashboard/dist)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin12345';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

// tiny valid PNG so uploads don't depend on fixture files
function makePng(path) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const w = 40, h = 30;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x66)])));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  writeFileSync(path, png);
  return path;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // --- login ---
  await page.goto(`${BASE}/login`);
  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('button.primary');
  await page.waitForURL(`${BASE}/`);
  check('login redirects to overview', page.url() === `${BASE}/`);
  await page.waitForSelector('.stat-card');
  await page.screenshot({ path: `${SHOT_DIR}/overview.png` });

  // --- issues list ---
  await page.click('a[href="/issues"]');
  await page.waitForSelector('.issue-row');
  const rowCount = await page.locator('.issue-row').count();
  check('issues list renders rows', rowCount > 0, `rows=${rowCount}`);
  await page.screenshot({ path: `${SHOT_DIR}/issues.png` });

  // --- issue detail: open the grouped TypeError ---
  await page.locator('.issue-row', { hasText: 'TypeError' }).first().click();
  await page.waitForSelector('.stack-frame');
  check('detail shows parsed stack frames', (await page.locator('.stack-frame').count()) > 0);
  check('detail shows occurrence chart', (await page.locator('svg rect').count()) > 0);
  check('detail shows browser breakdown', (await page.locator('.bar-row').count()) > 0);

  // status change via dropdown
  await page.selectOption('.page-head select >> nth=0', 'in_progress');
  await page.waitForSelector('.badge.status-in_progress');
  check('status change reflected as badge', true);

  // comment
  await page.fill('.comment-form textarea', 'Investigating — looks like the user object is undefined on first render.');
  await page.click('.comment-form button');
  await page.waitForSelector('.comment:not(.system)');
  const commentText = await page.locator('.comment:not(.system)').last().textContent();
  check('comment posted and visible', commentText.includes('Investigating'));
  await page.screenshot({ path: `${SHOT_DIR}/issue-detail.png` });

  // --- manual report with image upload ---
  await page.click('a[href="/report"]');
  await page.waitForSelector('#rp-title');
  await page.fill('#rp-title', 'Sidebar overlaps content on tablets');
  await page.fill('#rp-desc', 'On iPad-width screens the sidebar renders on top of the issue list.\nExpected: content shifts right.');
  await page.selectOption('#rp-pri', 'high');
  await page.selectOption('#rp-cat', 'bug');
  await page.fill('#rp-url', 'https://demo.example/issues');
  const pngPath = makePng(`${SHOT_DIR}/upload.png`);
  await page.setInputFiles('.dropzone input[type=file]', pngPath);
  await page.waitForSelector('.dz-thumb img');
  check('dropzone shows image preview', true);
  await page.screenshot({ path: `${SHOT_DIR}/new-report.png` });
  await page.click('form button.primary');
  await page.waitForURL(/\/issues\/[0-9a-f-]+$/);
  await page.waitForSelector('.badge.source-manual');
  check('report submitted → lands on new issue detail', true);
  check('manual issue shows uploaded screenshot', (await page.locator('.attachment-grid img').count()) > 0);
  const description = await page.textContent('.detail-main');
  check('manual issue shows description', description.includes('iPad-width'));
  await page.screenshot({ path: `${SHOT_DIR}/manual-issue.png` });

  // --- source filter ---
  await page.click('a[href="/issues"]');
  await page.waitForSelector('.issue-row');
  await page.locator('.tabs button', { hasText: 'Manual' }).click();
  await page.waitForTimeout(600);
  const manualRows = await page.locator('.issue-row').count();
  const manualBadges = await page.locator('.issue-row .badge.source-manual').count();
  check('source=manual filter shows only manual issues', manualRows > 0 && manualRows === manualBadges, `rows=${manualRows} badges=${manualBadges}`);

  // --- live feed: ingest an event via API while watching the list ---
  await page.locator('.tabs button', { hasText: 'All sources' }).click();
  await page.waitForTimeout(300);
  const { body: projects } = await fetch(`${BASE}/api/projects`, {
    headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') }
  }).then(async (r) => ({ body: await r.json() }));
  const key = projects.projects[0].ingest_key;
  await fetch(`${BASE}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({
      key,
      sdk: 'e2e',
      events: [{ type: 'exception', message: 'live feed check', error_type: 'LiveError', stack: 'LiveError: live feed check\n    at liveFn (http://s/live.js:1:1)', url: 'http://s/live' }]
    })
  });
  await page.waitForSelector('.issue-row:has-text("LiveError")', { timeout: 10_000 });
  check('live feed delivers new issue without reload', true);
  check('live indicator shows live', (await page.locator('.live-dot.live').count()) > 0);

  await browser.close();
  console.log(failures.length === 0 ? '\nALL DASHBOARD CHECKS PASSED' : `\n${failures.length} FAILURES: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
