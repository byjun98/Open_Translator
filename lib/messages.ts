import type { ExtensionSettings } from './settings.ts';

export const HARD_CODED_PROXY_BASE_URL = 'http://127.0.0.1:10531/v1';
export const TRANSLATION_CACHE_LIMIT = 120;

export const BACKGROUND_MESSAGE_TYPES = {
  getSettings: 'settings:get',
  openSubtitlePreview: 'subtitle-preview:open',
  polishSubtitleCues: 'subtitle:polish-cues',
  translateSubtitleCues: 'subtitle:translate-cues',
  translateSubtitle: 'subtitle:translate',
} as const;

export type BackgroundMessageType =
  (typeof BACKGROUND_MESSAGE_TYPES)[keyof typeof BACKGROUND_MESSAGE_TYPES];
export type BackgroundResponseType = BackgroundMessageType | 'unknown';

export type BackgroundErrorCode =
  | 'EMPTY_RESPONSE'
  | 'INVALID_MESSAGE'
  | 'INVALID_REQUEST'
  | 'PROXY_CONFIG'
  | 'PROXY_HTTP_ERROR'
  | 'PROXY_NETWORK_ERROR'
  | 'PROXY_TIMEOUT'
  | 'TRANSLATOR_DISABLED'
  | 'UNEXPECTED_ERROR';

export interface GetSettingsMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.getSettings;
}

export interface TranslateSubtitleMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.translateSubtitle;
  payload: {
    text: string;
    pageUrl?: string;
    sourceLanguageHint?: string;
    force?: boolean;
  };
}

export interface OpenSubtitlePreviewMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.openSubtitlePreview;
  payload: {
    id: string;
    mode: 'translated' | 'bilingual';
  };
}

export interface PolishSubtitleCuePayload {
  index: number;
  start: number;
  end: number;
  source: string;
  translation: string;
}

export interface PolishSubtitleCuesMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.polishSubtitleCues;
  payload: {
    cues: PolishSubtitleCuePayload[];
    pageUrl?: string;
    sourceLanguageHint?: string;
    targetLanguage?: string;
    title?: string;
  };
}

export interface TranslateSubtitleCuePayload {
  index: number;
  start: number;
  end: number;
  source: string;
}

export interface TranslateSubtitleCuesMessage {
  type: typeof BACKGROUND_MESSAGE_TYPES.translateSubtitleCues;
  payload: {
    cues: TranslateSubtitleCuePayload[];
    pageUrl?: string;
    sourceLanguageHint?: string;
    targetLanguage?: string;
    title?: string;
  };
}

export type BackgroundRequest =
  | GetSettingsMessage
  | OpenSubtitlePreviewMessage
  | PolishSubtitleCuesMessage
  | TranslateSubtitleCuesMessage
  | TranslateSubtitleMessage;

export interface BackgroundErrorDetails {
  code: BackgroundErrorCode;
  message: string;
  details?: unknown;
  retriable?: boolean;
  status?: number;
}

export interface BackgroundSuccessResponse<
  TType extends BackgroundMessageType,
  TData,
> {
  ok: true;
  type: TType;
  data: TData;
}

export interface BackgroundErrorResponse<
  TType extends BackgroundResponseType = BackgroundResponseType,
> {
  ok: false;
  type: TType;
  error: BackgroundErrorDetails;
}

export type GetSettingsResponse =
  | BackgroundSuccessResponse<
      typeof BACKGROUND_MESSAGE_TYPES.getSettings,
      { settings: ExtensionSettings }
    >
  | BackgroundErrorResponse<typeof BACKGROUND_MESSAGE_TYPES.getSettings>;

export type TranslateSubtitleResponse =
  | BackgroundSuccessResponse<
      typeof BACKGROUND_MESSAGE_TYPES.translateSubtitle,
      {
        cached: boolean;
        model: string;
        sourceText: string;
        targetLanguage: string;
        translation: string;
      }
    >
  | BackgroundErrorResponse<typeof BACKGROUND_MESSAGE_TYPES.translateSubtitle>;

export type OpenSubtitlePreviewResponse =
  | BackgroundSuccessResponse<
      typeof BACKGROUND_MESSAGE_TYPES.openSubtitlePreview,
      { opened: true }
    >
  | BackgroundErrorResponse<typeof BACKGROUND_MESSAGE_TYPES.openSubtitlePreview>;

