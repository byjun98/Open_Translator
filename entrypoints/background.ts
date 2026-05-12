import {
  BACKGROUND_MESSAGE_TYPES,
  TRANSLATION_CACHE_LIMIT,
  createErrorResponse,
  createSuccessResponse,
  isBackgroundRequest,
  type BackgroundResponse,
  type GetSettingsResponse,
  type OpenSubtitlePreviewMessage,
  type OpenSubtitlePreviewResponse,
  type PolishSubtitleCuesMessage,
  type PolishSubtitleCuesResponse,
  type TranslatePageTextsMessage,
  type TranslatePageTextsResponse,
  type TranslateSubtitleCuesMessage,
  type TranslateSubtitleCuesResponse,
  type TranslateSubtitleMessage,
  type TranslateSubtitleResponse,
} from '../lib/messages.ts';
import { requestChatCompletion } from '../lib/openai.ts';
import { loadSettings } from '../lib/settings.ts';

const translationCache = new Map<string, string>();
const pageTranslationCache = new Map<string, string>();
const PAGE_TRANSLATION_CACHE_STORAGE_KEY = 'pageTranslationCache:v1';
const PAGE_TRANSLATION_CACHE_LIMIT = 1800;

let pageTranslationCacheLoaded = false;
let pageTranslationCacheLoadPromise: Promise<void> | null = null;
let pageTranslationCachePersistPromise: Promise<void> = Promise.resolve();

function normalizeSourceText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getCacheKey(
  model: string,
  targetLanguage: string,
  promptTemplate: string,
  text: string,
  sourceLanguageHint?: string,
): string {
  return JSON.stringify([
    model,
    targetLanguage,
    promptTemplate,
    sourceLanguageHint?.trim() || 'unknown',
    normalizeSourceText(text),
  ]);
}

function rememberTranslation(key: string, value: string) {
  if (translationCache.has(key)) {
    translationCache.delete(key);
  }

  translationCache.set(key, value);

  if (translationCache.size <= TRANSLATION_CACHE_LIMIT) {
    return;
  }

  const oldestKey = translationCache.keys().next().value;
  if (typeof oldestKey === 'string') {
    translationCache.delete(oldestKey);
  }
}

async function createPageTranslationCacheKey(
  model: string,
  targetLanguage: string,
  text: string,
) {
  const normalized = JSON.stringify([
    'page',
    model,
    targetLanguage,
    normalizeSourceText(text),
  ]);
  const encoded = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function ensurePageTranslationCacheLoaded() {
  if (pageTranslationCacheLoaded) {
    return;
  }

  pageTranslationCacheLoadPromise ??= (async () => {
    const stored = await browser.storage.local.get(
      PAGE_TRANSLATION_CACHE_STORAGE_KEY,
    );
    const entries = stored[PAGE_TRANSLATION_CACHE_STORAGE_KEY];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string'
        ) {
          pageTranslationCache.set(entry[0], entry[1]);
        }
      }
    }

    pageTranslationCacheLoaded = true;
  })();

  await pageTranslationCacheLoadPromise;
}

async function persistPageTranslationCache() {
  pageTranslationCachePersistPromise = pageTranslationCachePersistPromise
    .catch(() => undefined)
    .then(async () => {
      while (pageTranslationCache.size > PAGE_TRANSLATION_CACHE_LIMIT) {
        const oldestKey = pageTranslationCache.keys().next().value;
        if (typeof oldestKey !== 'string') {
          break;
        }
        pageTranslationCache.delete(oldestKey);
      }

      await browser.storage.local.set({
        [PAGE_TRANSLATION_CACHE_STORAGE_KEY]: Array.from(pageTranslationCache),
      });
    });

  await pageTranslationCachePersistPromise;
}

async function getCachedPageTranslation(
  model: string,
  targetLanguage: string,
  text: string,
) {
  await ensurePageTranslationCacheLoaded();
  const key = await createPageTranslationCacheKey(model, targetLanguage, text);
  const cached = pageTranslationCache.get(key);
  return { cached, key };
}

async function rememberPageTranslations(entries: Array<[string, string]>) {
  if (entries.length === 0) {
    return;
  }

  await ensurePageTranslationCacheLoaded();
  for (const [key, value] of entries) {
    if (pageTranslationCache.has(key)) {
      pageTranslationCache.delete(key);
    }
    pageTranslationCache.set(key, value);
  }

  await persistPageTranslationCache();
}

