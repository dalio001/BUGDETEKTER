// End-to-end check of the browser SDK: loads the test page in Chromium,
// triggers every capture type, then asserts grouping/regression via the API.
// Usage: node sdk-capture.spec.mjs   (expects backend on :4000, seeded DB)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin12345';

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function api(path, options = {}, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...options.headers }
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function pollIssues(cookie, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    const { body } = await api('/api/issues?limit=100', {}, cookie);
    last = body?.issues ?? [];
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

async function main() {
  // login
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const { body: projectsBody } = await api('/api/projects', {}, cookie);
  const project = projectsBody.projects[0];
  console.log(`project: ${project.name} (${project.id})`);

  // CHROMIUM_PATH lets CI/sandboxes point at a preinstalled browser build.
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const page = await browser.newPage();
  page.on('pageerror', () => {}); // uncaught errors are the point of the test

  const url = `${BASE}/sdk-test/testpage.html?key=${project.ingest_key}&perf=1&slowLoadThreshold=1`;
  await page.goto(url, { waitUntil: 'load' });

  for (const id of ['btn-throw', 'btn-throw-again', 'btn-reject', 'btn-console', 'btn-fetch-404', 'btn-fetch-fail', 'btn-xhr-404', 'btn-manual']) {
    await page.click(`#${id}`);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  await page.click('#btn-flush');
  await page.waitForTimeout(1000);

  console.log('\nasserting captured issues:');
  const issues = await pollIssues(cookie, (list) => list.filter((i) => i.source === 'auto').length >= 6);
  const byTitle = (fragment) => issues.find((i) => i.title.includes(fragment));

  const typeError = byTitle('TypeError');
  check('uncaught TypeError captured', Boolean(typeError));
  check('two throws grouped into one issue (event_count=2)', typeError?.event_count === 2, `got ${typeError?.event_count}`);
  check('unhandled rejection captured', Boolean(byTitle('Unhandled rejection: Error: async save failed')));
  check('console.error captured', Boolean(byTitle('Console error: Widget failed to hydrate')));
  check('fetch 404 captured', Boolean(issues.find((i) => i.title.includes('definitely-missing') && i.title.includes('404'))));
  check('unreachable fetch captured as network failure', Boolean(issues.find((i) => i.title.includes('unreachable') && i.title.includes('network failure'))));
  check('XHR 404 captured', Boolean(issues.find((i) => i.title.includes('also-missing'))));
  check('manual captureException captured', Boolean(byTitle('SyntaxError')));
  check('slow_load performance event captured', Boolean(byTitle('Slow page load')));

  // detail assertions on the grouped issue
  if (typeError) {
    const { body: detail } = await api(`/api/issues/${typeError.id}`, {}, cookie);
    check('issue detail has stack', typeof detail.latest_event?.stack === 'string' && detail.latest_event.stack.length > 0);
    check('browser breakdown populated', (detail.aggregates?.browsers ?? []).some((b) => b.count > 0 && b.name !== 'Unknown'),
      JSON.stringify(detail.aggregates?.browsers));
    check('session count tracked', detail.aggregates?.session_count >= 1);

    // regression: resolve, re-trigger, expect reopen + regression comment
    await api(`/api/issues/${typeError.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }, cookie);
    await page.click('#btn-throw');
    await page.waitForTimeout(800);
    await page.click('#btn-flush');
    const reopened = await pollIssues(cookie, (list) => list.find((i) => i.id === typeError.id)?.status === 'open');
    check('resolved issue reopened by new event', reopened.find((i) => i.id === typeError.id)?.status === 'open');
    const { body: comments } = await api(`/api/issues/${typeError.id}/comments`, {}, cookie);
    check('regression comment recorded', (comments?.comments ?? []).some((c) => c.kind === 'regression'));
  }

  await browser.close();

  console.log(failures.length === 0 ? '\nALL SDK CAPTURE CHECKS PASSED' : `\n${failures.length} FAILURES: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
