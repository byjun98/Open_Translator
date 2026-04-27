import {
  isCaptionTracksMessage,
  type CaptionTracksMessage,
} from './captions.ts';

const SOURCE = 'Open_Translator';
const MSG_BODY = '__LST_TIMEDTEXT_BODY__';
const MSG_ERROR = '__LST_TIMEDTEXT_ERROR__';
const REQUEST_TIMEDTEXT_EVENT = '__lst_request_timedtext__';

interface TimedtextBodyMessage {
  source: typeof SOURCE;
  type: typeof MSG_BODY;
  url: string;
  body: string;
  requestId?: string;
}

interface TimedtextErrorMessage {
  source: typeof SOURCE;
  type: typeof MSG_ERROR;
  url: string;
  requestId: string;
  message: string;
}

function isTimedtextBodyMessage(value: unknown): value is TimedtextBodyMessage {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.source === SOURCE &&
    r.type === MSG_BODY &&
    typeof r.url === 'string' &&
    typeof r.body === 'string'
  );
}

function isTimedtextErrorMessage(value: unknown): value is TimedtextErrorMessage {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.source === SOURCE &&
    r.type === MSG_ERROR &&
    typeof r.url === 'string' &&
    typeof r.requestId === 'string' &&
    typeof r.message === 'string'
  );
}

const interceptedBodies: Array<{ url: string; body: string; at: number }> = [];
const MAX_CACHED = 32;
const bodyListeners = new Set<(message: TimedtextBodyMessage) => void>();
const errorListeners = new Set<(message: TimedtextErrorMessage) => void>();

let bridgeInstalled = false;
function ensureBridgeInstalled() {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isTimedtextBodyMessage(event.data)) return;
    console.log(
      '[LST] bridge received body',
      'len=' + event.data.body.length,
      event.data.url.slice(0, 160),
    );
    interceptedBodies.push({
      url: event.data.url,
      body: event.data.body,
      at: Date.now(),
    });
    if (interceptedBodies.length > MAX_CACHED) {
      interceptedBodies.splice(0, interceptedBodies.length - MAX_CACHED);
    }
    for (const listener of bodyListeners) {
      try {
        listener(event.data);
      } catch {
        // ignore
      }
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isTimedtextErrorMessage(event.data)) return;
    for (const listener of errorListeners) {
      try {
        listener(event.data);
      } catch {
        // ignore
      }
    }
  });
}

ensureBridgeInstalled();

export function requestTracksFromPage() {
  window.dispatchEvent(new Event('__lst_request_tracks__'));
}

export function subscribeToCaptionTracks(
  handler: (message: CaptionTracksMessage) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!isCaptionTracksMessage(event.data)) return;
    handler(event.data);
  };

  window.addEventListener('message', listener);
  return () => {
    window.removeEventListener('message', listener);
  };
}

export function waitForInterceptedBody(
  match: (url: string) => boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  ensureBridgeInstalled();

  for (let i = interceptedBodies.length - 1; i >= 0; i -= 1) {
    const entry = interceptedBodies[i];
    if (entry && match(entry.url)) {
      return Promise.resolve(entry.body);
    }
  }

  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`intercept timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };

    const listener = (message: TimedtextBodyMessage) => {
      if (!match(message.url)) return;
      cleanup();
      resolve(message.body);
    };

    function cleanup() {
      window.clearTimeout(timer);
      bodyListeners.delete(listener);
      signal?.removeEventListener('abort', onAbort);
    }

    bodyListeners.add(listener);
    signal?.addEventListener('abort', onAbort);
  });
}

export function requestTimedtextBodyFromPage(
  baseUrl: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  ensureBridgeInstalled();

  const requestId = Math.random().toString(36).slice(2);

  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`page timedtext timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };

    const onBody = (message: TimedtextBodyMessage) => {
      if (message.requestId !== requestId) return;
      cleanup();
      resolve(message.body);
    };

    const onError = (message: TimedtextErrorMessage) => {
      if (message.requestId !== requestId) return;
      cleanup();
      reject(new Error(message.message));
    };

    function cleanup() {
      window.clearTimeout(timer);
      bodyListeners.delete(onBody);
      errorListeners.delete(onError);
      signal?.removeEventListener('abort', onAbort);
    }

    bodyListeners.add(onBody);
    errorListeners.add(onError);
    signal?.addEventListener('abort', onAbort);

    window.dispatchEvent(
      new CustomEvent(REQUEST_TIMEDTEXT_EVENT, {
        detail: {
          baseUrl,
          requestId,
        },
      }),
    );
  });
}
