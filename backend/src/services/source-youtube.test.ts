/**
 * YouTube as a source: URL validation, official public metadata, and captions the
 * student pastes themselves. No scraping, no downloads, no stored video data —
 * these tests pin that boundary as much as they pin the behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import {
  NO_CAPTIONS_MESSAGE,
  fetchYouTubeMetadata,
  parseIsoDuration,
  parseYouTubeVideoId,
  resolveYouTubeSource,
} from './source-youtube.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const mutableConfig = config as unknown as { youtubeApiKey: string };

const TRANSCRIPT = [
  'Vandaag leggen we uit hoe de celkern werkt en waarom mitose belangrijk is.',
  'De celkern bevat het DNA en regelt welke eiwitten de cel maakt.',
].join(' ');

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
  } as unknown as Response;
}

describe('youtube: link validation', () => {
  it('accepts a normal watch link', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
  });

  it('accepts a share link', () => {
    expect(parseYouTubeVideoId(`https://youtu.be/${VIDEO_ID}`)).toBe(VIDEO_ID);
  });

  it('accepts shorts, embed and mobile links', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseYouTubeVideoId(`https://m.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${VIDEO_ID}`)).toBe(VIDEO_ID);
  });

  it('accepts the same video written in different ways', () => {
    // Different spellings of one link are one source, not three.
    const forms = [
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}`,
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=120s`,
    ];
    expect(new Set(forms.map(parseYouTubeVideoId)).size).toBe(1);
  });

  it('adds the scheme when the student pastes a bare link', () => {
    expect(parseYouTubeVideoId(`youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
  });

  it('rejects a link from another site', () => {
    expect(() => parseYouTubeVideoId(`https://vimeo.com/${VIDEO_ID}`)).toThrow(
      'Only YouTube links can be imported as a video source.',
    );
  });

  it('rejects a playlist or channel link that is not one video', () => {
    expect(() => parseYouTubeVideoId('https://www.youtube.com/playlist?list=PL123')).toThrow(
      'This link does not point at a single YouTube video.',
    );
  });

  it('rejects an empty or malformed link', () => {
    expect(() => parseYouTubeVideoId('   ')).toThrow('Paste a YouTube link to use as a source.');
    expect(() => parseYouTubeVideoId('https://www.youtube.com/watch?v=te-kort')).toThrow(ApiError);
  });

  it('parses ISO-8601 durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3_723);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT12M')).toBe(720);
    expect(parseIsoDuration('P1DT1H')).toBe(90_000);
    expect(parseIsoDuration('geen duur')).toBeNull();
    expect(parseIsoDuration('PT0S')).toBeNull();
  });
});

describe('youtube: public metadata', () => {
  afterEach(() => {
    mutableConfig.youtubeApiKey = '';
  });

  it('reads title, channel and duration from the official Data API when configured', async () => {
    mutableConfig.youtubeApiKey = 'yt-key';
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            snippet: { title: 'Celdeling uitgelegd', channelTitle: 'Biologie Kanaal' },
            contentDetails: { duration: 'PT14M20S' },
          },
        ],
      }),
    );

    const metadata = await fetchYouTubeMetadata(VIDEO_ID, fetchImpl as unknown as typeof fetch);

    expect(metadata).toEqual({
      videoId: VIDEO_ID,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      title: 'Celdeling uitgelegd',
      channel: 'Biologie Kanaal',
      durationSeconds: 860,
      thumbnailUrl: null,
    });
    const requested = String((fetchImpl.mock.calls[0] as [URL])[0]);
    expect(requested).toContain('googleapis.com/youtube/v3/videos');
    expect(requested).toContain(VIDEO_ID);
  });

  it('falls back to the public oEmbed endpoint without an API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        title: 'Celdeling uitgelegd',
        author_name: 'Biologie Kanaal',
        thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
      }),
    );

    const metadata = await fetchYouTubeMetadata(VIDEO_ID, fetchImpl as unknown as typeof fetch);

    expect(metadata.title).toBe('Celdeling uitgelegd');
    expect(metadata.channel).toBe('Biologie Kanaal');
    expect(metadata.durationSeconds).toBeNull();
    expect(metadata.thumbnailUrl).toContain(VIDEO_ID);
    expect(String((fetchImpl.mock.calls[0] as [URL])[0])).toContain('/oembed');
  });

  it('explains a video that cannot be read', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));

    await expect(
      fetchYouTubeMetadata(VIDEO_ID, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('We could not read this YouTube video. Check that the link is public and try again.');
  });

  it('explains a video that does not exist', async () => {
    mutableConfig.youtubeApiKey = 'yt-key';
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));

    await expect(
      fetchYouTubeMetadata(VIDEO_ID, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('This YouTube video could not be found. Check the link and try again.');
  });
});

describe('youtube: captions come from the student', () => {
  const withMetadata = (transcript: string | null) =>
    resolveYouTubeSource(
      { url: `https://www.youtube.com/watch?v=${VIDEO_ID}`, transcript },
      vi.fn().mockResolvedValue(jsonResponse({ title: 'Celdeling', author_name: 'Kanaal' })) as never,
    );

  it('accepts a pasted transcript and records where it came from', async () => {
    const resolved = await withMetadata(TRANSCRIPT);

    expect(resolved.transcript).toBe(TRANSCRIPT);
    expect(resolved.transcriptOrigin).toBe('student-paste');
    expect(resolved.metadata.videoId).toBe(VIDEO_ID);
  });

  it('refuses a video without usable captions with the exact student message', async () => {
    const error = await withMetadata(null).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    // The required sentence, verbatim, plus the guidance that follows it.
    expect((error as ApiError).message).toContain(
      "This video doesn't have usable captions. Paste the transcript instead",
    );
    expect((error as ApiError).message).toBe(NO_CAPTIONS_MESSAGE);
  });

  it('refuses a transcript that is too short to study, not just an empty one', async () => {
    await expect(withMetadata('Kort.')).rejects.toThrow(NO_CAPTIONS_MESSAGE);
    await expect(withMetadata('   \n  ')).rejects.toThrow(NO_CAPTIONS_MESSAGE);
  });

  it('never downloads captions or media itself', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: 'Celdeling' }));
    await resolveYouTubeSource(
      { url: `https://www.youtube.com/watch?v=${VIDEO_ID}`, transcript: TRANSCRIPT },
      fetchImpl as unknown as typeof fetch,
    );

    // Exactly one request, to the metadata endpoint — nothing else.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requested = String((fetchImpl.mock.calls[0] as [URL])[0]);
    expect(requested).toContain('/oembed');
    expect(requested).not.toContain('/watch?');
  });

  it('honours the YouTube terms: a failed metadata read stops the import', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));

    await expect(
      resolveYouTubeSource(
        { url: `https://www.youtube.com/watch?v=${VIDEO_ID}`, transcript: TRANSCRIPT },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('We could not read this YouTube video.');
  });
});

describe('youtube: no scraping anywhere in the module', () => {
  beforeEach(() => {
    mutableConfig.youtubeApiKey = '';
  });

  it('only calls official endpoints', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ title: 'Celdeling' }));
    await fetchYouTubeMetadata(VIDEO_ID, fetchImpl as unknown as typeof fetch);

    const requested = String((fetchImpl.mock.calls[0] as [URL])[0]);
    expect(requested.startsWith('https://www.youtube.com/oembed')).toBe(true);
    expect(requested).not.toMatch(/timedtext|caption|watch\?v=.*html/i);
  });
});
