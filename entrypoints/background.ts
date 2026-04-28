import {
  BACKGROUND_MESSAGE_TYPES,
  TRANSLATION_CACHE_LIMIT,
  createErrorResponse,
  createSuccessResponse,
  isBackgroundRequest,
  type BackgroundResponse,
  type GetSettingsResponse,
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

async function handleGetSettingsMessage(): Promise<GetSettingsResponse> {
  const settings = await loadSettings();
  return createSuccessResponse(BACKGROUND_MESSAGE_TYPES.getSettings, {
    settings,
  });
}

async function handleTranslateSubtitleMessage(
  message: TranslateSubtitleMessage,
): Promise<TranslateSubtitleResponse> {
  const settings = await loadSettings();
  if (!settings.enabled) {
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
