#!/usr/bin/env node
/**
 * EnterpriseIQ MCP Server — Entry Point
 *
 * Exposes tools from Jira, Confluence and GitHub as MCP tools that IBM Bob
 * can discover and invoke via the Model Context Protocol.
 *
 * Transport: StreamableHTTP (for IBM Code Engine / remote hosting)
 * Port:      process.env.PORT (default 3000)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as http from "http";
import { z } from "zod";

import {
  searchJiraIssues,
  getJiraIssue,
  listJiraProjects,
  getJiraBoard,
} from "./adapters/jira.js";

import {
  searchConfluence,
  getConfluencePage,
  listConfluenceSpaces,
} from "./adapters/confluence.js";

import {
  searchGithubCode,
  getGithubFile,
  listGithubRepos,
  getGithubPR,
  getApiDependencies,
} from "./adapters/github.js";

// ---------------------------------------------------------------------------
// Validate required environment variables at startup
// ---------------------------------------------------------------------------
const REQUIRED_ENV: string[] = [];
const MISSING = REQUIRED_ENV.filter((k) => !process.env[k]);
if (MISSING.length > 0) {
  console.error(`Missing required environment variables: ${MISSING.join(", ")}`);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ---------------------------------------------------------------------------
// Create MCP server instance
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "enterpriseiq-mcp-server",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------
function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[EnterpriseIQ] Tool error:", msg);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// JIRA TOOLS
// ---------------------------------------------------------------------------

server.tool(
  "search_jira_issues",
  "Search Jira issues by keyword, project, status or priority. Use this to find open bugs, tasks, production incidents or any work items.",
  {
    query:      z.string().describe("Search keyword or JQL query string"),
    project:    z.string().optional().describe("Jira project key to filter by (e.g. PROD, PLAT)"),
    status:     z.string().optional().describe("Issue status filter (e.g. 'Open', 'In Progress', 'Done')"),
    priority:   z.string().optional().describe("Priority filter (e.g. 'P1', 'Critical', 'High')"),
    max_results: z.number().optional().describe("Maximum number of results to return (default 20)"),
  },
  async ({ query, project, status, priority, max_results = 20 }) => {
    try {
      return ok(await searchJiraIssues({ query, project, status, priority, maxResults: max_results }));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "get_jira_issue",
  "Get full details of a specific Jira issue including description, comments, assignee and status.",
  {
    issue_key: z.string().describe("The Jira issue key (e.g. PROD-1234, PLAT-567)"),
  },
  async ({ issue_key }) => {
    try {
      return ok(await getJiraIssue(issue_key));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "list_jira_projects",
  "List all Jira projects available in the organisation.",
  {
    max_results: z.number().optional().describe("Maximum number of projects to return (default 50)"),
  },
  async ({ max_results = 50 }) => {
    try {
      return ok(await listJiraProjects(max_results));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "get_jira_board",
  "Get the sprint board and active issues for a Jira project.",
  {
    project_key: z.string().describe("The Jira project key (e.g. PROD)"),
  },
  async ({ project_key }) => {
    try {
      return ok(await getJiraBoard(project_key));
    } catch (e) { return fail(e); }
  }
);

// ---------------------------------------------------------------------------
// CONFLUENCE TOOLS
// ---------------------------------------------------------------------------

server.tool(
  "search_confluence",
  "Search Confluence for pages, docs or wiki articles by keyword. Use this to find API documentation, design docs, runbooks or team pages.",
  {
    query:     z.string().describe("Search keyword or CQL query"),
    space_key: z.string().optional().describe("Confluence space key to restrict the search (e.g. TEAM, ENG)"),
    max_results: z.number().optional().describe("Maximum number of results (default 10)"),
  },
  async ({ query, space_key, max_results = 10 }) => {
    try {
      return ok(await searchConfluence({ query, spaceKey: space_key, maxResults: max_results }));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "get_confluence_page",
  "Get the full content of a specific Confluence page by its ID.",
  {
    page_id: z.string().describe("The Confluence page ID (numeric string)"),
  },
  async ({ page_id }) => {
    try {
      return ok(await getConfluencePage(page_id));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "list_confluence_spaces",
  "List all Confluence spaces in the organisation.",
  {
    max_results: z.number().optional().describe("Maximum number of spaces to return (default 50)"),
  },
  async ({ max_results = 50 }) => {
    try {
      return ok(await listConfluenceSpaces(max_results));
    } catch (e) { return fail(e); }
  }
);

// ---------------------------------------------------------------------------
// GITHUB TOOLS
// ---------------------------------------------------------------------------

server.tool(
  "search_github_code",
  "Search source code across all GitHub repositories in the organisation. Use this to find which service calls an API, or to locate implementation details.",
  {
    query:   z.string().describe("Code search query (e.g. function name, API path, class name)"),
    repo:    z.string().optional().describe("Restrict search to a specific repository (e.g. payments-service)"),
    language: z.string().optional().describe("Filter by programming language (e.g. typescript, python, java)"),
    max_results: z.number().optional().describe("Maximum number of results (default 10)"),
  },
  async ({ query, repo, language, max_results = 10 }) => {
    try {
      return ok(await searchGithubCode({ query, repo, language, maxResults: max_results }));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "get_github_file",
  "Get the content of a specific file from a GitHub repository.",
  {
    repo:   z.string().describe("Repository name (e.g. payments-service)"),
    path:   z.string().describe("File path within the repository (e.g. src/index.ts, docs/api.md)"),
    branch: z.string().optional().describe("Branch name (default: main)"),
  },
  async ({ repo, path, branch = "main" }) => {
    try {
      return ok(await getGithubFile({ repo, path, branch }));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "list_github_repos",
  "List all repositories in the GitHub organisation.",
  {
    max_results: z.number().optional().describe("Maximum number of repos to return (default 50)"),
  },
  async ({ max_results = 50 }) => {
    try {
      return ok(await listGithubRepos(max_results));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "get_github_pr",
  "Get details of a specific pull request including description, reviewers and status.",
  {
    repo:   z.string().describe("Repository name"),
    pr_number: z.number().describe("Pull request number"),
  },
  async ({ repo, pr_number }) => {
    try {
      return ok(await getGithubPR({ repo, prNumber: pr_number }));
    } catch (e) { return fail(e); }
  }
);

server.tool(
  "get_api_dependencies",
  "Analyse a repository's source code to discover which external APIs or services it calls.",
  {
    repo:   z.string().describe("Repository name to analyse (e.g. order-service)"),
    branch: z.string().optional().describe("Branch to analyse (default: main)"),
  },
  async ({ repo, branch = "main" }) => {
    try {
      return ok(await getApiDependencies({ repo, branch }));
    } catch (e) { return fail(e); }
  }
);

// ---------------------------------------------------------------------------
// CROSS-SYSTEM TOOL: Service ownership lookup
// ---------------------------------------------------------------------------
server.tool(
  "get_service_owner",
  "Find who owns a named service or application — searches Confluence, Jira and GitHub README files to find team ownership information.",
  {
    service_name: z.string().describe("Name of the service or application (e.g. payments-service, auth-api)"),
  },
  async ({ service_name }) => {
    try {
      const [confluenceResults, jiraResults, githubResults] = await Promise.allSettled([
        searchConfluence({ query: `${service_name} owner team`, maxResults: 3 }),
        searchJiraIssues({ query: service_name, maxResults: 3 }),
        searchGithubCode({ query: `${service_name} owner`, maxResults: 3 }),
      ]);

      return ok({
        service: service_name,
        confluence: confluenceResults.status === "fulfilled" ? confluenceResults.value : [],
        jira:       jiraResults.status       === "fulfilled" ? jiraResults.value       : [],
        github:     githubResults.status     === "fulfilled" ? githubResults.value     : [],
      });
    } catch (e) { return fail(e); }
  }
);

// ---------------------------------------------------------------------------
// HTTP Server — exposes /mcp for Bob and /health for Code Engine
// ---------------------------------------------------------------------------
const httpServer = http.createServer(async (req, res) => {
  // Health check endpoint — used by IBM Code Engine readiness probes
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "enterpriseiq-mcp-server" }));
    return;
  }

  // MCP protocol endpoint
  if (req.url?.startsWith("/mcp")) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  console.error(`EnterpriseIQ MCP Server running on port ${PORT}`);
  console.error(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  console.error(`Health check: http://0.0.0.0:${PORT}/health`);
});
