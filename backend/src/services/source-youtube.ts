/**
 * YouTube as a source — deliberately conservative.
 *
 * What Lerno does:
 *  - validates the URL (only YouTube hosts and a well-formed 11-character id)
 *  - reads *public metadata*: title, channel and — when `YOUTUBE_API_KEY` is
 *    configured — the duration from the official YouTube Data API v3; otherwise
 *    from the official oEmbed endpoint (which has no duration)
 *  - accepts captions the student pastes themselves
 *
 * What Lerno deliberately does NOT do:
 *  - no scraping of watch pages, no caption downloading, no re-hosting or
 *    redistributing video or subtitle content. Lerno never stores video data.
 *
 * Without captions the source fails honestly with the exact message
 * "This video doesn't have usable captions." and the UI offers to paste the
 * transcript instead.
 */
import { config } from '../config.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { sanitizeMaterialText } from './material-analysis.js';

export const NO_CAPTIONS_MESSAGE =
  "This video doesn't have usable captions. Paste the transcript instead — you can copy it from YouTube's transcript panel.";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

export interface YouTubeMetadata {
  videoId: string;
  url: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

export interface YouTubeSourceInput {
  url: string;
  /** Captions pasted by the student (the only transcript source Lerno uses). */
  transcript?: string | null;
}

export interface ResolvedYouTubeSource {
  metadata: YouTubeMetadata;
  transcript: string;
  /** Where the transcript came from — provenance, not decoration. */
  transcriptOrigin: 'student-paste';
}

/** Parses a YouTube URL and returns its video id, or throws a clear error. */
export function parseYouTubeVideoId(raw: string): string {
  const value = raw.trim();
  if (!value) throw errors.validation('Paste a YouTube link to use as a source.');

  let url: URL;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    throw errors.validation('That is not a valid YouTube link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw errors.validation('That is not a valid YouTube link.');
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw errors.validation('Only YouTube links can be imported as a video source.');
  }

  const candidate =
    host.endsWith('youtu.be')
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.searchParams.get('v') ??
        (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')
          ? url.pathname.split('/').filter(Boolean)[1]
          : null);

  if (!candidate || !VIDEO_ID.test(candidate)) {
    throw errors.validation(
      'This link does not point at a single YouTube video. Use a link like https://www.youtube.com/watch?v=…',
    );
  }
  return candidate;
}

/** ISO-8601 duration ("PT1H2M3S") from the Data API → seconds. */
export function parseIsoDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Number.isFinite(total) && total > 0 ? total : null;
}

interface OEmbedResponse {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
}

interface DataApiResponse {
  items?: { snippet?: { title?: unknown; channelTitle?: unknown }; contentDetails?: { duration?: unknown } }[];
}

/** Fetches public metadata. Never fetches captions or media. */
export async function fetchYouTubeMetadata(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeMetadata> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  if (config.youtubeApiKey) {
    const api = new URL('https://www.googleapis.com/youtube/v3/videos');
    api.searchParams.set('part', 'snippet,contentDetails');
    api.searchParams.set('id', videoId);
    api.searchParams.set('key', config.youtubeApiKey);
    const response = await fetchImpl(api, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw errors.validation(
        'We could not read this YouTube video. Check that the link is public and try again.',
      );
    }
    const body = (await response.json()) as DataApiResponse;
    const item = body.items?.[0];
    if (!item) {
      throw errors.validation('This YouTube video could not be found. Check the link and try again.');
    }
    return {
      videoId,
      url,
      title: sanitizeMaterialText(String(item.snippet?.title ?? 'YouTube video')).slice(0, 160),
      channel: item.snippet?.channelTitle ? String(item.snippet.channelTitle).slice(0, 120) : null,
      durationSeconds: item.contentDetails?.duration
        ? parseIsoDuration(String(item.contentDetails.duration))
        : null,
      thumbnailUrl: null,
    };
  }

  // Official, key-less metadata endpoint (no duration, but no scraping either).
  const oembed = new URL('https://www.youtube.com/oembed');
  oembed.searchParams.set('url', url);
  oembed.searchParams.set('format', 'json');
  const response = await fetchImpl(oembed, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw errors.validation(
      'We could not read this YouTube video. Check that the link is public and try again.',
    );
  }
  const body = (await response.json()) as OEmbedResponse;
  return {
    videoId,
    url,
    title: sanitizeMaterialText(String(body.title ?? 'YouTube video')).slice(0, 160),
    channel: body.author_name ? String(body.author_name).slice(0, 120) : null,
    durationSeconds: null,
    thumbnailUrl: typeof body.thumbnail_url === 'string' ? body.thumbnail_url : null,
  };
}

/**
 * Resolves a YouTube source: metadata plus the student's own transcript. A video
 * without a pasted transcript is rejected with the captions message — Lerno never
 * downloads captions itself.
 */
export async function resolveYouTubeSource(
  input: YouTubeSourceInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedYouTubeSource> {
  const videoId = parseYouTubeVideoId(input.url);
  const metadata = await fetchYouTubeMetadata(videoId, fetchImpl);
  const transcript = sanitizeMaterialText(input.transcript ?? '');
  if (transcript.replace(/\s/g, '').length < 50) {
    logger.info('source.youtube.no_captions', { action: 'source-youtube', videoId });
    throw errors.validation(NO_CAPTIONS_MESSAGE);
  }
  return { metadata, transcript, transcriptOrigin: 'student-paste' };
}
