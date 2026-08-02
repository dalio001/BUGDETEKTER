import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BackendError, BugDetekterClient } from './client.js';

interface IssueSummary {
  id: string;
  project_name: string;
  source: string;
  status: string;
  title: string;
  priority: string | null;
  category: string | null;
  event_count: number;
  first_seen: string;
  last_seen: string;
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof BackendError || err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

export function registerTools(server: McpServer, client: BugDetekterClient): void {
  server.tool(
    'list_issues',
    'List issues (auto-detected errors and manual bug/feature reports) with filtering and sorting. ' +
      'Returns compact summaries; use get_issue for stack traces, comments and attachments.',
    {
      project: z.string().optional().describe('Project name, slug, or id. Omit to include all projects.'),
      status: z.enum(['open', 'in_progress', 'resolved', 'ignored']).optional().describe('Filter by status'),
      source: z.enum(['auto', 'manual']).optional().describe('auto = SDK-captured errors, manual = human-filed reports'),
      search: z.string().optional().describe('Substring match on title/description'),
      sort: z.enum(['recency', 'frequency', 'first_seen']).optional().describe('Default recency; frequency = most events first'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results, default 25')
    },
    async (args) => {
      try {
        const params = new URLSearchParams();
        if (args.project) {
          const project = await client.resolveProject(args.project);
          if (!project) return fail(new Error(`Unknown project "${args.project}". Call list_issues without a project, or use an exact project name.`));
          params.set('project_id', project.id);
        }
        if (args.status) params.set('status', args.status);
        if (args.source) params.set('source', args.source);
        if (args.search) params.set('search', args.search);
        params.set('sort', args.sort ?? 'recency');
        params.set('limit', String(args.limit ?? 25));
        const { issues, total } = await client.get<{ issues: IssueSummary[]; total: number }>(`/api/issues?${params}`);
        return ok({
          total,
          issues: issues.map((issue) => ({
            id: issue.id,
            title: issue.title,
            project: issue.project_name,
            source: issue.source,
            status: issue.status,
            priority: issue.priority,
            category: issue.category,
            event_count: issue.event_count,
            first_seen: issue.first_seen,
            last_seen: issue.last_seen
          }))
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'get_issue',
    'Get full detail for one issue: metadata, latest stack trace, browser/URL breakdowns, recent events, ' +
      'comments/activity, and signed attachment URLs for screenshots.',
    {
      issue_id: z.string().uuid().describe('Issue id from list_issues')
    },
    async (args) => {
      try {
        const [detail, comments, events] = await Promise.all([
          client.get<Record<string, unknown>>(`/api/issues/${args.issue_id}`),
          client.get<{ comments: unknown[] }>(`/api/issues/${args.issue_id}/comments`),
          client.get<{ events: unknown[]; total: number }>(`/api/issues/${args.issue_id}/events?limit=5`)
        ]);
        return ok({
          ...detail,
          comments: comments.comments,
          recent_events: events.events,
          total_events: events.total
        });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'create_report',
    'File a new manual bug report or feature request (requires a write-scope token).',
    {
      project: z.string().describe('Project name, slug, or id'),
      title: z.string().min(1).max(200).describe('Short summary'),
      description: z.string().optional().describe('Full description: what happened, expected behaviour, repro steps'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      category: z.enum(['bug', 'feature']).optional().describe('Default bug'),
      page_url: z.string().optional().describe('URL of the affected page')
    },
    async (args) => {
      try {
        const project = await client.resolveProject(args.project);
        if (!project) return fail(new Error(`Unknown project "${args.project}"`));
        const result = await client.request<{ issue: unknown }>('POST', '/api/reports', {
          project_id: project.id,
          title: args.title,
          description: args.description,
          priority: args.priority,
          category: args.category ?? 'bug',
          page_url: args.page_url
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'update_issue_status',
    'Change an issue status: open, in_progress, resolved, or ignored (requires a write-scope token). ' +
      'Resolved issues automatically reopen if the error recurs.',
    {
      issue_id: z.string().uuid(),
      status: z.enum(['open', 'in_progress', 'resolved', 'ignored'])
    },
    async (args) => {
      try {
        const result = await client.request<{ issue: unknown }>('PATCH', `/api/issues/${args.issue_id}`, {
          status: args.status
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'add_comment',
    'Add a note/comment to an issue, attributed to "Claude (MCP)" (requires a write-scope token).',
    {
      issue_id: z.string().uuid(),
      body: z.string().min(1).max(10_000)
    },
    async (args) => {
      try {
        const result = await client.request<{ comment: unknown }>('POST', `/api/issues/${args.issue_id}/comments`, {
          body: args.body
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    }
  );
}