function renderPrompt(
  promptTemplate: string,
  {
    pageUrl,
    sourceLanguageHint,
    targetLanguage,
    text,
  }: {
    pageUrl?: string;
    sourceLanguageHint?: string;
    targetLanguage: string;
    text: string;
  },
) {
  return promptTemplate
    .replaceAll('{{targetLanguage}}', targetLanguage)
    .replaceAll('{{sourceLanguage}}', sourceLanguageHint?.trim() || 'unknown')
    .replaceAll('{{pageUrl}}', pageUrl ?? '')
    .replaceAll('{{text}}', text);
}

function buildMessages(
  promptTemplate: string,
  payload: TranslateSubtitleMessage['payload'],
  targetLanguage: string,
  sourceText: string,
) {
  const renderedPrompt = renderPrompt(promptTemplate, {
    pageUrl: payload.pageUrl,
    sourceLanguageHint: payload.sourceLanguageHint,
    targetLanguage,
    text: sourceText,
  });

  if (promptTemplate.includes('{{text}}')) {
    return [
      {
        role: 'system' as const,
        content: 'You translate live video subtitles accurately and concisely.',
      },
      {
        role: 'user' as const,
        content: renderedPrompt,
      },
    ];
  }

  return [
    {
      role: 'system' as const,
      content: renderedPrompt,
    },
    {
      role: 'user' as const,
      content: sourceText,
    },
  ];
}

function parseJsonArray(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('The model did not return a JSON array.');
  }
}

function parsePolishedCueResponse(text: string) {
  const parsed = parseJsonArray(text);
  if (!Array.isArray(parsed)) {
    throw new Error('The model response was not a JSON array.');
  }

  return parsed.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { index?: unknown }).index !== 'number' ||
      typeof (item as { translation?: unknown }).translation !== 'string'
    ) {
      throw new Error('The model returned an invalid polished subtitle item.');
    }

    return {
      index: (item as { index: number }).index,
      translation: (item as { translation: string }).translation.trim(),
    };
  });
}

function parsePageTranslationResponse(text: string) {
  const parsed = parseJsonArray(text);
  if (!Array.isArray(parsed)) {
    throw new Error('The model response was not a JSON array.');
  }

  return parsed.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { id?: unknown }).id !== 'number' ||
      typeof (item as { translation?: unknown }).translation !== 'string'
    ) {
      throw new Error('The model returned an invalid page translation item.');
    }

    return {
      id: (item as { id: number }).id,
      translation: (item as { translation: string }).translation.trim(),
    };
  });
}

function buildPolishMessages(
  message: PolishSubtitleCuesMessage,
  targetLanguage: string,
) {
  const cuePayload = message.payload.cues.map((cue) => ({
    index: cue.index,
    time: `${cue.start.toFixed(3)}-${cue.end.toFixed(3)}`,
    source: cue.source,
    translation: cue.translation,
  }));

  return [
    {
      role: 'system' as const,
      content:
        'You polish subtitle translations using surrounding context. Preserve meaning, timing, speaker intent, terminology, and subtitle readability. Do not add explanations.',
    },
    {
      role: 'user' as const,
      content: `Target language: ${message.payload.targetLanguage || targetLanguage}
Source language hint: ${message.payload.sourceLanguageHint || 'unknown'}
Video title: ${message.payload.title || ''}
Page URL: ${message.payload.pageUrl || ''}

Polish the translation field for each subtitle cue. Keep the same index values. Return ONLY a JSON array shaped like:
[{"index":0,"translation":"..."}, ...]

Subtitle cues:
${JSON.stringify(cuePayload)}`,
    },
  ];
}

function buildContextTranslateMessages(
  message: TranslateSubtitleCuesMessage,
  targetLanguage: string,
) {
  const cuePayload = message.payload.cues.map((cue) => ({
    index: cue.index,
    time: `${cue.start.toFixed(3)}-${cue.end.toFixed(3)}`,
    source: cue.source,
  }));

  return [
    {
      role: 'system' as const,
      content:
        'You translate subtitle cues using surrounding context. Preserve each cue index exactly. Make translations natural, concise, and readable at subtitle speed. Do not add explanations.',
    },
    {
      role: 'user' as const,
      content: `Target language: ${message.payload.targetLanguage || targetLanguage}
Source language hint: ${message.payload.sourceLanguageHint || 'unknown'}
Video title: ${message.payload.title || ''}
Page URL: ${message.payload.pageUrl || ''}

Translate each subtitle cue. Keep the same index values. Return ONLY a JSON array shaped like:
[{"index":0,"translation":"..."}, ...]

Subtitle cues:
${JSON.stringify(cuePayload)}`,
    },
  ];
}

