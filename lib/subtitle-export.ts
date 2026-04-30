export type SubtitleExportMode = 'translated' | 'bilingual';

export interface SubtitleExportCue {
  start: number;
  end: number;
  source: string;
  translation: string;
}

export interface SubtitleExportPayload {
  id: string;
  createdAt: string;
  pageUrl: string;
  title: string;
  videoId: string | null;
  targetLanguage: string;
  sourceLanguageHint: string;
  cues: SubtitleExportCue[];
  recommendedMode: SubtitleExportMode;
}

export const SUBTITLE_EXPORT_STORAGE_PREFIX = 'subtitleExport:';

function pad(value: number, size = 2) {
  return String(value).padStart(size, '0');
}

export function formatSrtTimestamp(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const totalMilliseconds = Math.round(safeSeconds * 1000);
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milliseconds, 3)}`;
}

function normalizeSrtText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replaceAll('-->', '->')
    .trim();
}

function cueText(cue: SubtitleExportCue, mode: SubtitleExportMode) {
  const source = normalizeSrtText(cue.source);
  const translation = normalizeSrtText(cue.translation || cue.source);

  if (mode === 'translated') {
    return translation;
  }

  return [translation, source].filter(Boolean).join('\n');
}

export function buildSrt(
  cues: SubtitleExportCue[],
  mode: SubtitleExportMode,
) {
  return cues
    .filter((cue) => cue.end > cue.start && cueText(cue, mode).length > 0)
    .map((cue, index) => {
      const start = formatSrtTimestamp(cue.start);
      const end = formatSrtTimestamp(cue.end);
      return `${index + 1}\n${start} --> ${end}\n${cueText(cue, mode)}`;
    })
    .join('\n\n');
}

export function sanitizeFilename(name: string) {
  const fallback = 'youtube-subtitles';
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || fallback
  );
}
