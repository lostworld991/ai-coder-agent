import { execSync } from 'child_process';

export async function cloneRepo(repoUrl: string, dest: string, token?: string): Promise<void> {
  const authUrl = token
    ? repoUrl.replace('https://', `https://x-access-token:${token}@`)
    : repoUrl;
  execSync(`git clone --depth 1 ${authUrl} ${dest}`, { stdio: 'pipe', timeout: 120_000 });
}

export async function createBranch(repoPath: string, branch: string): Promise<void> {
  execSync(`git checkout -b ${branch}`, { cwd: repoPath, stdio: 'pipe' });
}

export async function commitAndPush(
  repoPath: string,
  branch: string,
  token?: string,
  message?: string
): Promise<void> {
  execSync('git add -A', { cwd: repoPath, stdio: 'pipe' });
  execSync(`git commit -m "${(message || 'AI coder changes').replace(/"/g, '\\"')}"`, {
    cwd: repoPath,
    stdio: 'pipe',
  });

  const remoteUrl = execSync('git remote get-url origin', {
    cwd: repoPath,
    encoding: 'utf-8',
  }).trim();
  const authUrl = token
    ? remoteUrl.replace('https://', `https://x-access-token:${token}@`)
    : remoteUrl;
  execSync(`git push -u ${authUrl} ${branch}`, { cwd: repoPath, stdio: 'pipe', timeout: 60_000 });
}

export async function openPR(
  repoUrl: string,
  branch: string,
  title: string,
  token?: string
): Promise<{ number: number }> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (!match) throw new Error('Invalid GitHub repo URL');

  const owner = match[1];
  const repo = match[2];

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      title,
      head: branch,
      base: 'main',
      body: `Automated PR: ${title}`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to open PR: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  return { number: data.number };
}

export async function addComment(
  repoUrl: string,
  issueNumber: number,
  body: string,
  token?: string
): Promise<void> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
  if (!match) throw new Error('Invalid GitHub repo URL');

  const owner = match[1];
  const repo = match[2];

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ body }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to add comment: ${response.status} ${err}`);
  }
}
