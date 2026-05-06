import { browser } from 'wxt/browser';
import {
  SUBTITLE_EXPORT_STORAGE_PREFIX,
  type SubtitleExportPayload,
} from './subtitle-export.ts';

const SUBTITLE_EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(id: string) {
  return `${SUBTITLE_EXPORT_STORAGE_PREFIX}${id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSubtitleExportPayload(value: unknown): value is SubtitleExportPayload {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.cues) &&
    value.cues.length > 0
  );
}

function isExpiredExport(value: unknown, now: number) {
  if (!isSubtitleExportPayload(value)) return true;

  const createdAt = Date.parse(value.createdAt);
  if (!Number.isFinite(createdAt)) return true;

  return now - createdAt > SUBTITLE_EXPORT_TTL_MS;
}

export async function cleanupExpiredSubtitleExports(now = Date.now()) {
  const stored = await browser.storage.local.get(null);
  const expiredKeys = Object.entries(stored)
    .filter(([key, value]) =>
      key.startsWith(SUBTITLE_EXPORT_STORAGE_PREFIX) && isExpiredExport(value, now),
    )
    .map(([key]) => key);

  if (expiredKeys.length > 0) {
    await browser.storage.local.remove(expiredKeys);
  }
}

export async function saveSubtitleExportPayload(
  id: string,
  payload: SubtitleExportPayload,
) {
  await cleanupExpiredSubtitleExports();
  await browser.storage.local.set({
    [storageKey(id)]: payload,
  });
}

export async function loadSubtitleExportPayload(id: string) {
  await cleanupExpiredSubtitleExports();

  const key = storageKey(id);
  const stored = await browser.storage.local.get(key);
  const payload = stored[key];

  return isSubtitleExportPayload(payload) ? payload : null;
}

export async function removeSubtitleExportPayload(id: string) {
  await browser.storage.local.remove(storageKey(id));
}
