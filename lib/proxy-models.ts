import { PROXY_BASE_URLS } from './messages.ts';

const DEFAULT_PROXY_MODELS = [
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'codex-auto-review',
];

type ModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

export interface ProxyModelFetchAttempt {
  baseUrl: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ProxyModelsResult {
  models: string[];
  source: 'proxy' | 'fallback';
  checkedAt: string;
  baseUrl?: string;
  error?: string;
  attempts: ProxyModelFetchAttempt[];
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function formatError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout';
  }
  return error instanceof Error ? error.message : String(error);
}

export async function fetchProxyModels() {
  const attempts: ProxyModelFetchAttempt[] = [];

  for (const baseUrl of PROXY_BASE_URLS) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/models`, 1500);
      if (!response.ok) {
        attempts.push({
          baseUrl,
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        });
        continue;
      }

      const payload = (await response.json()) as ModelsResponse;
      const modelIds =
        payload.data
          ?.map((entry) => entry.id?.trim() || '')
          .filter(Boolean) ?? [];

      if (modelIds.length === 0) {
        attempts.push({
          baseUrl,
          ok: false,
          status: response.status,
          error: 'empty model list',
        });
        continue;
      }

      return {
        models: Array.from(new Set([...modelIds, ...DEFAULT_PROXY_MODELS])),
        source: 'proxy',
        checkedAt: new Date().toISOString(),
        baseUrl,
        attempts: [
          ...attempts,
          {
            baseUrl,
            ok: true,
            status: response.status,
          },
        ],
      } satisfies ProxyModelsResult;
    } catch (error) {
      attempts.push({
        baseUrl,
        ok: false,
        error: formatError(error),
      });
      // Try the next localhost proxy port.
    }
  }

  return {
    models: DEFAULT_PROXY_MODELS,
    source: 'fallback',
    checkedAt: new Date().toISOString(),
    error:
      attempts.map((attempt) => `${attempt.baseUrl}: ${attempt.error}`).join(' | ') ||
      'no proxy response',
    attempts,
  } satisfies ProxyModelsResult;
}

export { DEFAULT_PROXY_MODELS };
