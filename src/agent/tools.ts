export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ToolExecutor {
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  resolve(path: string): string {
    if (path.startsWith('/')) return path;
    return `${this.workspace}/${path}`;
  }

  async read_file(path: string): Promise<ToolResult> {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(this.resolve(path), 'utf-8');
      return { success: true, data: content };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async write_file(path: string, content: string): Promise<ToolResult> {
    try {
      const fs = await import('fs/promises');
      const fullPath = this.resolve(path);
      await fs.mkdir(fullPath.split('/').slice(0, -1).join('/'), { recursive: true });
      await fs.writeFile(fullPath, content);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async edit_file(path: string, old_text: string, new_text: string): Promise<ToolResult> {
    try {
      const fs = await import('fs/promises');
      const fullPath = this.resolve(path);
      const content = await fs.readFile(fullPath, 'utf-8');
      if (!content.includes(old_text)) {
        return { success: false, error: 'old_text not found in file' };
      }
      await fs.writeFile(fullPath, content.replace(old_text, new_text));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async run_bash(command: string): Promise<ToolResult & { exitCode: number; output: string }> {
    const BLOCKED = ['rm -rf /', 'sudo', 'chmod 777', 'curl', 'wget'];
    if (BLOCKED.some((c) => command.toLowerCase().includes(c.toLowerCase()))) {
      return { success: false, error: 'Blocked command', exitCode: 1, output: '' };
    }

    try {
      const { execSync } = await import('child_process');
      const output = execSync(command, {
        cwd: this.workspace,
        encoding: 'utf-8',
        timeout: 120_000,
      });
      return { success: true, exitCode: 0, output };
    } catch (err: any) {
      return {
        success: false,
        exitCode: err.status || 1,
        output: err.stderr?.toString() || err.message,
        error: err.message,
      };
    }
  }

  async list_files(dir: string): Promise<ToolResult> {
    try {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(this.resolve(dir), { withFileTypes: true });
      return {
        success: true,
        data: entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async search_files(dir: string, pattern: string): Promise<ToolResult> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync(`rg -n "${pattern}" ${this.resolve(dir)} || grep -rn "${pattern}" ${this.resolve(dir)}`, {
        encoding: 'utf-8',
      });
      return { success: true, data: output.trim().split('\n').filter(Boolean) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
