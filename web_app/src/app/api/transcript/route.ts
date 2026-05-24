import { NextResponse } from 'next/server';
import { fetchViaSupadata, fetchViaOpenInstances, fetchViaAndroidPlayer, fetchViaGetTranscript, fetchViaTimedText, fetchViaYoutubeTranscriptPackage } from '@/lib/youtube-api';

function extractVideoId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|\/v\/)([0-9A-Za-z_-]{11})/);
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url, lang = 'en' } = body;

    if (!url) {
      return NextResponse.json({ error: 'Missing YouTube URL' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    let result = null;
    let strategy = '';

    // Strategy 0: Supadata (bypasses YouTube datacenter IP blocks)
    try {
      result = await fetchViaSupadata(videoId, log, lang);
      if (result) strategy = 'Supadata';
    } catch (e: any) {
      log(`Supadata Error: ${e.message}`);
    }

    // Strategy 1: Piped / Invidious instance rotator (proxies YouTube through open instances)
    if (!result) {
      log('Trying Piped/Invidious instance rotator...');
      try {
        result = await fetchViaOpenInstances(videoId, log, lang);
        if (result) strategy = 'Piped/Invidious';
      } catch (e: any) {
        log(`Open instances Error: ${e.message}`);
      }
    }

    // Strategy 2: Android Player
    if (!result) {
      log('Trying Android Player API...');
      try {
        result = await fetchViaAndroidPlayer(videoId, log, lang);
        if (result) strategy = 'Android Player';
      } catch (e: any) {
        log(`Android Player Error: ${e.message}`);
      }
    }

    // Strategy 3: Watch page + caption CDN URLs (bypasses InnerTube API blocking)
    if (!result) {
      log('Trying Watch Page extraction...');
      try {
        result = await fetchViaGetTranscript(videoId, log, lang);
        if (result) strategy = 'Watch Page';
      } catch (e: any) {
        log(`Watch Page Error: ${e.message}`);
      }
    }

    // Strategy 4: Legacy timedtext API
    if (!result) {
      log('Trying Timedtext API...');
      try {
        result = await fetchViaTimedText(videoId, log, lang);
        if (result) strategy = 'Timedtext API';
      } catch (e: any) {
        log(`Timedtext Error: ${e.message}`);
      }
    }

    // Strategy 5: youtube-transcript npm package
    if (!result) {
      log('Trying youtube-transcript package...');
      try {
        result = await fetchViaYoutubeTranscriptPackage(videoId, log, lang);
        if (result) strategy = 'youtube-transcript';
      } catch (e: any) {
        log(`youtube-transcript package Error: ${e.message}`);
      }
    }

    if (!result?.transcript) {
      return NextResponse.json({
        error: 'No transcript found or could not be extracted.',
        logs
      }, { status: 404 });
    }

    const title = (result.title && result.title !== videoId)
      ? result.title
      : (await fetchVideoTitle(videoId)) ?? videoId;

    return NextResponse.json({
      title,
      transcript: result.transcript,
      strategy,
      logs
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
