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
  type TranslateSubtitleCuesMessage,
  type TranslateSubtitleCuesResponse,
  type TranslateSubtitleMessage,
  type TranslateSubtitleResponse,
} from '../lib/messages.ts';
import { requestChatCompletion } from '../lib/openai.ts';
import { loadSettings } from '../lib/settings.ts';

const translationCache = new Map<string, string>();

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
