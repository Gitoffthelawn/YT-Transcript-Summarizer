/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import {
  fetchViaSupadata,
  fetchViaOpenInstances,
  fetchViaAndroidPlayer,
  fetchViaGetTranscript,
  fetchViaTimedText,
  fetchViaYoutubeTranscriptPackage,
} from '@/lib/youtube-api';

// Allow long-running extraction for videos up to 2+ hours (Vercel/serverless)
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:v=|youtu\.be\/|shorts\/|embed\/|\/v\/|\/live\/)([0-9A-Za-z_-]{11})/
  );
  return match ? match[1] : null;
}

async function fetchVideoTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.title as string) || null;
  } catch {
    return null;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────
// 20s buffer: the in-progress strategy's fetch can take up to 15s after the
// timer fires. We need to finish and flush the SSE response before Vercel's
// hard maxDuration=120s deadline kills the process.
const GLOBAL_TIMEOUT_MS = 100_000;
const TRUNCATION_MIN_LENGTH = 5000;
const SENTENCE_END_RE =
  /[.!?\u2026\u00BB\u3002\uFF01\uFF1F)\]"'\u201D\u2019\u00AB]$/;

export async function POST(request: Request) {
  // ── Synchronous validation (no streaming needed for instant errors) ─────
  let body: { url?: string; lang?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { url, lang = 'en' } = body;

  if (!url) {
    return NextResponse.json(
      { error: 'Missing YouTube URL' },
      { status: 400 }
    );
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: 'Invalid YouTube URL' },
      { status: 400 }
    );
  }

  // ── SSE streaming response ─────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          /* controller may be closed if client disconnected */
        }
      };

      const log = (msg: string) => send({ type: 'log', message: msg });

      type TranscriptResult = { title: string; transcript: string };
      let result: TranscriptResult | null = null;
      let strategy = '';
      let timedOut = false;

      // ── Truncation heuristics ──────────────────────────────────────────
      const looksTruncated = (r: TranscriptResult | null): boolean => {
        if (!r) return false;
        const t = r.transcript.trimEnd();
        return t.length >= TRUNCATION_MIN_LENGTH && !SENTENCE_END_RE.test(t);
      };

      const better = (candidate: TranscriptResult | null): boolean => {
        if (!candidate) return false;
        if (!result) return true;
        // Prefer a non-truncated candidate over a truncated result
        if (looksTruncated(result) && !looksTruncated(candidate)) return true;
        // Never replace a good result with a truncated but longer candidate
        if (!looksTruncated(result) && looksTruncated(candidate)) return false;
        return candidate.transcript.length > result.transcript.length;
      };

      /** Returns true if we should try the next strategy. */
      const shouldContinue = (): boolean =>
        !timedOut && !request.signal.aborted && (!result || looksTruncated(result));

      // ── Global timeout ─────────────────────────────────────────────────
      // Prevents the entire strategy chain from running forever.
      // When it fires, the current in-progress strategy finishes but no new
      // ones start. The best partial result found so far is returned.
      const globalTimer = setTimeout(() => {
        timedOut = true;
      }, GLOBAL_TIMEOUT_MS);

      try {
        // Strategy 0: Supadata (bypasses YouTube datacenter IP blocks)
        try {
          const r = await fetchViaSupadata(videoId, log, lang);
          if (r) {
            result = r;
            strategy = 'Supadata';
          }
        } catch (e: any) {
          log(`Supadata Error: ${e.message}`);
        }

        // Strategy 1: Piped / Invidious instance rotator
        if (shouldContinue()) {
          log('Trying Piped/Invidious instance rotator...');
          try {
            const r = await fetchViaOpenInstances(videoId, log, lang);
            if (better(r)) {
              result = r;
              strategy = 'Piped/Invidious';
            }
          } catch (e: any) {
            log(`Open instances Error: ${e.message}`);
          }
        }

        // Strategy 2: Android Player
        if (shouldContinue()) {
          log('Trying Android Player API...');
          try {
            const r = await fetchViaAndroidPlayer(videoId, log, lang);
            if (better(r)) {
              result = r;
              strategy = 'Android Player';
            }
          } catch (e: any) {
            log(`Android Player Error: ${e.message}`);
          }
        }

        // Strategy 3: Watch page + caption CDN URLs
        if (shouldContinue()) {
          log('Trying Watch Page extraction...');
          try {
            const r = await fetchViaGetTranscript(videoId, log, lang);
            if (better(r)) {
              result = r;
              strategy = 'Watch Page';
            }
          } catch (e: any) {
            log(`Watch Page Error: ${e.message}`);
          }
        }

        // Strategy 4: Legacy timedtext API
        if (shouldContinue()) {
          log('Trying Timedtext API...');
          try {
            const r = await fetchViaTimedText(videoId, log, lang);
            if (better(r)) {
              result = r;
              strategy = 'Timedtext API';
            }
          } catch (e: any) {
            log(`Timedtext Error: ${e.message}`);
          }
        }

        // Strategy 5: youtube-transcript npm package
        if (shouldContinue()) {
          log('Trying youtube-transcript package...');
          try {
            const r = await fetchViaYoutubeTranscriptPackage(
              videoId,
              log,
              lang
            );
            if (better(r)) {
              result = r;
              strategy = 'youtube-transcript';
            }
          } catch (e: any) {
            log(`youtube-transcript package Error: ${e.message}`);
          }
        }

        clearTimeout(globalTimer);

        if (timedOut && result?.transcript) {
          log(
            `⏱ Global timeout reached (${GLOBAL_TIMEOUT_MS / 1000}s). Returning best result so far.`
          );
        }

        // ── No result ────────────────────────────────────────────────────
        if (!result?.transcript) {
          send({
            type: 'error',
            message: 'No transcript found or could not be extracted.',
          });
          controller.close();
          return;
        }

        // ── Success ──────────────────────────────────────────────────────
        // Only warn about truncation when we also timed out — otherwise we
        // ran every strategy and the result is as complete as it can be.
        const truncated = looksTruncated(result) && timedOut;

        const title =
          result.title && result.title !== videoId
            ? result.title
            : ((await fetchVideoTitle(videoId)) ?? videoId);

        send({
          type: 'result',
          title,
          transcript: result.transcript,
          strategy,
          truncated,
          timedOut,
        });
      } catch (error: any) {
        clearTimeout(globalTimer);
        send({
          type: 'error',
          message: error.message || 'Internal Server Error',
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx/reverse-proxy buffering
    },
  });
}