function buildPageTranslateMessages(
  message: TranslatePageTextsMessage,
  targetLanguage: string,
) {
  const effectiveTargetLanguage =
    message.payload.targetLanguage?.trim() || targetLanguage;
  const textPayload = message.payload.items.map((item) => ({
    id: item.id,
    text: item.text,
  }));

  return [
    {
      role: 'system' as const,
      content:
        'You translate webpage text fragments. Preserve each id exactly. Preserve the original tone, formality, politeness level, and writing style. Do not summarize, embellish, or change the speaker intent. Preserve placeholder tags such as <x0>...</x0>, URLs, numbers, product names, and UI intent. Return only valid JSON and do not add explanations.',
    },
    {
      role: 'user' as const,
      content: `Target language: ${effectiveTargetLanguage}
Page URL: ${message.payload.pageUrl || ''}

Translate each text field. Keep the same id values. Return ONLY a JSON array shaped like:
[{"id":1,"translation":"..."}, ...]

Text fragments:
${JSON.stringify(textPayload)}`,
    },
  ];
}

async function handleGetSettingsMessage(): Promise<GetSettingsResponse> {
  const settings = await loadSettings();
  return createSuccessResponse(BACKGROUND_MESSAGE_TYPES.getSettings, {
    settings,
  });
}

async function handleOpenSubtitlePreviewMessage(
  message: OpenSubtitlePreviewMessage,
): Promise<OpenSubtitlePreviewResponse> {
  const url = browser.runtime.getURL(
    `/subtitle-preview.html?id=${encodeURIComponent(message.payload.id)}&mode=${message.payload.mode}` as unknown as never,
  );

  await browser.tabs.create({ url });

  return createSuccessResponse(
    BACKGROUND_MESSAGE_TYPES.openSubtitlePreview,
    { opened: true },
  );
}

async function handleTranslatePageTextsMessage(
  message: TranslatePageTextsMessage,
): Promise<TranslatePageTextsResponse> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    return createErrorResponse(
      message.type,
      'TRANSLATOR_DISABLED',
      'The translator is disabled in the extension options.',
    );
  }

  const targetLanguage =
    message.payload.targetLanguage?.trim() || settings.targetLanguage;
  const cachedItems: Array<{ id: number; translation: string }> = [];
  const missingItems: TranslatePageTextsMessage['payload']['items'] = [];
  const cacheKeysById = new Map<number, string>();

  for (const item of message.payload.items) {
    const { cached, key } = await getCachedPageTranslation(
      settings.model,
      targetLanguage,
      item.text,
    );
    if (cached !== undefined) {
      cachedItems.push({
        id: item.id,
        translation: cached,
      });
    } else {
      missingItems.push(item);
      cacheKeysById.set(item.id, key);
    }
  }

  if (missingItems.length === 0) {
    return createSuccessResponse(message.type, {
      items: cachedItems,
      targetLanguage,
    });
  }

  const completion = await requestChatCompletion({
    model: settings.model,
    timeoutMs: Math.max(settings.requestTimeoutMs, 60000),
    messages: buildPageTranslateMessages(
      {
        ...message,
        payload: {
          ...message.payload,
          items: missingItems,
        },
      },
      targetLanguage,
    ),
  });

  if (!completion.ok) {
    return createErrorResponse(
      message.type,
      completion.error.code,
      completion.error.message,
      {
        details: completion.error.details,
        retriable: completion.error.retriable,
        status: completion.error.status,
      },
    );
  }

  try {
    const translatedItems = parsePageTranslationResponse(completion.data.content);
    await rememberPageTranslations(
      translatedItems
        .map((item) => {
          const cacheKey = cacheKeysById.get(item.id);
          return cacheKey && item.translation
            ? ([cacheKey, item.translation] as [string, string])
            : undefined;
        })
        .filter((item): item is [string, string] => Array.isArray(item)),
    );

    return createSuccessResponse(message.type, {
      items: [...cachedItems, ...translatedItems],
      targetLanguage,
    });
  } catch (error) {
    return createErrorResponse(
      message.type,
      'INVALID_REQUEST',
      error instanceof Error
        ? error.message
        : 'The model returned invalid page translations.',
    );
  }
}

async function handleTranslateSubtitleCuesMessage(
  message: TranslateSubtitleCuesMessage,
): Promise<TranslateSubtitleCuesResponse> {
  const settings = await loadSettings();
  const completion = await requestChatCompletion({
    model: settings.model,
    timeoutMs: Math.max(settings.requestTimeoutMs, 60000),
    messages: buildContextTranslateMessages(message, settings.targetLanguage),
  });

  if (!completion.ok) {
    return createErrorResponse(
      message.type,
      completion.error.code,
      completion.error.message,
      {
        details: completion.error.details,
        retriable: completion.error.retriable,
        status: completion.error.status,
      },
    );
  }

  try {
    return createSuccessResponse(message.type, {
      cues: parsePolishedCueResponse(completion.data.content),
    });
  } catch (error) {
    return createErrorResponse(
      message.type,
      'INVALID_REQUEST',
      error instanceof Error
        ? error.message
        : 'The model returned invalid contextual subtitle translations.',
    );
  }
}

