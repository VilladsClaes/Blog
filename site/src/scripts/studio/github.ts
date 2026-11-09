// GitHub-forbindelsen til opslagsstudiet. Token'et gemmes kun i browseren
// (ligesom Sveltia CMS gør det) og sendes aldrig til bloggens server.

export interface Settings {
  token: string;
  repo: string;
  branch: string;
}

const DEFAULT_REPO = 'VilladsClaes/Blog';
const DEFAULT_BRANCH = 'main';
const TOKEN_KEY = 'studio.token';
const REPO_KEY = 'studio.repo';
const BRANCH_KEY = 'studio.branch';

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const write = (key: string, value: string) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* privat vindue */
  }
};

export function getSettings(): Settings {
  return {
    token: read(TOKEN_KEY),
    repo: read(REPO_KEY) || DEFAULT_REPO,
    branch: read(BRANCH_KEY) || DEFAULT_BRANCH,
  };
}

export function saveSettings(settings: Partial<Settings>) {
  if (settings.token !== undefined) write(TOKEN_KEY, settings.token.trim());
  if (settings.repo !== undefined) write(REPO_KEY, normalizeRepo(settings.repo));
  if (settings.branch !== undefined) write(BRANCH_KEY, settings.branch.trim() || DEFAULT_BRANCH);
}

export function forgetToken() {
  write(TOKEN_KEY, '');
}

export function normalizeRepo(repo: string) {
  return repo
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '') || DEFAULT_REPO;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const repoPath = (repo: string) => repo.split('/').map(encodeURIComponent).join('/');

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const { token } = getSettings();
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const json = await res.json();
      detail = typeof json?.message === 'string' ? json.message : '';
    } catch {
      /* svaret var ikke JSON */
    }
    if (res.status === 401) {
      throw new GitHubError(401, 'GitHub afviste token. Lav et nyt fine-grained token med Contents: Read and write.');
    }
    if (res.status === 403) {
      throw new GitHubError(403, `GitHub nægter adgang${detail ? `: ${detail}` : ''}. Tjek at token må skrive til ${getSettings().repo}.`);
    }
    if (res.status === 404) {
      throw new GitHubError(404, `Filen eller repoet blev ikke fundet${detail ? `: ${detail}` : ''}.`);
    }
    throw new GitHubError(res.status, detail || `GitHub svarede ${res.status}.`);
  }
  return res;
}

export async function testConnection(): Promise<string> {
  if (!getSettings().token) throw new Error('Indsæt et GitHub-token først.');
  const { repo } = getSettings();
  const res = await gh(`/repos/${repoPath(repo)}`);
  const data = await res.json();
  return `${data.full_name} · standardgren: ${data.default_branch}`;
}

async function tryGetFile(path: string): Promise<{ sha: string } | null> {
  const { token, repo, branch } = getSettings();
  if (!token) throw new Error('Indsæt et GitHub-token først.');
  const res = await fetch(
    `https://api.github.com/repos/${repoPath(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 401) throw new GitHubError(401, 'GitHub afviste token. Lav et nyt fine-grained token med Contents: Read and write.');
    throw new GitHubError(res.status, `GitHub kunne ikke læse ${path} (${res.status}).`);
  }
  const data = await res.json();
  return { sha: data.sha };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface CommitResult {
  commitUrl: string;
  fileUrl: string;
}

export async function putFile(path: string, bytes: Uint8Array, message: string): Promise<CommitResult> {
  const { repo, branch } = getSettings();
  const existing = await tryGetFile(path);
  const body = {
    message,
    content: toBase64(bytes),
    branch,
    ...(existing ? { sha: existing.sha } : {}),
  };
  const res = await gh(`/repos/${repoPath(repo)}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return {
    commitUrl: data.commit?.html_url ?? '',
    fileUrl: data.content?.html_url ?? '',
  };
}

export async function uploadMedia(path: string, bytes: Uint8Array, message: string): Promise<CommitResult> {
  return putFile(path, bytes, message);
}

export async function publishMarkdown(slug: string, markdown: string, message: string): Promise<CommitResult> {
  const path = `site/src/content/posts/${slug}.md`;
  if (await tryGetFile(path)) {
    throw new Error(`Der findes allerede et indlæg på adressen “${slug}”. Vælg en anden adresse.`);
  }
  return putFile(path, new TextEncoder().encode(markdown), message);
}
