// Drives the MCP server over stdio exactly like a Claude client would:
// lists tools, exercises all five, and verifies scope enforcement.
// Usage: node mcp-drive.mjs   (expects backend on :4000, seeded DB)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin12345';
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function adminFetch(pathname, options = {}, cookie) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', cookie, ...options.headers }
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function connect(token) {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', path.join(repoRoot, 'mcp-server', 'src', 'index.ts')],
    env: { ...process.env, BUGDETEKTER_URL: BASE, BUGDETEKTER_TOKEN: token },
    stderr: 'ignore'
  });
  const client = new Client({ name: 'e2e-driver', version: '0.0.1' });
  return client.connect(transport).then(() => client);
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

async function main() {
  // mint fresh tokens (write + read) via the admin API
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const writeToken = (await adminFetch('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'e2e-write', scope: 'write' }) }, cookie)).body.value;
  const readToken = (await adminFetch('/api/tokens', { method: 'POST', body: JSON.stringify({ name: 'e2e-read', scope: 'read' }) }, cookie)).body.value;

  const client = await connect(writeToken);

  // 1. tool discovery
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check('exposes exactly the five tools', JSON.stringify(names) === JSON.stringify(['add_comment', 'create_report', 'get_issue', 'list_issues', 'update_issue_status']), names.join(','));

  // 2. list_issues
  const listed = parse(await client.callTool({ name: 'list_issues', arguments: { sort: 'frequency' } }));
  check('list_issues returns issues', Array.isArray(listed.issues) && listed.issues.length > 0);
  const autoIssue = listed.issues.find((i) => i.source === 'auto' && i.title.includes('TypeError'));
  check('list_issues includes auto-captured TypeError', Boolean(autoIssue));

  const manualOnly = parse(await client.callTool({ name: 'list_issues', arguments: { source: 'manual' } }));
  check('list_issues source filter works', manualOnly.issues.length > 0 && manualOnly.issues.every((i) => i.source === 'manual'));

  // 3. get_issue
  const detail = parse(await client.callTool({ name: 'get_issue', arguments: { issue_id: autoIssue.id } }));
  check('get_issue returns stack trace', typeof detail.latest_event?.stack === 'string' && detail.latest_event.stack.length > 0);
  check('get_issue returns comments', Array.isArray(detail.comments));
  check('get_issue returns browser aggregates', Array.isArray(detail.aggregates?.browsers) && detail.aggregates.browsers.length > 0);

  const manualDetail = parse(await client.callTool({ name: 'get_issue', arguments: { issue_id: manualOnly.issues[0].id } }));
  check('get_issue on manual report includes attachment URLs', Array.isArray(manualDetail.attachments) && manualDetail.attachments.every((a) => typeof a.url === 'string'));

  // 4. create_report
  const created = parse(await client.callTool({
    name: 'create_report',
    arguments: {
      project: 'Demo Site',
      title: 'Claude-filed: dark mode toggle resets on navigation',
      description: 'Filed via MCP e2e drive. The theme preference is not persisted between pages.',
      priority: 'medium',
      category: 'bug'
    }
  }));
  check('create_report creates a manual issue', created.issue?.source === 'manual' && created.issue?.title.startsWith('Claude-filed'));

  // 5. update_issue_status + add_comment
  const updated = parse(await client.callTool({ name: 'update_issue_status', arguments: { issue_id: created.issue.id, status: 'in_progress' } }));
  check('update_issue_status works', updated.issue?.status === 'in_progress');

  const commented = parse(await client.callTool({ name: 'add_comment', arguments: { issue_id: created.issue.id, body: 'Root cause: localStorage key mismatch. PR incoming.' } }));
  check('add_comment attributed to Claude (MCP)', commented.comment?.author_label === 'Claude (MCP)');

  // 6. unknown project error surfaces as isError
  const badProject = await client.callTool({ name: 'create_report', arguments: { project: 'no-such-site', title: 'x' } });
  check('unknown project returns isError', badProject.isError === true);

  await client.close();

  // 7. read-scope token: reads work, writes rejected
  const readClient = await connect(readToken);
  const readList = parse(await readClient.callTool({ name: 'list_issues', arguments: {} }));
  check('read-scope token can list issues', Array.isArray(readList.issues));
  const denied = await readClient.callTool({ name: 'update_issue_status', arguments: { issue_id: created.issue.id, status: 'resolved' } });
  check('read-scope token rejected for writes with helpful message', denied.isError === true && denied.content[0].text.includes('write'));
  await readClient.close();

  console.log(failures.length === 0 ? '\nALL MCP CHECKS PASSED' : `\n${failures.length} FAILURES: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
