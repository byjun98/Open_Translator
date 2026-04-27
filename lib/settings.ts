export type OverlayPosition = 'top' | 'bottom';

export interface ExtensionSettings {
  enabled: boolean;
  targetLanguage: string;
  model: string;
  promptTemplate: string;
  requestTimeoutMs: number;
  debounceMs: number;
  showSourceCaption: boolean;
  overlayPosition: OverlayPosition;
  maxCharactersPerRequest: number;
}

export const defaults: ExtensionSettings = {
  enabled: true,
  targetLanguage: 'Korean',
  model: 'gpt-5.4-mini',
  promptTemplate: `Translate the current YouTube subtitle into {{targetLanguage}}.
Keep it natural, concise, and easy to read at subtitle speed.
Preserve proper nouns, speaker intent, and line breaks when helpful.
Return only the translated subtitle text.

{{text}}`,
  requestTimeoutMs: 30000,
  debounceMs: 220,
  showSourceCaption: true,
  overlayPosition: 'bottom',
  maxCharactersPerRequest: 160,
};

const legacyInvalidModels = new Set([
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-4.1',
  'o4-mini',
]);

const storageKeys = Object.keys(defaults) as (keyof ExtensionSettings)[];

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeText(
  value: unknown,
  fallback: string,
  maxLength: number,
  trim = true,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = trim ? value.trim() : value;
  if (normalized.length === 0) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function sanitizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

function sanitizeOverlayPosition(
  value: unknown,
  fallback: OverlayPosition,
): OverlayPosition {
  return value === 'top' || value === 'bottom' ? value : fallback;
}

function sanitizeSettings(
  value: Partial<Record<keyof ExtensionSettings, unknown>>,
): ExtensionSettings {
  const promptTemplate = sanitizeText(
    value.promptTemplate,
    defaults.promptTemplate,
    4000,
    false,
  ).trim();
  const requestedModel = sanitizeText(value.model, defaults.model, 128);
  const model = legacyInvalidModels.has(requestedModel)
    ? defaults.model
    : requestedModel;

  return {
    enabled: sanitizeBoolean(value.enabled, defaults.enabled),
    targetLanguage: sanitizeText(
      value.targetLanguage,
      defaults.targetLanguage,
      32,
    ),
    model,
    promptTemplate:
      promptTemplate.length > 0 ? promptTemplate : defaults.promptTemplate,
    requestTimeoutMs: sanitizeInteger(
      value.requestTimeoutMs,
      defaults.requestTimeoutMs,
      5000,
      120000,
    ),
    debounceMs: sanitizeInteger(value.debounceMs, defaults.debounceMs, 180, 2000),
    showSourceCaption: sanitizeBoolean(
      value.showSourceCaption,
      defaults.showSourceCaption,
    ),
    overlayPosition: sanitizeOverlayPosition(
      value.overlayPosition,
      defaults.overlayPosition,
    ),
    maxCharactersPerRequest: sanitizeInteger(
      value.maxCharactersPerRequest,
      defaults.maxCharactersPerRequest,
      60,
      1000,
    ),
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.sync.get(
    defaults as unknown as Partial<Record<string, unknown>>,
  );
  return sanitizeSettings(
    stored as Partial<Record<keyof ExtensionSettings, unknown>>,
  );
}

export async function saveSettings(
  nextSettings: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const merged = sanitizeSettings({ ...current, ...nextSettings });
  await browser.storage.sync.set(merged);
  return merged;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  await browser.storage.sync.remove(storageKeys);
  await browser.storage.sync.set(defaults);
  return { ...defaults };
}
