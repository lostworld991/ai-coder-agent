import { Provider } from './index';
import { ToolDefinition, ToolResult } from '../agent/types';
import { ToolExecutor } from '../agent/tools';
import { CODING_AGENT_SYSTEM_PROMPT } from '../agent/prompts';
import { Logger } from '../logger';
import { cloneRepo, createBranch, commitAndPush, openPR } from '../github/api';
import { EventEmitter } from 'events';

const logger = new Logger('Agent');

export interface AgentRunOptions {
  task: string;
  repoUrl: string;
  stream?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentEvent {
  type: 'status' | 'tool_call' | 'tool_result' | 'error' | 'complete';
  message: string;
  data?: any;
}

export interface AgentResult {
  id: string;
  success: boolean;
  branch?: string;
  pr?: number;
  error?: string;
  steps: AgentStep[];
}

interface AgentStep {
  action: string;
  detail: string;
  timestamp: Date;
}

const MAX_ITERATIONS = 20;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the full content of a file at the given path',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if needed',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a specific string in a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        old_text: { type: 'string', description: 'Exact text to find' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'run_bash',
    description: 'Execute a shell command in the working directory',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Relative directory path' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern in files using grep/ripgrep',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Relative directory path' },
        pattern: { type: 'string', description: 'Search pattern' },
      },
      required: ['dir', 'pattern'],
    },
  },
];

export class AgentRunner {
  private provider: Provider;
  private executor: ToolExecutor;
  private settings: any;

  constructor(provider: Provider, settings: any) {
    this.provider = provider;
    this.settings = settings;
    this.executor = new ToolExecutor('');
  }

  async run(options: AgentRunOptions): Promise<AgentResult> {
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result: AgentResult = { id, success: false, steps: [] };
    const workspace = `/tmp/workspace-${id}`;

    const emit = (type: AgentEvent['type'], message: string, data?: any) => {
      const event: AgentEvent = { type, message, data };
      options.onEvent?.(event);
      result.steps.push({ action: type, detail: message, timestamp: new Date() });
      logger.info(message, { runId: id, type, data });
    };

    try {
      emit('status', 'Cloning repository...');
      await cloneRepo(options.repoUrl, workspace, this.settings.githubToken);
      this.executor = new ToolExecutor(workspace);

      const branch = `ai-coder/${Date.now()}`;
      await createBranch(workspace, branch);

      emit('status', 'Starting agentic loop...');
      await this.agenticLoop(options.task, workspace, emit);

      emit('status', 'Running tests...');
      const testResult = await this.executor.run_bash('npm test || pytest || make test');
      if (testResult.exitCode !== 0) {
        emit('status', 'Tests failed, attempting fix...');
        await this.attemptFix(testResult.output, workspace, emit);
      }

      emit('status', 'Committing and pushing changes...');
      await commitAndPush(workspace, branch, this.settings.githubToken, `AI: ${options.task}`);

      emit('status', 'Opening pull request...');
      const pr = await openPR(options.repoUrl, branch, options.task, this.settings.githubToken);

      result.success = true;
      result.branch = branch;
      result.pr = pr.number;
      emit('complete', `Done! PR #${pr.number} opened`, { branch, pr: pr.number });
    } catch (err: any) {
      result.error = err.message;
      emit('error', err.message);
    }

    return result;
  }

  private async agenticLoop(task: string, workspace: string, emit: (type: AgentEvent['type'], message: string, data?: any) => void): Promise<void> {
    const messages: Array<{ role: string; content: any }> = [
      { role: 'user', content: `Task: ${task}\n\nWorking directory: ${workspace}` },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      emit('status', `Agent step ${i + 1}/${MAX_ITERATIONS}`);

      const response = await this.provider.complete('', {
        system: CODING_AGENT_SYSTEM_PROMPT,
        maxTokens: 4096,
      });

      const parsed = this.parseResponse(response.content);

      if (parsed.tool_calls && parsed.tool_calls.length > 0) {
        for (const tc of parsed.tool_calls) {
          emit('tool_call', `Calling ${tc.name}`, tc.args);
          const toolResult = await this.executeTool(tc.name, tc.args);
          emit('tool_result', `${tc.name}: ${toolResult.success ? 'OK' : 'FAILED'}`, toolResult);

          if (!toolResult.success && i === MAX_ITERATIONS - 1) {
            throw new Error(`Tool ${tc.name} failed: ${toolResult.error}`);
          }
        }
      }

      if (parsed.done) break;
    }
  }

  private parseResponse(content: string): { tool_calls?: Array<{ name: string; args: any }>; done?: boolean } {
    const toolCalls: Array<{ name: string; args: any }> = [];

    const toolBlockRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match;
    while ((match = toolBlockRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        toolCalls.push({ name: parsed.name, args: parsed.args });
      } catch {}
    }

    const done = /<done\s*\/>/.test(content) || toolCalls.length === 0;

    return { tool_calls: toolCalls, done };
  }

  private async executeTool(name: string, args: any): Promise<ToolResult> {
    switch (name) {
      case 'read_file':
        return this.executor.read_file(args.path);
      case 'write_file':
        return this.executor.write_file(args.path, args.content);
      case 'edit_file':
        return this.executor.edit_file(args.path, args.old_text, args.new_text);
      case 'run_bash':
        return this.executor.run_bash(args.command);
      case 'list_files':
        return this.executor.list_files(args.dir);
      case 'search_files':
        return this.executor.search_files(args.dir, args.pattern);
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  }

  private async attemptFix(errorOutput: string, workspace: string, emit: (type: AgentEvent['type'], message: string, data?: any) => void): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      emit('status', `Fix attempt ${attempt + 1}/3`);

      const response = await this.provider.complete(
        `Test failure:\n${errorOutput}\n\nFix the code to make tests pass. Use the available tools to read, edit, and re-run tests.`,
        { system: CODING_AGENT_SYSTEM_PROMPT }
      );

      const parsed = this.parseResponse(response.content);
      if (parsed.tool_calls) {
        for (const tc of parsed.tool_calls) {
          await this.executeTool(tc.name, tc.args);
        }
      }

      const testResult = await this.executor.run_bash('npm test || pytest || make test');
      if (testResult.exitCode === 0) {
        emit('status', 'Tests passing!');
        return;
      }
    }

    throw new Error('Tests failed after 3 fix attempts');
  }
}
