import {
  HARD_CODED_PROXY_BASE_URL,
  PROXY_BASE_URLS,
  type BackgroundErrorCode,
  type BackgroundErrorDetails,
} from './messages.ts';

const ALLOWED_PROXY_HOSTS = new Set(['127.0.0.1']);
const ALLOWED_PROXY_PORTS = new Set(['10531', '10532']);
const REQUIRED_PROXY_PREFIX = '/v1';
const PROXY_PROBE_TIMEOUT_MS = 1500;
let cachedProxyBaseUrl: string | undefined;

export interface ChatCompletionMessage {
  role: 'assistant' | 'system' | 'user';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatCompletionMessage[];
  model: string;
  timeoutMs: number;
}

export interface ChatCompletionSuccess {
  content: string;
  responseId?: string;
}

export type ChatCompletionResult =
  | {
      ok: true;
      data: ChatCompletionSuccess;
    }
  | {
      ok: false;
      error: BackgroundErrorDetails;
    };

interface OpenAIErrorPayload {
  code?: string;
  message?: string;
  type?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            text?: string;
            type?: string;
          }>;
      role?: string;
    };
  }>;
  error?: OpenAIErrorPayload;
  id?: string;
}

type OpenAIMessageContent =
  | string
  | Array<{
      text?: string;
      type?: string;
    }>
  | undefined;

function createProxyError(
  code: BackgroundErrorCode,
  message: string,
  extras: Omit<Partial<BackgroundErrorDetails>, 'code' | 'message'> = {},
): ChatCompletionResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...extras,
    },
  };
}

function validateProxyBaseUrl(baseUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('The local proxy URL is not a valid URL.');
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('The local proxy URL must use http.');
  }

  if (!ALLOWED_PROXY_HOSTS.has(parsed.hostname)) {
    throw new Error('The local proxy URL must stay on localhost or 127.0.0.1.');
  }

  if (!ALLOWED_PROXY_PORTS.has(parsed.port)) {
    throw new Error('The local proxy URL must use port 10531 or 10532.');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('The local proxy URL must not include a query string or hash.');
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPath !== REQUIRED_PROXY_PREFIX) {
    throw new Error('The local proxy URL must point to /v1.');
  }

  return parsed;
}

// Reasoning models (gpt-5.x mini/preview, o-series) reject sampling params.
// Matches gpt-5, gpt-5.4-mini, gpt-5.5-preview, o1, o3, o4-mini, etc.
function isReasoningModel(model: string): boolean {
  return /^(gpt-5(?:\.\d+)?(?:-|$)|o[1-9](?:-|$))/i.test(model);
}

function getProxyEndpoint(baseUrl: string, endpointPath: string): URL {
  const parsedBaseUrl = validateProxyBaseUrl(baseUrl);
  const pathPrefix = parsedBaseUrl.pathname.replace(/\/+$/, '');
  const endpoint = new URL(parsedBaseUrl.origin);
  endpoint.pathname = `${pathPrefix}${endpointPath}`;

  if (
    !ALLOWED_PROXY_HOSTS.has(endpoint.hostname) ||
    !ALLOWED_PROXY_PORTS.has(endpoint.port) ||
    endpoint.pathname !== `${REQUIRED_PROXY_PREFIX}${endpointPath}`
  ) {
    throw new Error('The resolved proxy endpoint is not allowed.');
  }

  return endpoint;
}

function getCandidateProxyBaseUrls(): string[] {
  if (!cachedProxyBaseUrl) {
    return [...PROXY_BASE_URLS];
  }

  return [
    cachedProxyBaseUrl,
    ...PROXY_BASE_URLS.filter((baseUrl) => baseUrl !== cachedProxyBaseUrl),
  ];
}

async function probeProxyBaseUrl(baseUrl: string): Promise<boolean> {
  const endpoint = getProxyEndpoint(baseUrl, '/models');
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    PROXY_PROBE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json');
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function getChatCompletionsUrl(): Promise<URL> {
  const fallbackBaseUrl = validateProxyBaseUrl(HARD_CODED_PROXY_BASE_URL);

  for (const candidateBaseUrl of getCandidateProxyBaseUrls()) {
    try {
      if (await probeProxyBaseUrl(candidateBaseUrl)) {
        cachedProxyBaseUrl = candidateBaseUrl;
        return getProxyEndpoint(candidateBaseUrl, '/chat/completions');
      }
    } catch {
      // Try the next configured localhost proxy port.
    }
  }

  throw new Error(
    `No local OpenAI-compatible proxy responded on ${fallbackBaseUrl.hostname}:10531 or ${fallbackBaseUrl.hostname}:10532.`,
  );
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : undefined;
}

function extractTextContent(
  content: OpenAIMessageContent,
): string | undefined {
  if (typeof content === 'string') {
    const normalized = content.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const merged = content
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return merged.length > 0 ? merged : undefined;
}

export async function requestChatCompletion({
  messages,
  model,
  timeoutMs,
}: ChatCompletionRequest): Promise<ChatCompletionResult> {
  let endpoint: URL;

  try {
    endpoint = await getChatCompletionsUrl();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The local proxy request endpoint is unavailable.';
    return createProxyError('PROXY_NETWORK_ERROR', message, {
      retriable: true,
    });
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
      signal: controller.signal,
    });

    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      const errorPayload =
        typeof responseBody === 'object' && responseBody !== null
          ? (responseBody as { error?: OpenAIErrorPayload }).error
          : undefined;

      return createProxyError(
        'PROXY_HTTP_ERROR',
        errorPayload?.message ??
          `The local proxy returned HTTP ${response.status}.`,
        {
          details: responseBody,
          retriable: response.status >= 500,
          status: response.status,
        },
      );
    }

    const parsed =
      typeof responseBody === 'object' && responseBody !== null
        ? (responseBody as OpenAIChatCompletionResponse)
        : undefined;

    const content = parsed?.choices?.[0]?.message?.content
      ? extractTextContent(parsed.choices[0].message.content)
      : undefined;

    if (!content) {
      return createProxyError(
        'EMPTY_RESPONSE',
        'The local proxy did not return translated text.',
        {
          details: responseBody,
        },
      );
    }

    return {
      ok: true,
      data: {
        content,
        responseId: parsed?.id,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return createProxyError(
        'PROXY_TIMEOUT',
        `The local proxy timed out after ${timeoutMs}ms.`,
        {
          retriable: true,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : 'The local proxy request failed unexpectedly.';

    cachedProxyBaseUrl = undefined;
    return createProxyError('PROXY_NETWORK_ERROR', message, {
      retriable: true,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
