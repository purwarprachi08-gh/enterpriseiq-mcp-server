/**
 * GitHub Adapter
 *
 * Wraps the GitHub REST API v3 (api.github.com).
 * All functions read credentials from environment variables:
 *   GITHUB_TOKEN — Personal Access Token with repo/read:org scopes
 *   GITHUB_ORG   — Your GitHub organisation name
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_ORG   = process.env.GITHUB_ORG   ?? "";
const GITHUB_API   = "https://api.github.com";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
async function githubFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  if (!GITHUB_TOKEN) {
    throw new Error(
      "GitHub credentials not configured. Set GITHUB_TOKEN and GITHUB_ORG environment variables."
    );
  }

  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${text}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SearchGithubCodeParams {
  query:       string;
  repo?:       string;
  language?:   string;
  maxResults?: number;
}

export interface GithubCodeResult {
  repo:     string;
  path:     string;
  url:      string;
  htmlUrl:  string;
  fragment: string;
}

export interface GetGithubFileParams {
  repo:    string;
  path:    string;
  branch?: string;
}

export interface GetGithubPRParams {
  repo:     string;
  prNumber: number;
}

export interface GetApiDependenciesParams {
  repo:    string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// searchGithubCode
// ---------------------------------------------------------------------------
export async function searchGithubCode(params: SearchGithubCodeParams): Promise<GithubCodeResult[]> {
  const { query, repo, language, maxResults = 10 } = params;

  let q = query;
  if (GITHUB_ORG) q += ` org:${GITHUB_ORG}`;
  if (repo)       q += ` repo:${GITHUB_ORG}/${repo}`;
  if (language)   q += ` language:${language}`;

  const data = await githubFetch(
    `/search/code?q=${encodeURIComponent(q)}&per_page=${maxResults}`
  ) as Record<string, unknown>;

  const items = (data.items as Array<Record<string, unknown>>) ?? [];

  return items.map((item) => {
    const repository = item.repository as Record<string, unknown>;
    return {
      repo:     repository?.full_name as string ?? "",
      path:     item.path as string,
      url:      item.url as string,
      htmlUrl:  item.html_url as string,
      fragment: item.text_matches
        ? ((item.text_matches as Array<Record<string, unknown>>)[0]?.fragment as string ?? "")
        : "",
    };
  });
}

// ---------------------------------------------------------------------------
// getGithubFile
// ---------------------------------------------------------------------------
export async function getGithubFile(params: GetGithubFileParams): Promise<{
  repo:    string;
  path:    string;
  branch:  string;
  content: string;
  url:     string;
  size:    number;
}> {
  const { repo, path, branch = "main" } = params;
  const repoPath = repo.includes("/") ? repo : `${GITHUB_ORG}/${repo}`;

  const data = await githubFetch(
    `/repos/${repoPath}/contents/${path}?ref=${branch}`
  ) as Record<string, unknown>;

  // GitHub returns file content as base64-encoded string
  const encodedContent = data.content as string ?? "";
  const decodedContent = Buffer.from(encodedContent.replace(/\n/g, ""), "base64").toString("utf-8");

  return {
    repo:    repoPath,
    path:    data.path as string,
    branch,
    content: decodedContent,
    url:     data.html_url as string,
    size:    data.size as number,
  };
}

// ---------------------------------------------------------------------------
// listGithubRepos
// ---------------------------------------------------------------------------
export async function listGithubRepos(maxResults = 50): Promise<unknown[]> {
  if (!GITHUB_ORG) {
    throw new Error("GITHUB_ORG environment variable is not set.");
  }

  const data = await githubFetch(
    `/orgs/${GITHUB_ORG}/repos?per_page=${maxResults}&sort=updated&type=all`
  ) as Array<Record<string, unknown>>;

  return (data ?? []).map((repo) => ({
    name:          repo.name,
    fullName:      repo.full_name,
    description:   repo.description,
    language:      repo.language,
    defaultBranch: repo.default_branch,
    url:           repo.html_url,
    updatedAt:     repo.updated_at,
    isPrivate:     repo.private,
    topics:        repo.topics,
  }));
}

// ---------------------------------------------------------------------------
// getGithubPR
// ---------------------------------------------------------------------------
export async function getGithubPR(params: GetGithubPRParams): Promise<unknown> {
  const { repo, prNumber } = params;
  const repoPath = repo.includes("/") ? repo : `${GITHUB_ORG}/${repo}`;

  const [prData, reviewsData] = await Promise.all([
    githubFetch(`/repos/${repoPath}/pulls/${prNumber}`),
    githubFetch(`/repos/${repoPath}/pulls/${prNumber}/reviews`),
  ]);

  const pr      = prData  as Record<string, unknown>;
  const reviews = reviewsData as Array<Record<string, unknown>>;

  return {
    number:      pr.number,
    title:       pr.title,
    state:       pr.state,
    author:      (pr.user as Record<string, unknown>)?.login,
    body:        pr.body,
    createdAt:   pr.created_at,
    updatedAt:   pr.updated_at,
    mergedAt:    pr.merged_at,
    url:         pr.html_url,
    headBranch:  (pr.head as Record<string, unknown>)?.ref,
    baseBranch:  (pr.base as Record<string, unknown>)?.ref,
    reviewers:   reviews.map((r) => ({
      reviewer: (r.user as Record<string, unknown>)?.login,
      state:    r.state,
    })),
  };
}

// ---------------------------------------------------------------------------
// getApiDependencies
// Searches the repository for common API call patterns to build a dependency map
// ---------------------------------------------------------------------------
export async function getApiDependencies(params: GetApiDependenciesParams): Promise<{
  repo:         string;
  branch:       string;
  dependencies: string[];
  sources:      GithubCodeResult[];
}> {
  const { repo, branch = "main" } = params;

  // Common patterns that indicate external API calls
  const patterns = [
    "fetch(",
    "axios.get",
    "axios.post",
    "http.get",
    "RestTemplate",
    "WebClient",
    "HttpClient",
  ];

  // Search for each pattern concurrently, collect unique URLs/endpoints
  const searches = await Promise.allSettled(
    patterns.map((pattern) =>
      searchGithubCode({ query: pattern, repo, maxResults: 5 })
    )
  );

  const allResults: GithubCodeResult[] = [];
  for (const result of searches) {
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    }
  }

  // Deduplicate by path
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  // Extract URL-like strings from fragments as dependency hints
  const urlPattern = /https?:\/\/[^\s"'`]+/g;
  const dependencies = new Set<string>();
  for (const result of unique) {
    const matches = result.fragment.match(urlPattern) ?? [];
    for (const m of matches) {
      // Clean up and keep only meaningful URL prefixes
      const clean = m.replace(/[,;)'"]+$/, "");
      if (clean.length > 10) dependencies.add(clean);
    }
  }

  const repoPath = repo.includes("/") ? repo : `${GITHUB_ORG}/${repo}`;

  return {
    repo:         repoPath,
    branch,
    dependencies: Array.from(dependencies),
    sources:      unique,
  };
}
