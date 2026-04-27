// Runs in MAIN world, injected synchronously via <script> tag from the
// ISOLATED content script at document_start. WXT wraps defineContentScript
// entrypoints in an async IIFE, which delays execution past YouTube's own
// fetch capture (WXT #357). defineUnlistedScript emits a plain synchronous
// script file that can be injected before any page script runs.

interface YtCaptionTrackName {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

interface YtCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: YtCaptionTrackName;
}

interface YtPlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YtCaptionTrack[];
    };
  };
  videoDetails?: {
    videoId?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
  };
}

declare global {
  interface Window {
    ytInitialPlayerResponse?: YtPlayerResponse;
    __lstHookInstalled?: boolean;
  }
}

export default defineUnlistedScript(() => {
  if (window.__lstHookInstalled) return;
  window.__lstHookInstalled = true;

  const SOURCE = 'local-subtitle-translator';
  const MSG_TRACKS = '__LST_CAPTION_TRACKS__';
  const MSG_BODY = '__LST_TIMEDTEXT_BODY__';

  function getUrlString(input: unknown): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (
      input &&
      typeof input === 'object' &&
      'url' in input &&
      typeof (input as { url: unknown }).url === 'string'
    ) {
      return (input as { url: string }).url;
    }
    try {
      return String(input);
    } catch {
      return '';
    }
  }

  function isTimedtextUrl(url: string): boolean {
    return (
      url.includes('/api/timedtext') ||
      url.includes('/timedtext?') ||
      url.includes('/youtubei/v1/get_transcript')
    );
  }

  function postBody(url: string, body: string) {
    try {
      window.postMessage(
        { source: SOURCE, type: MSG_BODY, url, body },
        window.location.origin,
      );
    } catch {
      // ignore
    }
  }

  // --- fetch hook ---
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await originalFetch(input, init);
    try {
      const url = getUrlString(input);
      if (url && isTimedtextUrl(url)) {
        response
          .clone()
          .text()
          .then((body) => {
            console.log(
              '[LST] fetch captured',
              response.status,
              'len=' + body.length,
              url.slice(0, 140),
            );
            if (response.ok) postBody(url, body);
          })
          .catch(() => undefined);
      }
    } catch {
      // ignore to not break YouTube
    }
    return response;
  };

  // --- XHR hook ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    try {
      const recorded = typeof url === 'string' ? url : (url as URL).href;
      (this as unknown as { __lstUrl?: string }).__lstUrl = recorded;
    } catch {
      // ignore
    }
    return (origOpen as unknown as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest,
    );
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: unknown[]
  ) {
    const tracked = (this as unknown as { __lstUrl?: string }).__lstUrl;
    if (tracked && isTimedtextUrl(tracked)) {
      this.addEventListener('load', () => {
        try {
          const body = this.responseText ?? '';
          console.log(
            '[LST] xhr captured',
            this.status,
            'len=' + body.length,
            tracked.slice(0, 140),
          );
          if (this.status >= 200 && this.status < 300) {
            postBody(tracked, body);
          }
        } catch {
          // ignore
        }
      });
    }
    return (origSend as unknown as (...args: unknown[]) => void).apply(
      this,
      args,
    );
  } as typeof XMLHttpRequest.prototype.send;

  console.log('[LST] page-world hooks installed at', performance.now());

  // --- caption tracks extraction from ytInitialPlayerResponse ---
  function extractTracks() {
    try {
      const resp = window.ytInitialPlayerResponse;
      if (!resp) {
        return { tracks: [], videoId: null, isLive: false };
      }
      const trackList =
        resp.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const videoId = resp.videoDetails?.videoId ?? null;
      const isLive = Boolean(
        resp.videoDetails?.isLive || resp.videoDetails?.isLiveContent,
      );

      const tracks = trackList
        .filter(
          (t): t is YtCaptionTrack => Boolean(t && typeof t.baseUrl === 'string'),
        )
        .map((t) => {
          let name: string | undefined;
          if (t.name) {
            if (typeof t.name.simpleText === 'string') {
              name = t.name.simpleText;
            } else if (Array.isArray(t.name.runs) && t.name.runs[0]) {
              name = t.name.runs[0].text;
            }
          }
          return {
            baseUrl: t.baseUrl as string,
            languageCode: t.languageCode ?? '',
            kind: t.kind,
            name,
          };
        });

      return { tracks, videoId, isLive };
    } catch (error) {
      return {
        tracks: [],
        videoId: null,
        isLive: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function postTracks() {
    const payload = extractTracks();
    window.postMessage(
      Object.assign({ source: SOURCE, type: MSG_TRACKS }, payload),
      window.location.origin,
    );
  }

  // Poll early then on navigation events (YouTube is SPA)
  const initialDelaysMs = [0, 200, 600, 1500, 3000];
  for (const delay of initialDelaysMs) {
    if (delay === 0) {
      postTracks();
    } else {
      window.setTimeout(postTracks, delay);
    }
  }

  document.addEventListener('yt-navigate-finish', () => {
    window.setTimeout(postTracks, 180);
    window.setTimeout(postTracks, 900);
  });
  document.addEventListener('yt-page-data-updated', () => {
    window.setTimeout(postTracks, 180);
  });
  window.addEventListener('__lst_request_tracks__', postTracks);
});
