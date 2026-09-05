import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../logger';

const logger = new Logger('Settings');

export interface Settings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  githubToken: string;
  githubRepo: string;
  autoCode: boolean;
  autoFix: boolean;
}

const SETTINGS_PATH = process.env.SETTINGS_PATH || path.join(__dirname, '../../settings/settings.json');

const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  modelName: '',
  githubToken: '',
  githubRepo: '',
  autoCode: true,
  autoFix: true,
};

let cache: Settings | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;

  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
    cache = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }

  return cache!;
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };

  validateSettings(updated);

  cache = updated;

  writeQueue = writeQueue.then(async () => {
    const dir = path.dirname(SETTINGS_PATH);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${SETTINGS_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2));
    await fs.rename(tmp, SETTINGS_PATH);
    logger.info('Settings saved');
  });

  return updated;
}

export async function testConnection(
  settings: Partial<Settings>
): Promise<{ ok: boolean; message: string }> {
  if (!settings.apiKey) {
    return { ok: false, message: 'API key is required' };
  }

  try {
    const { createProvider } = await import('../providers/index');
    const provider = createProvider({ ...DEFAULT_SETTINGS, ...settings } as Settings);
    const response = await provider.complete('Reply with OK to test connection.');
    return { ok: true, message: `Connected: ${response.content.slice(0, 80)}` };
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

function validateSettings(settings: Settings): void {
  const validProviders = ['openai', 'anthropic', 'custom'];
  if (!validProviders.includes(settings.provider)) {
    throw new Error(`Invalid provider: ${settings.provider}. Must be one of: ${validProviders.join(', ')}`);
  }

  if (settings.provider === 'custom' && !settings.baseUrl) {
    throw new Error('Custom provider requires baseUrl');
  }

  if (settings.baseUrl && !isValidUrl(settings.baseUrl)) {
    throw new Error('Invalid baseUrl format');
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function redactSettings(settings: Settings): Partial<Settings> {
  return {
    ...settings,
    apiKey: settings.apiKey ? '***' : '',
    githubToken: settings.githubToken ? '***' : '',
  };
}
