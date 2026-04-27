import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  BACKGROUND_MESSAGE_TYPES,
  type TranslateSubtitleResponse,
} from '../../lib/messages.ts';
import {
  defaults,
  loadSettings,
  saveSettings,
  type ExtensionSettings,
} from '../../lib/settings.ts';
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

function ensurePlayerButtonStyles() {
  if (document.getElementById(PLAYER_BUTTON_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = PLAYER_BUTTON_STYLE_ID;
  style.textContent = `
    .${PLAYER_BUTTON_ID} {
      width: auto !important;
      min-width: 36px;
      padding: 0 6px !important;
    }

    .${PLAYER_BUTTON_ID}__pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      height: 28px;
      padding: 0 9px;
      border-radius: 10px;
      font-family: Arial, sans-serif;
      font-size: 15px;
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
    return null;
  }

  const rects = windows
    .map((windowNode) => windowNode.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    left,
    bottom,
    width: right - left,
  } satisfies CaptionRect;
}

function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaults);
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [captionRect, setCaptionRect] = useState<CaptionRect | null>(null);

  const lastKnownCaptionRectRef = useRef<CaptionRect | null>(null);

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
    if (!isVideoPage()) {
      return;
    }

    let observer: MutationObserver | null = null;
    let disposed = false;

    const mountButton = () => {
      if (disposed) {
        return;
      }

      upsertPlayerButton(
        settings.enabled,
        Boolean(errorMessage),
        errorMessage || '로컬 자막 번역 오류',
        () => {
          void saveSettings({ enabled: !settings.enabled }).then((next) => {
            setSettings(next);
            if (next.enabled) {
              setErrorMessage('');
              setStatus('observing');
            } else {
              setTranslatedText('');
              setSourceText('');
              setStatus('idle');
            }
          });
        },
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

    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener('yt-navigate-finish', handleNavigation);
    };
  }, [errorMessage, settings.enabled]);

  useEffect(() => {
    ensureNativeCaptionReplacementStyles();

    const container = findCaptionContainer();
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const shouldHideNative =
      settings.enabled &&
      Boolean(captionRect) &&
      Boolean(translatedText) &&
      !errorMessage;
    container.classList.toggle('Open_Translator-hide-native', shouldHideNative);

    return () => {
      container.classList.remove('Open_Translator-hide-native');
    };
  }, [captionRect, errorMessage, settings.enabled, translatedText]);

  useEffect(() => {
    if (!settings.enabled) {
      setSourceText('');
      setTranslatedText('');
      setErrorMessage('');
      setStatus('idle');
      setCaptionRect(null);
      lastKnownCaptionRectRef.current = null;
      return;
    }

    let active = true;
    let cues: CaptionCue[] = [];
    let activeCueIndex = -1;
    let currentVideoId: string | null = null;
    let fetchAbort: AbortController | null = null;
    let rafId: number | null = null;
    let rectPollTimer: number | null = null;
    const translationByText = new Map<string, string>();
    const prefetchEnqueued = new Set<string>();
    const prefetchQueue: string[] = [];
    let prefetchInFlight = 0;

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

    const resetCueState = () => {
      cues = [];
      activeCueIndex = -1;
      prefetchQueue.length = 0;
      prefetchEnqueued.clear();
      setSourceText('');
      setTranslatedText('');
    };

    const drainPrefetchQueue = () => {
      while (
        active &&
        prefetchInFlight < PREFETCH_CONCURRENCY &&
        prefetchQueue.length > 0
      ) {
        const text = prefetchQueue.shift();
        if (!text) break;
        if (translationByText.has(text)) {
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
      if (!text) return;
      if (translationByText.has(text)) return;
      if (prefetchEnqueued.has(text)) return;
      prefetchEnqueued.add(text);
      prefetchQueue.push(text);
      drainPrefetchQueue();
    };

    const translateText = async (text: string) => {
      if (translationByText.has(text)) return;
      translationByText.set(text, '');

      try {
        const response = (await browser.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.translateSubtitle,
          payload: {
            text,
            pageUrl: location.href,
          },
        })) as TranslateSubtitleResponse;

        if (!active) return;

        if (response.ok) {
          translationByText.set(text, response.data.translation);
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
        if (!active) return;
        const currentCue = cues[activeCueIndex];
        if (currentCue && currentCue.text === text) {
          setStatus('error');
          setErrorMessage(
            error instanceof Error
              ? error.message
              : '로컬 프록시에 연결할 수 없습니다.',
          );
        }
      }
    };

    const applyActiveCue = (nextIndex: number) => {
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

      const cached = translationByText.get(cue.text);
      if (cached) {
        setTranslatedText(cached);
        setStatus('ready');
      } else {
        setTranslatedText('');
        setStatus('translating');
        void translateText(cue.text);
      }

      for (let offset = 1; offset <= CUE_PREFETCH_COUNT; offset += 1) {
        const upcoming = cues[nextIndex + offset];
        if (!upcoming) break;
        enqueuePrefetch(upcoming.text);
      }
    };

    const renderLoop = () => {
      if (!active) return;
      const video = findVideoElement();
      if (video && cues.length > 0) {
        const nextIndex = findActiveCueIndex(
          cues,
          video.currentTime,
          activeCueIndex,
        );
        applyActiveCue(nextIndex);
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
      if (fetchAbort) fetchAbort.abort();

      if (videoId !== currentVideoId) {
        translationByText.clear();
        resetCueState();
        currentVideoId = videoId;
      }

      if (isLive || tracks.length === 0) {
        resetCueState();
        setStatus(tracks.length === 0 ? 'idle' : 'observing');
        return;
      }

      const track = pickCaptionTrack(tracks, 'en');
      if (!track) {
        resetCueState();
        setStatus('idle');
        return;
      }

      const localAbort = new AbortController();
      fetchAbort = localAbort;
      setStatus('observing');

      try {
        const nextCues = await fetchCaptionCues(
          track.baseUrl,
          videoId,
          track.languageCode || 'en',
          localAbort.signal,
        );
        if (!active || localAbort.signal.aborted) return;
        cues = nextCues;
        activeCueIndex = -1;
        setErrorMessage('');

        // Warm the cache with the first few cues so the viewer doesn't hit
        // translation latency at video start.
        const initialCount = Math.min(CUE_INITIAL_PREFETCH, cues.length);
        for (let i = 0; i < initialCount; i += 1) {
          const cue = cues[i];
          if (cue) enqueuePrefetch(cue.text);
        }
      } catch (error) {
        if (!active || localAbort.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        cues = [];
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
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('resize', handleViewportMove);
    window.addEventListener('scroll', handleViewportMove, true);

    return () => {
      active = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (rectPollTimer !== null) window.clearInterval(rectPollTimer);
      fetchAbort?.abort();
      unsubscribe();
      document.removeEventListener('yt-navigate-finish', handleNavigation);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('resize', handleViewportMove);
      window.removeEventListener('scroll', handleViewportMove, true);
    };
  }, [
    settings.enabled,
    settings.model,
    settings.promptTemplate,
    settings.targetLanguage,
  ]);

  if (!settings.enabled || !isVideoPage()) {
    return null;
  }

  const shouldRenderOverlay = Boolean(errorMessage || translatedText);

  if (!shouldRenderOverlay) {
    return null;
  }

  const overlayStyle = captionRect
    ? {
        left: `${captionRect.left}px`,
        bottom: `${Math.max(0, window.innerHeight - captionRect.bottom)}px`,
        width: `${captionRect.width}px`,
        transform: 'none',
      }
    : undefined;

  return (
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
  );
}

export default App;
