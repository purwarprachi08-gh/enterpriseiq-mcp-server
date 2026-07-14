/**
 * Jira Adapter
 *
 * Wraps the Jira REST API v3 (Atlassian Cloud).
 * All functions read credentials from environment variables:
 *   JIRA_BASE_URL   — e.g. https://your-org.atlassian.net
 *   JIRA_EMAIL      — Atlassian account email
 *   JIRA_API_TOKEN  — Atlassian API token (from id.atlassian.com/manage/api-tokens)
 */

const JIRA_BASE_URL  = process.env.JIRA_BASE_URL?.replace(/\/$/, "") ?? "";
const JIRA_EMAIL     = process.env.JIRA_EMAIL     ?? "";
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? "";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function authHeader(): string {
  const encoded = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

async function jiraFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new Error(
      "Jira credentials not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN environment variables."
    );
  }

  const url = `${JIRA_BASE_URL}/rest/api/3${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`Jira API ${res.status} ${res.statusText}: ${text}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SearchJiraIssuesParams {
  query:      string;
  project?:   string;
  status?:    string;
  priority?:  string;
  maxResults?: number;
}

export interface JiraIssue {
  key:    string;
  summary: string;
  status:  string;
  priority: string;
  assignee: string | null;
  reporter: string;
  created:  string;
  updated:  string;
  url:      string;
  description: string;
}

// ---------------------------------------------------------------------------
// searchJiraIssues
// ---------------------------------------------------------------------------
export async function searchJiraIssues(params: SearchJiraIssuesParams): Promise<JiraIssue[]> {
  const { query, project, status, priority, maxResults = 20 } = params;

  // Build JQL query
  const jqlParts: string[] = [];

  // If query looks like JQL (contains operators), use it directly; otherwise treat as text search
  if (query.includes("=") || query.includes("ORDER BY")) {
    jqlParts.push(query);
  } else {
    jqlParts.push(`text ~ "${query}"`);
  }

  if (project)  jqlParts.push(`project = "${project}"`);
  if (status)   jqlParts.push(`status = "${status}"`);
  if (priority) jqlParts.push(`priority = "${priority}"`);

  const jql = jqlParts.join(" AND ") + " ORDER BY updated DESC";

  const data = await jiraFetch(
    `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,priority,assignee,reporter,created,updated,description`
  ) as { issues: Array<Record<string, unknown>> };

  return (data.issues ?? []).map((issue: Record<string, unknown>) => {
    const fields = issue.fields as Record<string, unknown>;
    return {
      key:         issue.key as string,
      summary:     fields.summary as string,
      status:      (fields.status as Record<string, unknown>)?.name as string ?? "Unknown",
      priority:    (fields.priority as Record<string, unknown>)?.name as string ?? "Unknown",
      assignee:    (fields.assignee as Record<string, unknown>)?.displayName as string ?? null,
      reporter:    (fields.reporter as Record<string, unknown>)?.displayName as string ?? "Unknown",
      created:     fields.created as string,
      updated:     fields.updated as string,
      url:         `${JIRA_BASE_URL}/browse/${issue.key as string}`,
      description: extractJiraDescription(fields.description),
    };
  });
}

// ---------------------------------------------------------------------------
// getJiraIssue
// ---------------------------------------------------------------------------
export async function getJiraIssue(issueKey: string): Promise<JiraIssue & { comments: unknown[] }> {
  const data = await jiraFetch(
    `/issue/${issueKey}?fields=summary,status,priority,assignee,reporter,created,updated,description,comment`
  ) as Record<string, unknown>;

  const fields = data.fields as Record<string, unknown>;
  const commentData = fields.comment as Record<string, unknown>;

  return {
    key:         data.key as string,
    summary:     fields.summary as string,
    status:      (fields.status as Record<string, unknown>)?.name as string ?? "Unknown",
    priority:    (fields.priority as Record<string, unknown>)?.name as string ?? "Unknown",
    assignee:    (fields.assignee as Record<string, unknown>)?.displayName as string ?? null,
    reporter:    (fields.reporter as Record<string, unknown>)?.displayName as string ?? "Unknown",
    created:     fields.created as string,
    updated:     fields.updated as string,
    url:         `${JIRA_BASE_URL}/browse/${data.key as string}`,
    description: extractJiraDescription(fields.description),
    comments:    (commentData?.comments as unknown[]) ?? [],
  };
}

// ---------------------------------------------------------------------------
// listJiraProjects
// ---------------------------------------------------------------------------
export async function listJiraProjects(maxResults = 50): Promise<unknown[]> {
  const data = await jiraFetch(`/project?maxResults=${maxResults}`) as unknown[];
  return (data ?? []).map((p: unknown) => {
    const proj = p as Record<string, unknown>;
    return {
      key:         proj.key,
      name:        proj.name,
      projectType: proj.projectTypeKey,
      url:         `${JIRA_BASE_URL}/projects/${proj.key as string}`,
    };
  });
}

// ---------------------------------------------------------------------------
// getJiraBoard
// ---------------------------------------------------------------------------
export async function getJiraBoard(projectKey: string): Promise<unknown> {
  // Get the board for the project via Agile API
  const boardsData = await jiraFetch(
    `/board?projectKeyOrId=${projectKey}&maxResults=1`
  ) as Record<string, unknown>;

  const boards = boardsData.values as Array<Record<string, unknown>>;
  if (!boards?.length) {
    return { message: `No board found for project ${projectKey}` };
  }

  const boardId = boards[0].id as number;

  // Get active sprint issues
  const sprintData = await jiraFetch(
    `/board/${boardId}/sprint?state=active&maxResults=1`
  ) as Record<string, unknown>;

  const sprints = sprintData.values as Array<Record<string, unknown>>;
  if (!sprints?.length) {
    return { board: boards[0], message: "No active sprint found" };
  }

  const sprintId = sprints[0].id as number;
  const issuesData = await jiraFetch(
    `/board/${boardId}/sprint/${sprintId}/issue?maxResults=50&fields=summary,status,assignee,priority`
  ) as Record<string, unknown>;

  return {
    board:  boards[0],
    sprint: sprints[0],
    issues: issuesData.issues,
  };
}

// ---------------------------------------------------------------------------
// Helper: extract plain text from Jira's Atlassian Document Format
// ---------------------------------------------------------------------------
function extractJiraDescription(doc: unknown): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc;

  const adf = doc as Record<string, unknown>;
  if (adf.type === "doc") {
    return extractTextFromADF(adf);
  }
  return JSON.stringify(doc);
}

function extractTextFromADF(node: Record<string, unknown>): string {
  if (node.type === "text") return (node.text as string) ?? "";
  const content = (node.content as Record<string, unknown>[]) ?? [];
  return content.map(extractTextFromADF).join(" ");
}
