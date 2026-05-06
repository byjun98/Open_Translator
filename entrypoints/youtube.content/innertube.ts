import {
  getAllowedTimedtextUrl,
  parseJson3,
  parseXmlCaptions,
  type CaptionCue,
} from './captions.ts';

const INNERTUBE_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player';

// ANDROID client has been historically the most pot-lenient client for
// caption/transcript access (yt-dlp + youtube-transcript-api + YouTube.js
// all use this client as of 2026).
const ANDROID_CLIENT_NAME = 'ANDROID';
const ANDROID_CLIENT_VERSION = '20.10.38';
const ANDROID_CLIENT_NAME_ID = '3';

interface InnertubeCaptionTrackName {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

interface InnertubeCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: InnertubeCaptionTrackName;
  vssId?: string;
}

interface InnertubePlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: InnertubeCaptionTrack[];
    };
  };
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
}

function pickBestTrack(
  tracks: InnertubeCaptionTrack[],
  preferredLang: string,
): InnertubeCaptionTrack | undefined {
  const prefix = preferredLang.toLowerCase().slice(0, 2);
  const byLang = (t: InnertubeCaptionTrack) =>
    typeof t.languageCode === 'string' &&
    t.languageCode.toLowerCase().startsWith(prefix);

  return (
    tracks.find((t) => byLang(t) && t.kind !== 'asr') ??
    tracks.find((t) => byLang(t)) ??
    tracks.find((t) => t.kind === 'asr') ??
    tracks[0]
  );
}

function parseCaptionBody(body: string): CaptionCue[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{')) {
    try {
      return parseJson3(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (trimmed.startsWith('<')) {
    return parseXmlCaptions(trimmed);
  }
  return [];
}

export async function fetchCaptionsViaInnertube(
  videoId: string,
  preferredLang: string,
  signal?: AbortSignal,
): Promise<CaptionCue[]> {
  console.log('[LST] innertube: POST /player videoId=' + videoId);
  const res = await fetch(INNERTUBE_PLAYER_URL, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': ANDROID_CLIENT_NAME_ID,
      'X-Youtube-Client-Version': ANDROID_CLIENT_VERSION,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: ANDROID_CLIENT_NAME,
          clientVersion: ANDROID_CLIENT_VERSION,
          androidSdkVersion: 30,
          hl: preferredLang,
          gl: 'US',
        },
      },
      videoId,
      racyCheckOk: true,
      contentCheckOk: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`innertube HTTP ${res.status}`);
  }

  const data = (await res.json()) as InnertubePlayerResponse;

  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason = data?.playabilityStatus?.reason ?? '';
    throw new Error(`innertube unplayable: ${status} ${reason}`.trim());
  }

  const tracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    throw new Error('innertube: no captionTracks');
  }

  const track = pickBestTrack(tracks, preferredLang);
  if (!track?.baseUrl) {
    throw new Error('innertube: selected track has no baseUrl');
  }

  // The ANDROID-client baseUrl normally includes `&fmt=srv3`. Strip it so
  // YouTube returns the default XML (srv3) without requiring pot signing.
  const cleanUrl = getAllowedTimedtextUrl(
    track.baseUrl.replace(/&fmt=[^&]+/, ''),
  );
  console.log(
    '[LST] innertube: track kind=' +
      (track.kind ?? 'manual') +
      ' lang=' +
      track.languageCode,
  );

  const xmlRes = await fetch(cleanUrl.toString(), {
    credentials: 'include',
    signal,
  });
  if (!xmlRes.ok) {
    throw new Error(`innertube timedtext HTTP ${xmlRes.status}`);
  }

  const body = await xmlRes.text();
  if (!body.trim()) {
    throw new Error('innertube timedtext empty body');
  }

  const cues = parseCaptionBody(body);
  if (cues.length === 0) {
    throw new Error('innertube: zero cues parsed');
  }

  return cues;
}
