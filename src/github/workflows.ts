import { AgentRunner } from '../agent/loop';
import { createProvider } from '../providers/index';
import { addComment, getPRComments, getCheckRunLogs } from './api';
import { Logger } from '../logger';

const logger = new Logger('Workflows');

export async function processNewIssue(payload: any, settings: any): Promise<void> {
  const issue = payload.issue;
  const repo = payload.repository.html_url;
  const task = `Fix issue #${issue.number}: ${issue.title}\n\n${issue.body || ''}`;
  logger.info('Processing new issue', { issue: issue.number, repo });

  const provider = createProvider(settings);
  const runner = new AgentRunner(provider, settings);
  const result = await runner.run({ task, repoUrl: repo });

  if (result.success && result.pr) {
    await addComment(repo, issue.number, `PR #${result.pr} opened to address this issue.`, settings.githubToken);
  }
}

export async function processIssueComment(payload: any, settings: any): Promise<void> {
  const comment = payload.comment;
  const issue = payload.issue;
  const repo = payload.repository.html_url;
  const task = `Address comment on issue #${issue.number}:\n${comment.body}`;
  logger.info('Processing issue comment', { issue: issue.number, repo });

  const provider = createProvider(settings);
  const runner = new AgentRunner(provider, settings);
  await runner.run({ task, repoUrl: repo });
}

export async function processNewPR(payload: any, settings: any): Promise<void> {
  const pr = payload.pull_request;
  const repo = payload.repository.html_url;
  const task = `Review PR #${pr.number}: ${pr.title}\n\nSuggest improvements and fixes.`;
  logger.info('Processing new PR', { pr: pr.number, repo });

  const provider = createProvider(settings);
  const runner = new AgentRunner(provider, settings);
  await runner.run({ task, repoUrl: repo });
}

export async function handleCIFailure(payload: any, settings: any): Promise<void> {
  const checkRun = payload.check_run;
  const repo = payload.repository.html_url;
  const branch = checkRun.head_branch;
  const task = `CI failed on branch "${branch}". Check run: ${checkRun.name}\n\nFailure output:\n${checkRun.output?.summary || 'No output available'}\n\nFix the code to pass CI.`;
  logger.info('Handling CI failure', { repo, branch, checkRun: checkRun.name });

  const provider = createProvider(settings);
  const runner = new AgentRunner(provider, settings);
  await runner.run({ task, repoUrl: repo });
}

export async function handleReviewComment(payload: any, settings: any): Promise<void> {
  const comment = payload.comment;
  const pr = payload.pull_request;
  const repo = payload.repository.html_url;
  const task = `Code review comment on PR #${pr.number}:\nFile: ${comment.path}\nLine: ${comment.line || comment.original_line}\n\nComment: ${comment.body}\n\nApply the suggested change.`;
  logger.info('Handling review comment', { repo, pr: pr.number, file: comment.path });

  const provider = createProvider(settings);
  const runner = new AgentRunner(provider, settings);
  await runner.run({ task, repoUrl: repo });
}
