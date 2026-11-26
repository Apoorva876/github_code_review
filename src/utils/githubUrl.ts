export interface ParsedGitHubRepoUrl {
  ok: true;
  owner: string;
  repo: string;
  fullName: string;
  normalizedUrl: string;
}

export interface InvalidGitHubRepoUrl {
  ok: false;
  error: string;
}

export type GitHubRepoUrlValidationResult = ParsedGitHubRepoUrl | InvalidGitHubRepoUrl;

const RESERVED_GITHUB_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'blog',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'gist',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'sessions',
  'settings',
  'signup',
  'solutions',
  'sponsors',
  'topics',
  'trending',
  'users',
]);

const GITHUB_OWNER_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const GITHUB_REPO_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates that user input is a public GitHub repository URL such as
 * `https://github.com/owner/repository` and extracts `owner` and `repo`.
 */
export function parsePublicGitHubRepoUrl(rawInput: string): GitHubRepoUrlValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Enter a public GitHub repository URL (e.g. https://github.com/owner/repository).',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: 'Invalid URL format. Enter a full GitHub URL like https://github.com/owner/repository.',
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      error: 'GitHub repository URL must start with https:// or http://.',
    };
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return {
      ok: false,
      error: 'Only github.com repository URLs are supported (e.g. https://github.com/owner/repository).',
    };
  }

  if (url.search || url.hash) {
    return {
      ok: false,
      error: 'Enter the root repository URL without query parameters or hash fragments.',
    };
  }

  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments.length !== 2) {
    return {
      ok: false,
      error: 'URL must include both repository owner and name (e.g. https://github.com/owner/repository).',
    };
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (
    !GITHUB_OWNER_REGEX.test(owner) ||
    RESERVED_GITHUB_OWNERS.has(owner.toLowerCase()) ||
    !repo ||
    repo === '.' ||
    repo === '..' ||
    !GITHUB_REPO_REGEX.test(repo)
  ) {
    return {
      ok: false,
      error: 'Invalid GitHub owner or repository name. Example: https://github.com/expressjs/express',
    };
  }

  const fullName = `${owner}/${repo}`;
  return {
    ok: true,
    owner,
    repo,
    fullName,
    normalizedUrl: `https://github.com/${fullName}`,
  };
}