async function handlePolishSubtitleCuesMessage(
  message: PolishSubtitleCuesMessage,
): Promise<PolishSubtitleCuesResponse> {
  const settings = await loadSettings();
  const completion = await requestChatCompletion({
    model: settings.model,
    timeoutMs: Math.max(settings.requestTimeoutMs, 60000),
    messages: buildPolishMessages(message, settings.targetLanguage),
  });

  if (!completion.ok) {
    return createErrorResponse(
      message.type,
      completion.error.code,
      completion.error.message,
      {
        details: completion.error.details,
        retriable: completion.error.retriable,
        status: completion.error.status,
      },
    );
  }

  try {
    return createSuccessResponse(message.type, {
      cues: parsePolishedCueResponse(completion.data.content),
    });
  } catch (error) {
    return createErrorResponse(
      message.type,
      'INVALID_REQUEST',
      error instanceof Error
        ? error.message
        : 'The model returned invalid polished subtitles.',
    );
  }
}

async function handleTranslateSubtitleMessage(
  message: TranslateSubtitleMessage,
): Promise<TranslateSubtitleResponse> {
  const settings = await loadSettings();
  if (!settings.enabled && !message.payload.force) {
    return createErrorResponse(
      message.type,
      'TRANSLATOR_DISABLED',
      'The translator is disabled in the extension options.',
    );
  }

  const sourceText = message.payload.text
    .trim()
    .slice(0, settings.maxCharactersPerRequest);

  if (!sourceText) {
    return createErrorResponse(
      message.type,
      'INVALID_REQUEST',
      'Subtitle text must be a non-empty string.',
    );
  }

  const cacheKey = getCacheKey(
    settings.model,
    settings.targetLanguage,
    settings.promptTemplate,
    sourceText,
    message.payload.sourceLanguageHint,
  );
  const cachedTranslation = translationCache.get(cacheKey);

  if (cachedTranslation !== undefined) {
    return createSuccessResponse(message.type, {
      cached: true,
      model: settings.model,
      sourceText,
      targetLanguage: settings.targetLanguage,
      translation: cachedTranslation,
    });
  }

  const completion = await requestChatCompletion({
    model: settings.model,
    timeoutMs: settings.requestTimeoutMs,
    messages: buildMessages(
      settings.promptTemplate,
      message.payload,
      settings.targetLanguage,
      sourceText,
    ),
  });

  if (!completion.ok) {
    return createErrorResponse(
      message.type,
      completion.error.code,
      completion.error.message,
      {
        details: completion.error.details,
        retriable: completion.error.retriable,
        status: completion.error.status,
      },
    );
  }

  rememberTranslation(cacheKey, completion.data.content);

  return createSuccessResponse(message.type, {
    cached: false,
    model: settings.model,
    sourceText,
    targetLanguage: settings.targetLanguage,
    translation: completion.data.content,
  });
}

async function handleRuntimeMessage(message: unknown): Promise<BackgroundResponse> {
  if (!isBackgroundRequest(message)) {
    return createErrorResponse(
      'unknown',
      'INVALID_MESSAGE',
      'Unsupported background message payload.',
    );
  }

  try {
    switch (message.type) {
      case BACKGROUND_MESSAGE_TYPES.getSettings:
        return await handleGetSettingsMessage();
      case BACKGROUND_MESSAGE_TYPES.openSubtitlePreview:
        return await handleOpenSubtitlePreviewMessage(message);
      case BACKGROUND_MESSAGE_TYPES.translatePageTexts:
        return await handleTranslatePageTextsMessage(message);
      case BACKGROUND_MESSAGE_TYPES.polishSubtitleCues:
        return await handlePolishSubtitleCuesMessage(message);
      case BACKGROUND_MESSAGE_TYPES.translateSubtitleCues:
        return await handleTranslateSubtitleCuesMessage(message);
      case BACKGROUND_MESSAGE_TYPES.translateSubtitle:
        return await handleTranslateSubtitleMessage(message);
      default:
        return createErrorResponse(
          'unknown',
          'INVALID_MESSAGE',
          'Unsupported background message type.',
        );
    }
  } catch (error) {
    const messageText =
      error instanceof Error
        ? error.message
        : 'Unexpected background service worker error.';

    return createErrorResponse(message.type, 'UNEXPECTED_ERROR', messageText);
  }
}

export default defineBackground({
  type: 'module',
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      void handleRuntimeMessage(message).then(sendResponse);
      return true;
    });
  },
});
