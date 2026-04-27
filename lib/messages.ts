import type { ExtensionSettings } from './settings.ts';

export const HARD_CODED_PROXY_BASE_URL = 'http://127.0.0.1:10531/v1';
export const TRANSLATION_CACHE_LIMIT = 120;

export const BACKGROUND_MESSAGE_TYPES = {
  getSettings: 'settings:get',
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
  };
}

export type BackgroundRequest = GetSettingsMessage | TranslateSubtitleMessage;

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

export type BackgroundResponse =
  | GetSettingsResponse
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

  if (value.type !== BACKGROUND_MESSAGE_TYPES.translateSubtitle) {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  const { pageUrl, sourceLanguageHint, text } = value.payload;
  return (
    typeof text === 'string' &&
    (pageUrl === undefined || typeof pageUrl === 'string') &&
    (sourceLanguageHint === undefined || typeof sourceLanguageHint === 'string')
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
