#!/usr/bin/env npx tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BugDetekterClient } from './client.js';
import { registerTools } from './tools.js';

const baseUrl = process.env.BUGDETEKTER_URL ?? 'http://localhost:4000';
const token = process.env.BUGDETEKTER_TOKEN;

if (!token) {
  console.error('BUGDETEKTER_TOKEN is required (create one in the dashboard under "API tokens").');
  process.exit(1);
}

const server = new McpServer({ name: 'bugdetekter', version: '0.1.0' });
registerTools(server, new BugDetekterClient(baseUrl, token));

await server.connect(new StdioServerTransport());
console.error(`bugdetekter MCP server connected (backend: ${baseUrl})`);
