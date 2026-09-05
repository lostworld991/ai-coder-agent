export interface Provider {
  complete(
    prompt: string,
    opts?: { system?: string; maxTokens?: number }
  ): Promise<ProviderResponse>;

  stream(
    prompt: string,
    opts: { system?: string; maxTokens?: number },
    onChunk: (chunk: string) => void
  ): Promise<ProviderResponse>;
}

export interface ProviderResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  modelName?: string;
  headers?: Record<string, string>;
}

export function createProvider(config: ProviderConfig): Provider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'custom':
      return new CustomProvider(config);
    case 'openai':
    default:
      return new OpenAIProvider(config);
  }
}

class OpenAIProvider implements Provider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private endpoint(path: string): string {
    const base = this.config.baseUrl || 'https://api.openai.com/v1';
    return `${base}${path}`;
  }

  private model(): string {
    return this.config.modelName || 'gpt-4-turbo';
  }

  async complete(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<ProviderResponse> {
    return this.call(prompt, opts);
  }

  async stream(
    prompt: string,
    opts: { system?: string; maxTokens?: number },
    onChunk: (chunk: string) => void
  ): Promise<ProviderResponse> {
    return this.call(prompt, opts, true, onChunk);
  }

  private async call(
    prompt: string,
    opts?: { system?: string; maxTokens?: number },
    stream = false,
    onChunk?: (chunk: string) => void
  ): Promise<ProviderResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts?.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(this.endpoint('/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.model(),
        messages,
        max_tokens: opts?.maxTokens || 4096,
        stream,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider error ${response.status}: ${body}`);
    }

    if (stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              content += delta;
              onChunk?.(delta);
            }
          } catch {}
        }
      }

      return { content };
    }

    const data = (await response.json()) as any;
    return {
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }
}

class AnthropicProvider implements Provider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private endpoint(path: string): string {
    const base = this.config.baseUrl || 'https://api.anthropic.com/v1';
    return `${base}${path}`;
  }

  private model(): string {
    return this.config.modelName || 'claude-sonnet-4-20250514';
  }

  async complete(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<ProviderResponse> {
    return this.call(prompt, opts);
  }

  async stream(
    prompt: string,
    opts: { system?: string; maxTokens?: number },
    onChunk: (chunk: string) => void
  ): Promise<ProviderResponse> {
    return this.call(prompt, opts, true, onChunk);
  }

  private async call(
    prompt: string,
    opts?: { system?: string; maxTokens?: number },
    stream = false,
    onChunk?: (chunk: string) => void
  ): Promise<ProviderResponse> {
    const response = await fetch(this.endpoint('/messages'), {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.model(),
        messages: [{ role: 'user', content: prompt }],
        system: opts?.system,
        max_tokens: opts?.maxTokens || 4096,
        stream,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider error ${response.status}: ${body}`);
    }

    if (stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta') {
              const delta = parsed.delta?.text;
              if (delta) {
                content += delta;
                onChunk?.(delta);
              }
            }
          } catch {}
        }
      }

      return { content };
    }

    const data = (await response.json()) as any;
    return {
      content: data.content?.[0]?.text || '',
      usage: data.usage
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
        : undefined,
    };
  }
}

class CustomProvider implements Provider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private endpoint(path: string): string {
    if (!this.config.baseUrl) throw new Error('Custom provider requires baseUrl');
    return `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private model(): string {
    return this.config.modelName || 'default';
  }

  async complete(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<ProviderResponse> {
    return this.call(prompt, opts);
  }

  async stream(
    prompt: string,
    opts: { system?: string; maxTokens?: number },
    onChunk: (chunk: string) => void
  ): Promise<ProviderResponse> {
    return this.call(prompt, opts, true, onChunk);
  }

  private async call(
    prompt: string,
    opts?: { system?: string; maxTokens?: number },
    stream = false,
    onChunk?: (chunk: string) => void
  ): Promise<ProviderResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts?.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(this.endpoint('/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.model(),
        messages,
        max_tokens: opts?.maxTokens || 4096,
        stream,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider error ${response.status}: ${body}`);
    }

    if (stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta =
              parsed.choices?.[0]?.delta?.content || parsed.delta?.content || parsed.content;
            if (delta) {
              content += delta;
              onChunk?.(delta);
            }
          } catch {}
        }
      }

      return { content };
    }

    const data = (await response.json()) as any;
    return {
      content:
        data.choices?.[0]?.message?.content ||
        data.content?.[0]?.text ||
        data.content ||
        '',
    };
  }
}