export type PolishSubtitleCuesResponse =
  | BackgroundSuccessResponse<
      typeof BACKGROUND_MESSAGE_TYPES.polishSubtitleCues,
      {
        cues: Array<{
          index: number;
          translation: string;
        }>;
      }
    >
  | BackgroundErrorResponse<typeof BACKGROUND_MESSAGE_TYPES.polishSubtitleCues>;

export type TranslateSubtitleCuesResponse =
  | BackgroundSuccessResponse<
      typeof BACKGROUND_MESSAGE_TYPES.translateSubtitleCues,
      {
        cues: Array<{
          index: number;
          translation: string;
        }>;
      }
    >
  | BackgroundErrorResponse<typeof BACKGROUND_MESSAGE_TYPES.translateSubtitleCues>;

export type BackgroundResponse =
  | GetSettingsResponse
  | OpenSubtitlePreviewResponse
  | PolishSubtitleCuesResponse
  | TranslateSubtitleCuesResponse
  | TranslateSubtitleResponse
  | BackgroundErrorResponse<'unknown'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === BACKGROUND_MESSAGE_TYPES.getSettings) {
    return true;
  }

  if (value.type === BACKGROUND_MESSAGE_TYPES.openSubtitlePreview) {
    if (!isRecord(value.payload)) {
      return false;
    }

    const { id, mode } = value.payload;
    return (
      typeof id === 'string' &&
      id.length > 0 &&
      (mode === 'translated' || mode === 'bilingual')
    );
  }

  if (value.type === BACKGROUND_MESSAGE_TYPES.polishSubtitleCues) {
    if (!isRecord(value.payload) || !Array.isArray(value.payload.cues)) {
      return false;
    }

    const { pageUrl, sourceLanguageHint, targetLanguage, title } = value.payload;
    return (
      value.payload.cues.length > 0 &&
      value.payload.cues.every((cue) => {
        if (!isRecord(cue)) return false;
        return (
          typeof cue.index === 'number' &&
          Number.isInteger(cue.index) &&
          typeof cue.start === 'number' &&
          typeof cue.end === 'number' &&
          typeof cue.source === 'string' &&
          typeof cue.translation === 'string'
        );
      }) &&
      (pageUrl === undefined || typeof pageUrl === 'string') &&
      (sourceLanguageHint === undefined || typeof sourceLanguageHint === 'string') &&
      (targetLanguage === undefined || typeof targetLanguage === 'string') &&
      (title === undefined || typeof title === 'string')
    );
  }

  if (value.type === BACKGROUND_MESSAGE_TYPES.translateSubtitleCues) {
    if (!isRecord(value.payload) || !Array.isArray(value.payload.cues)) {
      return false;
    }

    const { pageUrl, sourceLanguageHint, targetLanguage, title } = value.payload;
    return (
      value.payload.cues.length > 0 &&
      value.payload.cues.every((cue) => {
        if (!isRecord(cue)) return false;
        return (
          typeof cue.index === 'number' &&
          Number.isInteger(cue.index) &&
          typeof cue.start === 'number' &&
          typeof cue.end === 'number' &&
          typeof cue.source === 'string'
        );
      }) &&
      (pageUrl === undefined || typeof pageUrl === 'string') &&
      (sourceLanguageHint === undefined || typeof sourceLanguageHint === 'string') &&
      (targetLanguage === undefined || typeof targetLanguage === 'string') &&
      (title === undefined || typeof title === 'string')
    );
  }

  if (value.type !== BACKGROUND_MESSAGE_TYPES.translateSubtitle) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  const { force, pageUrl, sourceLanguageHint, text } = value.payload;
  return (
    typeof text === 'string' &&
    (pageUrl === undefined || typeof pageUrl === 'string') &&
    (sourceLanguageHint === undefined || typeof sourceLanguageHint === 'string') &&
    (force === undefined || typeof force === 'boolean')
  );
}

export function createSuccessResponse<
  TType extends BackgroundMessageType,
  TData,
>(type: TType, data: TData): BackgroundSuccessResponse<TType, TData> {
  return {
    ok: true,
    type,
    data,
  };
}

export function createErrorResponse<
  TType extends BackgroundResponseType = BackgroundResponseType,
>(
  type: TType,
  code: BackgroundErrorCode,
  message: string,
  extras: Omit<Partial<BackgroundErrorDetails>, 'code' | 'message'> = {},
): BackgroundErrorResponse<TType> {
  return {
    ok: false,
    type,
    error: {
      code,
      message,
      ...extras,
    },
  };
}
