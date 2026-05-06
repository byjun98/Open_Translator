import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  BACKGROUND_MESSAGE_TYPES,
  type OpenSubtitlePreviewResponse,
  type TranslateSubtitleCuesResponse,
  type TranslateSubtitleResponse,
} from '../../lib/messages.ts';
import {
  defaults,
  loadSettings,
  saveSettings,
  type ExtensionSettings,
} from '../../lib/settings.ts';
import {
  type SubtitleExportMode,
  type SubtitleExportPayload,
} from '../../lib/subtitle-export.ts';
import { saveSubtitleExportPayload } from '../../lib/subtitle-export-storage.ts';
import {
  fetchCaptionCues,
  findActiveCueIndex,
  pickCaptionTrack,
  type CaptionCue,
} from './captions.ts';
import {
  requestTracksFromPage,
  subscribeToCaptionTracks,
} from './pageBridge.ts';

const CUE_PREFETCH_COUNT = 10;
const CUE_INITIAL_PREFETCH = 8;
const CONTEXT_TRANSLATION_CHUNK_SIZE = 40;
const CONTEXT_TRANSLATION_CONCURRENCY = 1;
const PREFETCH_CONCURRENCY = 3;
const CAPTION_RECT_POLL_MS = 250;

type TranslationStatus = 'idle' | 'observing' | 'translating' | 'ready' | 'error';

type StorageChangeMap = Record<
  string,
  {
    newValue?: unknown;
  }
>;

type CaptionRect = {
  left: number;
  bottom: number;
  width: number;
  isNative: boolean;
};

type PlayerMenuAnchor = {
  bottom: number;
  right: number;
};

const PLAYER_BUTTON_ID = 'Open_Translator-player-button';
const PLAYER_BUTTON_STYLE_ID = 'Open_Translator-player-button-style';
const NATIVE_CAPTION_STYLE_ID = 'Open_Translator-native-style';

function isVideoPage() {
  return (
    location.hostname === 'www.youtube.com' &&
    (location.pathname === '/watch' || location.pathname.startsWith('/shorts/'))
  );
}

function getVideoRouteKey() {
  return isVideoPage() ? `${location.pathname}${location.search}` : '';
}

