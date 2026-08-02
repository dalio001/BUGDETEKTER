# BugDetekter MCP server

Lets Claude (Claude Code, Claude Desktop, or any MCP client) read and act on your
BugDetekter issues — both auto-captured errors and manual reports.

## Tools

| Tool | Scope | What it does |
|---|---|---|
| `list_issues` | read | Filter/sort issues (project, status, source auto/manual, search, frequency/recency) |
| `get_issue` | read | Full detail: stack trace, browser/URL breakdowns, recent events, comments, signed screenshot URLs |
| `create_report` | write | File a manual bug report or feature request |
| `update_issue_status` | write | Set open / in_progress / resolved / ignored |
| `add_comment` | write | Add a note, attributed to "Claude (MCP)" |

## Setup

1. In the dashboard, go to **API tokens** and create a token (choose **Read + write**
   to allow status updates and new reports, or **Read only** for a safer posture).
2. Register the server with your MCP client.

**Claude Code:**

```bash
claude mcp add bugdetekter \
  -e BUGDETEKTER_URL=http://localhost:4000 \
  -e BUGDETEKTER_TOKEN=bd_your_token_here \
  -- npx tsx /path/to/BUGDETEKTER/mcp-server/src/index.ts
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bugdetekter": {
      "command": "npx",
      "args": ["tsx", "/path/to/BUGDETEKTER/mcp-server/src/index.ts"],
      "env": {
        "BUGDETEKTER_URL": "http://localhost:4000",
        "BUGDETEKTER_TOKEN": "bd_your_token_here"
      }
    }
  }
}
```

Then ask Claude things like:

- *"What bugs are open on my site right now?"*
- *"Show me the stack trace for the most frequent error and suggest a fix."*
- *"Mark the checkout TypeError as resolved and leave a note about the fix."*
- *"File a feature request: export issues as CSV."*

## Environment

| Variable | Default | |
|---|---|---|
| `BUGDETEKTER_URL` | `http://localhost:4000` | Backend base URL |
| `BUGDETEKTER_TOKEN` | — | Required. `bd_...` API token from the dashboard |

Errors from the backend (bad token, read-only token used for a write tool,
unknown project) surface as tool errors with actionable messages rather than
crashing the server.
