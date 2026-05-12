import { browser } from 'wxt/browser';

export type PageTranslatorMode = 'replace' | 'bilingual';

export interface PageTranslatorSiteRule {
  includeSelectors: string;
  skipSelectors: string;
}

export interface PageTranslatorSettings {
  mode: PageTranslatorMode;
  siteRules: Record<string, PageTranslatorSiteRule>;
  turboMode: boolean;
}

export const defaultPageTranslatorSettings: PageTranslatorSettings = {
  mode: 'replace',
  siteRules: {},
  turboMode: false,
};

const PAGE_TRANSLATOR_SETTINGS_KEY = 'pageTranslatorSettings';
const MAX_SELECTOR_TEXT_LENGTH = 2000;
const MAX_SITE_RULES = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeSelectorText(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_SELECTOR_TEXT_LENGTH);
}

function sanitizeMode(value: unknown): PageTranslatorMode {
  return value === 'bilingual' ? 'bilingual' : 'replace';
}

function sanitizeSiteRule(value: unknown): PageTranslatorSiteRule {
  if (!isRecord(value)) {
    return { includeSelectors: '', skipSelectors: '' };
  }

  return {
    includeSelectors: sanitizeSelectorText(value.includeSelectors),
    skipSelectors: sanitizeSelectorText(value.skipSelectors),
  };
}

function sanitizeSettings(value: unknown): PageTranslatorSettings {
  if (!isRecord(value)) {
    return { ...defaultPageTranslatorSettings };
  }

  const siteRules: Record<string, PageTranslatorSiteRule> = {};
  const rawRules = isRecord(value.siteRules) ? value.siteRules : {};

  for (const [host, rule] of Object.entries(rawRules).slice(0, MAX_SITE_RULES)) {
    const normalizedHost = host.trim().toLowerCase().slice(0, 253);
    if (!normalizedHost) {
      continue;
    }

    const nextRule = sanitizeSiteRule(rule);
    if (nextRule.includeSelectors || nextRule.skipSelectors) {
      siteRules[normalizedHost] = nextRule;
    }
  }

  return {
    mode: sanitizeMode(value.mode),
    siteRules,
    turboMode: value.turboMode === true,
  };
}

export function getPageTranslatorHostKey(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

export async function loadPageTranslatorSettings(): Promise<PageTranslatorSettings> {
  const stored = await browser.storage.local.get(PAGE_TRANSLATOR_SETTINGS_KEY);
  return sanitizeSettings(stored[PAGE_TRANSLATOR_SETTINGS_KEY]);
}

export async function savePageTranslatorSettings(
  nextSettings: Partial<PageTranslatorSettings>,
): Promise<PageTranslatorSettings> {
  const current = await loadPageTranslatorSettings();
  const merged = sanitizeSettings({ ...current, ...nextSettings });
  await browser.storage.local.set({
    [PAGE_TRANSLATOR_SETTINGS_KEY]: merged,
  });
  return merged;
}

export async function savePageTranslatorSiteRule(
  host: string,
  rule: PageTranslatorSiteRule,
): Promise<PageTranslatorSettings> {
  const current = await loadPageTranslatorSettings();
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    return current;
  }

  const sanitizedRule = sanitizeSiteRule(rule);
  const siteRules = { ...current.siteRules };

  if (sanitizedRule.includeSelectors || sanitizedRule.skipSelectors) {
    siteRules[normalizedHost] = sanitizedRule;
  } else {
    delete siteRules[normalizedHost];
  }

  return savePageTranslatorSettings({ siteRules });
}