function getVideoIdFromRouteKey(routeKey: string) {
  if (!routeKey) return null;

  if (routeKey.startsWith('/watch')) {
    const queryIndex = routeKey.indexOf('?');
    if (queryIndex < 0) return null;
    return new URLSearchParams(routeKey.slice(queryIndex)).get('v');
  }

  const shortsMatch = routeKey.match(/^\/shorts\/([^/?#]+)/);
  return shortsMatch?.[1] ?? null;
}

function captionTrackMatchesVideoId(baseUrl: string, videoId: string) {
  try {
    const url = new URL(baseUrl, location.origin);
    const trackVideoId = url.searchParams.get('v');
    return !trackVideoId || trackVideoId === videoId;
  } catch {
    return true;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getBackgroundErrorMessage(error: { code?: string; message?: string }) {
  const code = error.code ? `[${error.code}] ` : '';
  return `${code}${error.message || 'Unknown background error'}`;
}

function isExtensionContextInvalidatedError(error: unknown) {
  return /extension context invalidated/i.test(getErrorMessage(error));
}

function getVideoTitle() {
  const titleNode =
    document.querySelector('h1.ytd-watch-metadata') ??
    document.querySelector('h1.title') ??
    document.querySelector('meta[name="title"]');

  const title =
    titleNode instanceof HTMLMetaElement
      ? titleNode.content
      : titleNode?.textContent;

  return (title || document.title.replace(/\s*-\s*YouTube\s*$/, '')).trim();
}

function getPlayerMenuAnchor(rect: DOMRect): PlayerMenuAnchor {
  const menuWidth = Math.min(352, window.innerWidth - 24);
  const right = clamp(
    window.innerWidth - rect.right,
    12,
    Math.max(12, window.innerWidth - menuWidth - 12),
  );
  const bottom = clamp(
    window.innerHeight - rect.top + 8,
    12,
    Math.max(12, window.innerHeight - 12),
  );

  return { bottom, right };
}

function removePlayerButton() {
  document.getElementById(PLAYER_BUTTON_ID)?.remove();
}

function ensurePlayerButtonStyles() {
  if (document.getElementById(PLAYER_BUTTON_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = PLAYER_BUTTON_STYLE_ID;
  style.textContent = `
    .${PLAYER_BUTTON_ID}.ytp-button {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 50px !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 5px !important;
      border: 0 !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      background: transparent !important;
      box-sizing: border-box !important;
      line-height: normal !important;
      vertical-align: top !important;
      transform: none !important;
    }

    .${PLAYER_BUTTON_ID}__pill {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 42px;
      height: 28px;
      padding: 0 9px;
      border-radius: 10px;
      box-sizing: border-box;
      font-family: Arial, sans-serif;
      font-size: 15px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #ffffff;
      background: linear-gradient(135deg, rgba(232, 73, 150, 0.98), rgba(132, 79, 255, 0.98));
      box-shadow: 0 8px 24px rgba(120, 71, 255, 0.28);
      transition: transform 140ms ease, opacity 140ms ease, filter 140ms ease;
    }

    .${PLAYER_BUTTON_ID}:hover .${PLAYER_BUTTON_ID}__pill {
      transform: translateY(-1px);
      filter: saturate(1.08);
    }

    .${PLAYER_BUTTON_ID}[data-enabled="false"] .${PLAYER_BUTTON_ID}__pill {
      background: rgba(255, 255, 255, 0.16);
      box-shadow: none;
      color: rgba(255, 255, 255, 0.9);
    }

    .${PLAYER_BUTTON_ID}[data-error="true"] .${PLAYER_BUTTON_ID}__pill {
      background: linear-gradient(135deg, rgba(255, 112, 87, 0.98), rgba(180, 54, 86, 0.98));
      box-shadow: 0 8px 24px rgba(180, 54, 86, 0.26);
    }
  `;

  document.head.append(style);
}

function ensureNativeCaptionReplacementStyles() {
  if (document.getElementById(NATIVE_CAPTION_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = NATIVE_CAPTION_STYLE_ID;
  style.textContent = `
    .Open_Translator-hide-native .caption-window,
    .Open_Translator-hide-native .captions-text,
    .Open_Translator-hide-native .caption-visual-line,
    .Open_Translator-hide-native .ytp-caption-segment {
      background: transparent !important;
      color: transparent !important;
      text-shadow: none !important;
      border-color: transparent !important;
      box-shadow: none !important;
    }
  `;

  document.head.append(style);
}

function upsertPlayerButton(
  isEnabled: boolean,
  hasError: boolean,
  errorMessage: string,
  onToggle: () => void,
  onOpenOptions: () => void,
) {
  ensurePlayerButtonStyles();

  const controls = document.querySelector('#movie_player .ytp-right-controls');
  if (!(controls instanceof HTMLElement)) {
    return;
  }

  let button = document.getElementById(PLAYER_BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement('button');
    button.id = PLAYER_BUTTON_ID;
    button.className = `ytp-button ${PLAYER_BUTTON_ID}`;
    button.type = 'button';
    button.innerHTML = `<span class="${PLAYER_BUTTON_ID}__pill">AI</span>`;
    controls.prepend(button);
  } else if (button.parentElement !== controls) {
    controls.prepend(button);
  }

  button.dataset.enabled = String(isEnabled);
  button.dataset.error = String(hasError);
  button.title = hasError
    ? `${errorMessage} (우클릭: 설정)`
    : isEnabled
      ? 'AI 자막 번역 켜짐 (클릭: 끄기, 우클릭: 설정)'
      : 'AI 자막 번역 꺼짐 (클릭: 켜기, 우클릭: 설정)';
  button.setAttribute('aria-label', button.title);
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  };
  button.oncontextmenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenOptions();
  };
}

function findCaptionContainer() {
  return document.querySelector('#movie_player .ytp-caption-window-container');
}

function getPlayerRect() {
  const player = document.querySelector('#movie_player');
  if (!(player instanceof HTMLElement)) {
    return null;
  }

  const rect = player.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return rect;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPlayerFallbackCaptionRect() {
  const playerRect = getPlayerRect();
  if (!playerRect) {
    return null;
  }

  const horizontalInset = Math.min(72, Math.max(16, playerRect.width * 0.04));
  const width = Math.min(980, Math.max(240, playerRect.width - horizontalInset * 2));
  const bottomInset = Math.min(128, Math.max(56, playerRect.height * 0.1));

  return {
    left: playerRect.left + (playerRect.width - width) / 2,
    bottom: playerRect.bottom - bottomInset,
    width,
    isNative: false,
  } satisfies CaptionRect;
}

function getVisibleCaptionWindows() {
  const container = findCaptionContainer();
  if (!(container instanceof HTMLElement)) {
    return [];
  }

  const captionWindows = Array.from(
    container.querySelectorAll('.caption-window'),
  ) as HTMLElement[];

  const visibleWindows = captionWindows.filter(
    (windowNode) => windowNode.getClientRects().length > 0,
  );

  if (visibleWindows.length > 0) {
    return visibleWindows;
  }

  return [];
}

function getCaptionRect() {
  const windows = getVisibleCaptionWindows();
  if (windows.length === 0) {
    return getPlayerFallbackCaptionRect();
  }

  const rects = windows
    .map((windowNode) => windowNode.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length === 0) {
    return getPlayerFallbackCaptionRect();
  }

  let left = Math.min(...rects.map((rect) => rect.left));
  let right = Math.max(...rects.map((rect) => rect.right));
  let bottom = Math.max(...rects.map((rect) => rect.bottom));

  const playerRect = getPlayerRect();
  if (playerRect) {
    const inset = Math.min(24, Math.max(10, playerRect.width * 0.01));
    const maxWidth = Math.max(120, playerRect.width - inset * 2);
    const width = Math.min(right - left, maxWidth);
    left = clamp(left, playerRect.left + inset, playerRect.right - inset - width);
    right = left + width;
    bottom = clamp(
      bottom,
      playerRect.top + Math.min(96, playerRect.height * 0.24),
      playerRect.bottom - Math.min(28, Math.max(12, playerRect.height * 0.025)),
    );
  }

  return {
    left,
    bottom,
    width: right - left,
    isNative: true,
  } satisfies CaptionRect;
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaults);
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [captionRect, setCaptionRect] = useState<CaptionRect | null>(null);
  const [routeKey, setRouteKey] = useState(getVideoRouteKey);
  const [isPlayerMenuOpen, setIsPlayerMenuOpen] = useState(false);
  const [playerMenuAnchor, setPlayerMenuAnchor] =
    useState<PlayerMenuAnchor | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  const lastKnownCaptionRectRef = useRef<CaptionRect | null>(null);
  const cuesRef = useRef<CaptionCue[]>([]);
  const currentVideoIdRef = useRef<string | null>(null);
  const sourceLanguageHintRef = useRef('en');
  const translationByTextRef = useRef(new Map<string, string>());
  const contextTranslationByIndexRef = useRef(new Map<number, string>());
  const inFlightTranslationTextsRef = useRef(new Set<string>());

  const statusLabel =
    status === 'translating'
      ? '번역 중'
      : status === 'observing'
        ? '실시간 감지 중'
        : status === 'error'
          ? '오류'
          : status === 'ready'
            ? settings.targetLanguage
            : '대기 중';

  const openPlayerMenu = () => {
    const button = document.getElementById(PLAYER_BUTTON_ID);
    const rect = button?.getBoundingClientRect();

    if (rect) {
      setPlayerMenuAnchor(getPlayerMenuAnchor(rect));
    } else {
      setPlayerMenuAnchor(null);
    }

    setExportStatus('');
    setIsPlayerMenuOpen((open) => !open);
  };

  const setTranslationEnabled = async (enabled: boolean) => {
    const next = await saveSettings({ enabled });
    setSettings(next);
    if (next.enabled) {
      setErrorMessage('');
      setStatus('observing');
      return;
    }

    setTranslatedText('');
    setSourceText('');
    setStatus('idle');
  };

  const translateForExport = async (text: string) => {
    const cached = translationByTextRef.current.get(text);
    if (cached && cached.trim()) {
      return cached;
    }

    const response = (await browser.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.translateSubtitle,
      payload: {
        force: true,
        text,
        pageUrl: location.href,
        sourceLanguageHint: sourceLanguageHintRef.current,
      },
    })) as TranslateSubtitleResponse;

    if (!response.ok) {
      throw new Error(response.error.message);
    }

    if (response.data.translation.trim()) {
      translationByTextRef.current.set(text, response.data.translation);
    }
    return response.data.translation;
  };

  const openSubtitleExportPreview = async (mode: SubtitleExportMode) => {
    const cues = cuesRef.current
      .map((cue, index) => ({
        ...cue,
        index,
        text: cue.text.trim(),
      }))
      .filter((cue) => cue.text.length > 0 && cue.end > cue.start);

    if (cues.length === 0) {
      setExportStatus('아직 내보낼 자막을 읽지 못했어요. 자막이 뜬 뒤 다시 눌러주세요.');
      return;
    }

    setIsExporting(true);
    setExportStatus(`번역 준비 중 0/${cues.length}`);

    try {
      const uniqueTexts = Array.from(new Set(cues.map((cue) => cue.text)));
      const contextualTranslationsByCueIndex = new Map<number, string>();
      for (const cue of cues) {
        const contextualTranslation = contextTranslationByIndexRef.current.get(
          cue.index,
        );
        if (contextualTranslation && contextualTranslation.trim()) {
          contextualTranslationsByCueIndex.set(cue.index, contextualTranslation);
        }
      }
      const translations = new Map<string, string>();
      for (const text of uniqueTexts) {
        const cached = translationByTextRef.current.get(text);
        if (cached && cached.trim()) {
          translations.set(text, cached);
        }
      }
      const textsNeedingFallbackTranslation = new Set(
        cues
          .filter((cue) => !contextualTranslationsByCueIndex.has(cue.index))
          .map((cue) => cue.text),
      );
      const pendingTexts = uniqueTexts.filter(
        (text) =>
          textsNeedingFallbackTranslation.has(text) && !translations.has(text),
      );
      let nextIndex = 0;
      let completed = translations.size;

      if (pendingTexts.length === 0) {
        setExportStatus(`저장된 번역 사용 중 ${completed}/${uniqueTexts.length}`);
      }

      const worker = async () => {
        while (nextIndex < pendingTexts.length) {
          const text = pendingTexts[nextIndex];
          nextIndex += 1;
          if (!text) continue;

          translations.set(text, await translateForExport(text));
          completed += 1;
          setExportStatus(`번역 준비 중 ${completed}/${uniqueTexts.length}`);
        }
      };

      const workerCount = Math.min(PREFETCH_CONCURRENCY, pendingTexts.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const payload: SubtitleExportPayload = {
        id,
        createdAt: new Date().toISOString(),
        pageUrl: location.href,
        title: getVideoTitle(),
        videoId: currentVideoIdRef.current ?? getVideoIdFromRouteKey(routeKey),
        targetLanguage: settings.targetLanguage,
        sourceLanguageHint: sourceLanguageHintRef.current,
        cues: cues.map((cue) => ({
          start: cue.start,
          end: cue.end,
          source: cue.text,
          translation:
            contextualTranslationsByCueIndex.get(cue.index) ??
            translations.get(cue.text) ??
            cue.text,
        })),
        recommendedMode: mode,
      };

      await saveSubtitleExportPayload(id, payload);

      const openResponse = (await browser.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.openSubtitlePreview,
        payload: {
          id,
          mode,
        },
      })) as OpenSubtitlePreviewResponse;

      if (!openResponse.ok) {
        throw new Error(openResponse.error.message);
      }

      setExportStatus('확인 페이지를 열었어요.');
      setIsPlayerMenuOpen(false);
    } catch (error) {
      setExportStatus(`내보내기 실패: ${getErrorMessage(error)}`);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    loadSettings().then((next) => {
      if (mounted) {
        setSettings(next);
      }
    });

    const handleStorageChange = (changes: StorageChangeMap, areaName: string) => {
      if (areaName !== 'sync') {
        return;
      }

      setSettings((current) => {
        const nextSettings = { ...current };
        let hasRelevantChange = false;

        for (const [key, change] of Object.entries(changes)) {
          if (!(key in nextSettings)) {
            continue;
          }

          hasRelevantChange = true;
          (nextSettings as Record<string, unknown>)[key] = change.newValue;
        }

        return hasRelevantChange ? { ...defaults, ...nextSettings } : current;
      });
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      mounted = false;
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let routeTimer: number | null = null;

    const commitRoute = () => {
      if (!disposed) {
        setRouteKey(getVideoRouteKey());
      }
    };

    const scheduleRouteUpdate = () => {
      commitRoute();

      if (routeTimer !== null) {
        window.clearTimeout(routeTimer);
      }

      routeTimer = window.setTimeout(() => {
        routeTimer = null;
        commitRoute();
      }, 250);
    };

    scheduleRouteUpdate();

    document.addEventListener('yt-navigate-start', scheduleRouteUpdate);
    document.addEventListener('yt-navigate-finish', scheduleRouteUpdate);
    document.addEventListener('yt-page-data-updated', scheduleRouteUpdate);
    window.addEventListener('popstate', scheduleRouteUpdate);

    return () => {
      disposed = true;
      if (routeTimer !== null) {
        window.clearTimeout(routeTimer);
      }
      document.removeEventListener('yt-navigate-start', scheduleRouteUpdate);
      document.removeEventListener('yt-navigate-finish', scheduleRouteUpdate);
      document.removeEventListener('yt-page-data-updated', scheduleRouteUpdate);
      window.removeEventListener('popstate', scheduleRouteUpdate);
    };
  }, []);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let disposed = false;

    const mountButton = () => {
      if (disposed) {
        return;
      }

      if (!isVideoPage()) {
        removePlayerButton();
        return;
      }

      upsertPlayerButton(
        settings.enabled,
        Boolean(errorMessage),
        errorMessage || '로컬 자막 번역 오류',
        openPlayerMenu,
        () => {
          void browser.runtime.openOptionsPage();
        },
      );
    };

    mountButton();

    if (document.body) {
      observer = new MutationObserver(() => {
        mountButton();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    const handleNavigation = () => {
      window.setTimeout(mountButton, 120);
    };

    document.addEventListener('yt-navigate-finish', handleNavigation);
    document.addEventListener('yt-page-data-updated', handleNavigation);

    return () => {
      disposed = true;
      observer?.disconnect();
      removePlayerButton();
      document.removeEventListener('yt-navigate-finish', handleNavigation);
      document.removeEventListener('yt-page-data-updated', handleNavigation);
    };
  }, [errorMessage, routeKey, settings.enabled]);

  useEffect(() => {
    ensureNativeCaptionReplacementStyles();

    const container = findCaptionContainer();
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const shouldHideNative =
      settings.enabled &&
      Boolean(captionRect?.isNative) &&
      Boolean(translatedText) &&
      !errorMessage;
    container.classList.toggle('Open_Translator-hide-native', shouldHideNative);

    return () => {
      container.classList.remove('Open_Translator-hide-native');
    };
  }, [captionRect, errorMessage, settings.enabled, translatedText]);

  useEffect(() => {
    if (!routeKey) {
      setSourceText('');
      setTranslatedText('');
      setErrorMessage('');
      setStatus('idle');
      setCaptionRect(null);
      lastKnownCaptionRectRef.current = null;
      return;
    }

    setSourceText('');
    setTranslatedText('');
    setErrorMessage('');
    setStatus(settings.enabled ? 'observing' : 'idle');

    let active = true;
    let cues: CaptionCue[] = [];
    let activeCueIndex = -1;
    let currentVideoId: string | null = null;
    let currentSourceLanguageHint = 'en';
    let fetchAbort: AbortController | null = null;
    let rafId: number | null = null;
    let rectPollTimer: number | null = null;
    let cueApplyTimer: number | null = null;
    let pendingCueIndex: number | null = null;
    let cueGeneration = 0;
    let contextInvalidated = false;
    const expectedVideoId = getVideoIdFromRouteKey(routeKey);
    const translationByText = translationByTextRef.current;
    const contextTranslationByIndex = contextTranslationByIndexRef.current;
    const prefetchEnqueued = new Set<string>();
    const prefetchQueue: string[] = [];
    const contextChunksQueued = new Set<number>();
    const contextChunksInFlight = new Set<number>();
    const contextChunkQueue: number[] = [];
    let prefetchInFlight = 0;
    let contextChunksInFlightCount = 0;

    translationByText.clear();
    contextTranslationByIndex.clear();
    cuesRef.current = [];
    currentVideoIdRef.current = expectedVideoId;
    sourceLanguageHintRef.current = 'en';

    const findVideoElement = () =>
      document.querySelector('video.html5-main-video') as HTMLVideoElement | null;

    const updateCaptionRect = () => {
      const nextRect = getCaptionRect();
      if (nextRect) {
        lastKnownCaptionRectRef.current = nextRect;
        setCaptionRect(nextRect);
        return;
      }
      setCaptionRect(lastKnownCaptionRectRef.current);
    };

    const clearPendingCue = () => {
      if (cueApplyTimer !== null) {
        window.clearTimeout(cueApplyTimer);
        cueApplyTimer = null;
      }
      pendingCueIndex = null;
    };

    const resetCueState = () => {
      cueGeneration += 1;
      clearPendingCue();
      cues = [];
      cuesRef.current = [];
      activeCueIndex = -1;
      prefetchQueue.length = 0;
      prefetchEnqueued.clear();
      inFlightTranslationTextsRef.current.clear();
      translationByText.clear();
      contextTranslationByIndex.clear();
      contextChunksQueued.clear();
      contextChunksInFlight.clear();
      contextChunkQueue.length = 0;
      contextChunksInFlightCount = 0;
      setSourceText('');
      setTranslatedText('');
    };

    const stopAfterExtensionContextInvalidated = () => {
      contextInvalidated = true;
      active = false;
      resetCueState();
      setErrorMessage('');
      setStatus('idle');
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (rectPollTimer !== null) {
        window.clearInterval(rectPollTimer);
        rectPollTimer = null;
      }
      fetchAbort?.abort();
      console.warn(
        '[LST] extension context invalidated; reload the YouTube tab after reloading the extension.',
      );
    };

    const getCueTranslation = (index: number, cue: CaptionCue) => {
      const contextTranslation = contextTranslationByIndex.get(index);
      if (contextTranslation && contextTranslation.trim()) {
        return contextTranslation;
      }

      const cached = translationByText.get(cue.text);
      return cached && cached.trim() ? cached : '';
    };

    const translateContextChunk = async (
      chunkStart: number,
      generation = cueGeneration,
    ) => {
      if (!settings.enabled || contextInvalidated) return;
      if (generation !== cueGeneration) return;

      const chunk = cues
        .slice(chunkStart, chunkStart + CONTEXT_TRANSLATION_CHUNK_SIZE)
        .map((cue, offset) => ({
          index: chunkStart + offset,
          start: cue.start,
          end: cue.end,
          source: cue.text,
        }))
        .filter((cue) => cue.source.trim().length > 0);

      if (chunk.length === 0) return;

      try {
        const response = (await browser.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.translateSubtitleCues,
          payload: {
            cues: chunk,
            pageUrl: location.href,
            sourceLanguageHint: currentSourceLanguageHint,
            targetLanguage: settings.targetLanguage,
            title: getVideoTitle(),
          },
        })) as TranslateSubtitleCuesResponse;

        if (!active || generation !== cueGeneration) return;

        if (!response.ok) {
          console.warn(
            `[LST] contextual subtitle translation failed: ${getBackgroundErrorMessage(response.error)}`,
            response.error,
          );
          return;
        }

        for (const translatedCue of response.data.cues) {
          if (!translatedCue.translation.trim()) continue;
          contextTranslationByIndex.set(
            translatedCue.index,
            translatedCue.translation,
          );
        }

        const currentCue = cues[activeCueIndex];
        if (currentCue) {
          const currentTranslation = getCueTranslation(activeCueIndex, currentCue);
          if (currentTranslation) {
            setTranslatedText(currentTranslation);
            setStatus('ready');
            setErrorMessage('');
          }
        }
      } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
          stopAfterExtensionContextInvalidated();
          return;
        }
        console.warn('[LST] contextual subtitle translation error', error);
      }
    };

    const drainContextTranslationQueue = () => {
      while (
        active &&
        settings.enabled &&
        !contextInvalidated &&
        contextChunksInFlightCount < CONTEXT_TRANSLATION_CONCURRENCY &&
        contextChunkQueue.length > 0
      ) {
        const chunkStart = contextChunkQueue.shift();
        if (typeof chunkStart !== 'number') break;
        if (contextChunksInFlight.has(chunkStart)) continue;

        contextChunksInFlight.add(chunkStart);
        contextChunksInFlightCount += 1;
        void translateContextChunk(chunkStart).finally(() => {
          contextChunksInFlight.delete(chunkStart);
          contextChunksInFlightCount = Math.max(0, contextChunksInFlightCount - 1);
          drainContextTranslationQueue();
        });
      }
    };

    const enqueueContextChunk = (chunkStart: number, priority = false) => {
      if (!settings.enabled || cues.length === 0) return;
      const normalizedStart =
        Math.floor(chunkStart / CONTEXT_TRANSLATION_CHUNK_SIZE) *
        CONTEXT_TRANSLATION_CHUNK_SIZE;

      if (normalizedStart < 0 || normalizedStart >= cues.length) return;

      if (contextChunksQueued.has(normalizedStart)) {
        if (priority && !contextChunksInFlight.has(normalizedStart)) {
          const queuedIndex = contextChunkQueue.indexOf(normalizedStart);
          if (queuedIndex > 0) {
            contextChunkQueue.splice(queuedIndex, 1);
            contextChunkQueue.unshift(normalizedStart);
          }
        }
        drainContextTranslationQueue();
        return;
      }

      contextChunksQueued.add(normalizedStart);
      if (priority) {
        contextChunkQueue.unshift(normalizedStart);
      } else {
        contextChunkQueue.push(normalizedStart);
      }
      drainContextTranslationQueue();
    };

    const enqueueAllContextChunks = () => {
      for (
        let chunkStart = 0;
        chunkStart < cues.length;
        chunkStart += CONTEXT_TRANSLATION_CHUNK_SIZE
      ) {
        enqueueContextChunk(chunkStart);
      }
    };

    const drainPrefetchQueue = () => {
      while (
        active &&
        !contextInvalidated &&
        prefetchInFlight < PREFETCH_CONCURRENCY &&
        prefetchQueue.length > 0
      ) {
        const text = prefetchQueue.shift();
        if (!text) break;
        const cached = translationByText.get(text);
        if (cached && cached.trim()) {
          prefetchEnqueued.delete(text);
          continue;
        }
        if (inFlightTranslationTextsRef.current.has(text)) {
          prefetchEnqueued.delete(text);
          continue;
        }
        prefetchInFlight += 1;
        void translateText(text).finally(() => {
          prefetchInFlight = Math.max(0, prefetchInFlight - 1);
          prefetchEnqueued.delete(text);
          drainPrefetchQueue();
        });
      }
    };

    const enqueuePrefetch = (text: string) => {
      if (contextInvalidated) return;
      if (!text) return;
      const cached = translationByText.get(text);
      if (cached && cached.trim()) return;
      if (inFlightTranslationTextsRef.current.has(text)) return;
      if (prefetchEnqueued.has(text)) return;
      prefetchEnqueued.add(text);
      prefetchQueue.push(text);
      drainPrefetchQueue();
    };

    const translateText = async (text: string, generation = cueGeneration) => {
      if (contextInvalidated) return;
      if (generation !== cueGeneration) return;
      const cached = translationByText.get(text);
      if (cached && cached.trim()) return;
      if (inFlightTranslationTextsRef.current.has(text)) return;
      inFlightTranslationTextsRef.current.add(text);

      try {
        const response = (await browser.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.translateSubtitle,
          payload: {
            text,
            pageUrl: location.href,
            sourceLanguageHint: currentSourceLanguageHint,
          },
        })) as TranslateSubtitleResponse;

        if (!active || generation !== cueGeneration) return;

        if (response.ok) {
          if (response.data.translation.trim()) {
            translationByText.set(text, response.data.translation);
          }
          const currentCue = cues[activeCueIndex];
          if (currentCue && currentCue.text === text) {
            setTranslatedText(response.data.translation);
            setStatus('ready');
            setErrorMessage('');
          }
          return;
        }

        translationByText.delete(text);
        const currentCue = cues[activeCueIndex];
        if (currentCue && currentCue.text === text) {
          setStatus('error');
          setErrorMessage(response.error.message);
        }
      } catch (error) {
        translationByText.delete(text);
        if (isExtensionContextInvalidatedError(error)) {
          stopAfterExtensionContextInvalidated();
          return;
        }
        if (!active || generation !== cueGeneration) return;
        const currentCue = cues[activeCueIndex];
        if (currentCue && currentCue.text === text) {
          setStatus('error');
          setErrorMessage(
            error instanceof Error
              ? error.message
              : '로컬 프록시에 연결할 수 없습니다.',
          );
        }
      } finally {
        inFlightTranslationTextsRef.current.delete(text);
      }
    };

    const commitActiveCue = (nextIndex: number) => {
      if (nextIndex === activeCueIndex) return;
      activeCueIndex = nextIndex;

      if (nextIndex < 0) {
        setSourceText('');
        setTranslatedText('');
        setStatus('observing');
        return;
      }

      const cue = cues[nextIndex];
      if (!cue) return;

      setSourceText(cue.text);
      setErrorMessage('');

      enqueueContextChunk(nextIndex, true);
      enqueueContextChunk(nextIndex + CONTEXT_TRANSLATION_CHUNK_SIZE);

      const readyTranslation = getCueTranslation(nextIndex, cue);
      if (readyTranslation) {
        setTranslatedText(readyTranslation);
        setStatus('ready');
      } else {
        setTranslatedText('');
        setStatus('translating');
        void translateText(cue.text, cueGeneration);
      }

      for (let offset = 1; offset <= CUE_PREFETCH_COUNT; offset += 1) {
        const upcoming = cues[nextIndex + offset];
        if (!upcoming) break;
        enqueuePrefetch(upcoming.text);
      }
    };

    const scheduleActiveCue = (nextIndex: number) => {
      if (nextIndex === activeCueIndex) {
        clearPendingCue();
        return;
      }

      if (nextIndex >= 0 || settings.debounceMs <= 0) {
        clearPendingCue();
        commitActiveCue(nextIndex);
        return;
      }

      if (pendingCueIndex === nextIndex) {
        return;
      }

      pendingCueIndex = nextIndex;

      if (cueApplyTimer !== null) {
        window.clearTimeout(cueApplyTimer);
      }

      cueApplyTimer = window.setTimeout(() => {
        const indexToApply = pendingCueIndex;
        cueApplyTimer = null;
        pendingCueIndex = null;

        if (!active || typeof indexToApply !== 'number') {
          return;
        }

        commitActiveCue(indexToApply);
      }, settings.debounceMs);
    };

    const renderLoop = () => {
      if (!active) return;
      const video = findVideoElement();
      if (settings.enabled && video && cues.length > 0) {
        const nextIndex = findActiveCueIndex(
          cues,
          video.currentTime,
          activeCueIndex,
        );
        scheduleActiveCue(nextIndex);
      }
      rafId = requestAnimationFrame(renderLoop);
    };

    const loadTracksFromMessage = async (
      tracks: Array<{
        baseUrl: string;
        languageCode: string;
        kind?: string;
        name?: string;
      }>,
      videoId: string | null,
      isLive: boolean,
    ) => {
      if (contextInvalidated) return;

      if (expectedVideoId && videoId && videoId !== expectedVideoId) {
        console.log(
          '[LST] ignoring stale caption tracks videoId=' +
            videoId +
            ' expected=' +
            expectedVideoId,
        );
        return;
      }

      const scopedTracks = expectedVideoId
        ? tracks.filter((track) =>
            captionTrackMatchesVideoId(track.baseUrl, expectedVideoId),
          )
        : tracks;
      const effectiveVideoId = videoId ?? expectedVideoId;

      if (expectedVideoId && tracks.length > 0 && scopedTracks.length === 0) {
        console.log(
          '[LST] ignoring caption tracks without current video id expected=' +
            expectedVideoId,
        );
        return;
      }

      if (fetchAbort) fetchAbort.abort();

      if (effectiveVideoId !== currentVideoId) {
        resetCueState();
        currentVideoId = effectiveVideoId;
        currentVideoIdRef.current = effectiveVideoId;
      }

      if (isLive || scopedTracks.length === 0) {
        resetCueState();
        setStatus(
          scopedTracks.length === 0 || !settings.enabled ? 'idle' : 'observing',
        );
        return;
      }

      const track = pickCaptionTrack(scopedTracks, 'en');
      if (!track) {
        resetCueState();
        setStatus('idle');
        return;
      }

      currentSourceLanguageHint = track.languageCode || 'en';
      sourceLanguageHintRef.current = currentSourceLanguageHint;
      const isAutoGeneratedTrack = track.kind === 'asr';
      const localAbort = new AbortController();
      fetchAbort = localAbort;
      const loadGeneration = cueGeneration;
      setStatus(settings.enabled ? 'observing' : 'idle');

      try {
        const nextCues = await fetchCaptionCues(
          track.baseUrl,
          effectiveVideoId,
          track.languageCode || 'en',
          localAbort.signal,
          {
            autoGenerated: isAutoGeneratedTrack,
            maxCharactersPerCue: settings.maxCharactersPerRequest,
          },
        );
        if (
          !active ||
          localAbort.signal.aborted ||
          loadGeneration !== cueGeneration
        ) {
          return;
        }
        cues = nextCues;
        cuesRef.current = nextCues;
        activeCueIndex = -1;
        setErrorMessage('');

        // Warm the cache with the first few cues so the viewer doesn't hit
        // translation latency at video start.
        if (settings.enabled) {
          enqueueAllContextChunks();
          const initialCount = Math.min(CUE_INITIAL_PREFETCH, cues.length);
          for (let i = 0; i < initialCount; i += 1) {
            const cue = cues[i];
            if (cue) enqueuePrefetch(cue.text);
          }
        }
      } catch (error) {
        if (!active || localAbort.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        cues = [];
        cuesRef.current = [];
        activeCueIndex = -1;
        setStatus('error');
        setErrorMessage(
          error instanceof Error
            ? `자막 트랙을 불러올 수 없습니다: ${error.message}`
            : '자막 트랙을 불러올 수 없습니다.',
        );
      }
    };

    const unsubscribe = subscribeToCaptionTracks((msg) => {
      void loadTracksFromMessage(msg.tracks, msg.videoId, msg.isLive);
    });

    requestTracksFromPage();

    updateCaptionRect();
    rectPollTimer = window.setInterval(updateCaptionRect, CAPTION_RECT_POLL_MS);
    rafId = requestAnimationFrame(renderLoop);

    const handleNavigation = () => {
      resetCueState();
      currentVideoId = null;
      window.setTimeout(() => {
        if (active) requestTracksFromPage();
      }, 180);
    };

    const handleViewportMove = () => {
      if (active) updateCaptionRect();
    };

    const handleFullscreenChange = () => {
      if (!active) return;
      lastKnownCaptionRectRef.current = null;
      setCaptionRect(null);
      updateCaptionRect();
    };

    document.addEventListener('yt-navigate-finish', handleNavigation);
    document.addEventListener('yt-page-data-updated', handleNavigation);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('resize', handleViewportMove);
    window.addEventListener('scroll', handleViewportMove, true);

    return () => {
      active = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (rectPollTimer !== null) window.clearInterval(rectPollTimer);
      clearPendingCue();
      fetchAbort?.abort();
      unsubscribe();
      document.removeEventListener('yt-navigate-finish', handleNavigation);
      document.removeEventListener('yt-page-data-updated', handleNavigation);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('resize', handleViewportMove);
      window.removeEventListener('scroll', handleViewportMove, true);
    };
  }, [
    settings.enabled,
    settings.debounceMs,
    settings.maxCharactersPerRequest,
    settings.model,
    settings.promptTemplate,
    routeKey,
    settings.targetLanguage,
  ]);

  if (!routeKey) {
    return null;
  }

  const shouldRenderOverlay =
    settings.enabled && Boolean(errorMessage || translatedText);

  const overlayStyle = captionRect
    ? {
        left: `${captionRect.left}px`,
        bottom: `${Math.max(0, window.innerHeight - captionRect.bottom)}px`,
        width: `${captionRect.width}px`,
        transform: 'none',
      }
    : undefined;
  const playerMenuStyle = playerMenuAnchor
    ? {
        bottom: `${playerMenuAnchor.bottom}px`,
        right: `${playerMenuAnchor.right}px`,
      }
    : undefined;

  return (
    <>
      {isPlayerMenuOpen ? (
        <div className="player-menu" style={playerMenuStyle}>
          <div className="player-menu-head">
            <strong>AI 자막</strong>
            <button
              aria-label="메뉴 닫기"
              className="player-menu-close"
              onClick={() => setIsPlayerMenuOpen(false)}
              type="button">
              닫기
            </button>
          </div>

          <label className="player-menu-toggle">
            <input
              checked={settings.enabled}
              disabled={isExporting}
              onChange={(event) => {
                void setTranslationEnabled(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            <span>번역 표시</span>
          </label>

          <div className="player-menu-actions">
            <button
              disabled={isExporting}
              onClick={() => void openSubtitleExportPreview('translated')}
              type="button">
              자막 다운로드 (번역)
            </button>
            <button
              disabled={isExporting}
              onClick={() => void openSubtitleExportPreview('bilingual')}
              type="button">
              자막 다운로드 (원문+번역)
            </button>
          </div>

          {exportStatus ? (
            <p className="player-menu-status">{exportStatus}</p>
          ) : (
            <p className="player-menu-status">
              다운로드 전에 확인 페이지에서 SRT 내용을 볼 수 있어요.
            </p>
          )}
        </div>
      ) : null}

      {shouldRenderOverlay ? (
        <div
      className={`overlay-shell ${captionRect ? 'overlay-shell--native' : `overlay-shell--${settings.overlayPosition}`}`}
      style={overlayStyle}>
      <section className="translation-card" aria-live="polite">
        {errorMessage ? (
          <header className="translation-meta">
            <span className={`status-pill status-pill--${status}`}>{statusLabel}</span>
          </header>
        ) : null}

        <div className="subtitle-stack subtitle-stack--native">
          {translatedText ? (
            <p className="subtitle-line subtitle-line--translated">{translatedText}</p>
          ) : (
            <p className="subtitle-line subtitle-line--translated subtitle-line--muted">
              {errorMessage || '자막을 기다리는 중...'}
            </p>
          )}

          {settings.showSourceCaption && sourceText ? (
            <p className="subtitle-line subtitle-line--source">{sourceText}</p>
          ) : null}
        </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export default App;
