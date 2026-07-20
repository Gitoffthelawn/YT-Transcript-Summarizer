import { CONFIG } from './config.js';
import { fetchWithTimeout, findInObject, sleep } from './utils.js';

// Requests below rely on rules.json rewriting the Origin/Referer headers to
// look like they came from youtube.com — Chrome's real "chrome-extension://"
// Origin gets a hard 403 from YouTube on these endpoints otherwise.
// They also deliberately send no cookies: with real session cookies attached,
// YouTube returns fewer (or zero) caption tracks for the ANDROID client than
// it does for a cookie-less request — verified by testing both side by side.
export async function fetchViaAndroidPlayer(videoId, log, transcriptLang = 'en') {
  const clients = [
    { clientName: 'ANDROID', clientVersion: CONFIG.youtube.androidClientVersion, androidSdkVersion: CONFIG.youtube.androidSdkVersion, hl: 'en', gl: 'US', utcOffsetMinutes: 0 },
    { clientName: 'IOS', clientVersion: CONFIG.youtube.iosClientVersion, deviceMake: 'Apple', deviceModel: CONFIG.youtube.iosDeviceModel, hl: 'en', gl: 'US', utcOffsetMinutes: 0 }
  ];

  for (const clientInfo of clients) {
    log(`Calling /youtubei/v1/player (client ${clientInfo.clientName}) for ${videoId}, lang="${transcriptLang}"`);
    try {
      const resp = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: clientInfo },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true
        })
      }, 15000);

      if (!resp.ok) { log(`${clientInfo.clientName}: HTTP ${resp.status} — skip`); continue; }

      const data = await resp.json();
      const title = data?.videoDetails?.title || videoId;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      log(`${clientInfo.clientName}: title="${title}", tracks=${tracks.length}`);

      if (!tracks.length) {
        const reason = data?.playabilityStatus?.reason || 'unknown';
        log(`${clientInfo.clientName}: No tracks. Playability reason: "${reason}"`);
        continue;
      }

      const track = transcriptLang === 'auto'
        ? tracks[0]
        : (tracks.find(t => t.languageCode?.startsWith(transcriptLang)) ||
           tracks.find(t => t.languageCode?.startsWith('en')) ||
           tracks[0]);

      if (!track?.baseUrl) { log(`${clientInfo.clientName}: Track has no baseUrl`); continue; }
      log(`${clientInfo.clientName}: Track lang="${track.languageCode}", kind="${track.kind || 'standard'}"`);

      const baseUrl = track.baseUrl.replace(/&fmt=[^&]*/g, '');
      for (const suffix of ['&fmt=json3', '', '&fmt=srv3']) {
        try {
          const tResp = await fetchWithTimeout(baseUrl + suffix, {}, 12000);
          if (!tResp.ok) continue;
          const text = await tResp.text();
          log(`${clientInfo.clientName}: Body length: ${text.length}`);
          if (text.length < 10) { log('Empty body — PO token issue or expired URL'); continue; }
          const parsed = parseTranscriptText(text);
          if (parsed) {
            log(`${clientInfo.clientName}: ✅ Parsed (${parsed.length} chars)`);
            return { title, transcript: parsed };
          }
        } catch (e) { log(`Fetch error: ${e.message}`); }
      }
    } catch (e) { log(`${clientInfo.clientName}: Exception: ${e.message}`); }
  }

  log('No client succeeded');
  return null;
}

export async function fetchViaGetTranscript(videoId, log, transcriptLang = 'en') {
  log(`Fetching YouTube watch page...`);

  let title = videoId;
  let apiKey = CONFIG.youtube.apiKey;
  let clientVersion = CONFIG.youtube.webClientVersion;
  let playerData = null;

  try {
    const pageResp = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}`,
      { credentials: 'include', headers: { 'Accept-Language': 'en-US,en;q=0.9' } },
      15000
    );
    if (pageResp.ok) {
      const html = await pageResp.text();
      log(`Page downloaded (${html.length} chars)`);

      playerData = extractYtInitialPlayerResponse(html);
      if (playerData) {
        title = playerData?.videoDetails?.title || videoId;
        log(`Title: "${title}"`);
      }
      const km = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
      if (km) apiKey = km[1];
      const vm = html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/);
      if (vm) clientVersion = vm[1];
      log(`apiKey=${apiKey.slice(0, 20)}..., clientVersion=${clientVersion}`);
    }
  } catch (e) { log(`Page error: ${e.message}`); }

  if (playerData) {
    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    log(`Page extraction: ${tracks.length} caption track(s) found`);

    if (tracks.length > 0) {
      const track = transcriptLang === 'auto'
        ? tracks[0]
        : (tracks.find(t => t.languageCode?.startsWith(transcriptLang)) ||
           tracks.find(t => t.languageCode?.startsWith('en')) ||
           tracks[0]);

      if (track?.baseUrl) {
        log(`Page extraction: using track lang="${track.languageCode}"`);
        const baseUrl = track.baseUrl.replace(/&fmt=[^&]*/g, '');
        for (const suffix of ['&fmt=json3', '', '&fmt=srv3']) {
          try {
            const tResp = await fetchWithTimeout(baseUrl + suffix, { credentials: 'include' }, 12000);
            if (!tResp.ok) continue;
            const text = await tResp.text();
            if (text.length < 10) continue;
            const parsed = parseTranscriptText(text);
            if (parsed) {
              log(`Page extraction: ✅ Parsed (${parsed.length} chars)`);
              return { title, transcript: parsed };
            }
          } catch (e) { log(`Fetch error: ${e.message}`); }
        }
      }
    }
  }

  // Last-resort, WEB-client only: even with a fixed Origin this endpoint tends to
  // 400 "Precondition check failed" because our hand-built `params` blob lacks
  // whatever session/continuation data real page navigation would supply.
  // Kept as a fallback since it occasionally still works; ANDROID (above) is
  // the strategy that reliably returns transcripts.
  log(`Falling back to get_transcript API...`);
  const params = encodeTranscriptParams(videoId);
  log(`params (base64): ${params}`);

  try {
    const resp = await fetchWithTimeout(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
          params
        })
      },
      15000
    );

    log(`HTTP ${resp.status}`);
    if (!resp.ok) { log(`HTTP error`); return null; }

    const data = await resp.json();
    const transcript = parseGetTranscriptResponse(data, log);
    if (transcript) {
      log(`Transcript extracted (${transcript.length} chars)`);
      return { title, transcript };
    }
    log('No transcript content in response');
    return null;
  } catch (e) {
    log(`Exception: ${e.message}`);
    return null;
  }
}

export async function tabFetchTranscript(videoId, log, transcriptLang = 'en') {
  log(`Tab strategy for ${videoId}, lang="${transcriptLang}"`);

  const existingTabs = await chrome.tabs.query({ url: ['*://www.youtube.com/watch*', '*://youtu.be/*'] });
  const existingTab = existingTabs.find(t => t.url?.includes(videoId) && t.status === 'complete');
  if (existingTab) {
    // The tab's URL can still contain our videoId while its content has moved on
    // (e.g. autoplay advanced to a related video) — runTabScript sets `mismatch`
    // when the page's own videoDetails.videoId disagrees with what we asked for.
    // Only then do we fall through and open a dedicated tab; any other failure
    // (no captions, script error) is a genuine result, not reused-tab flakiness.
    log(`Reusing existing tab id=${existingTab.id}`);
    const reusedResult = await runTabScript(existingTab.id, videoId, transcriptLang, log);
    if (reusedResult?.transcript) return reusedResult;
    if (!reusedResult?.mismatch) return reusedResult;
    log('Reused tab was showing a different video — opening a fresh tab instead');
  }

  return new Promise((resolve) => {
    let tabId = null;
    let cleanupTimer = null;
    let fallbackTimer = null;
    let triggered = false;

    const cleanup = () => {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (tabId !== null) {
        chrome.tabs.remove(tabId, () => { void chrome.runtime.lastError; });
        tabId = null;
      }
    };

    const runScript = async (delayMs, reason) => {
      if (triggered) return;
      triggered = true;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      chrome.tabs.onUpdated.removeListener(onUpdated);
      log(`Tab ${tabId} — ${reason}. Waiting ${delayMs / 1000}s...`);
      await sleep(delayMs);
      const result = await runTabScript(tabId, videoId, transcriptLang, log);
      cleanup();
      resolve(result);
    };

    const onUpdated = (id, changeInfo) => {
      if (id !== tabId) return;
      if (changeInfo.status === 'complete') runScript(500, 'loaded (complete)');
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.create(
      { url: `https://www.youtube.com/watch?v=${videoId}`, active: false },
      (tab) => {
        if (chrome.runtime.lastError || !tab) {
          log(`Tab creation error: ${chrome.runtime.lastError?.message}`);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(null);
          return;
        }
        tabId = tab.id;
        log(`Tab created: id=${tabId}`);

        fallbackTimer = setTimeout(() => {
          fallbackTimer = null;
          log('Fallback 15s: complete not received, trying script...');
          runScript(0, 'fallback 15s');
        }, 15000);

        cleanupTimer = setTimeout(() => {
          log('Timeout (55s)');
          chrome.tabs.onUpdated.removeListener(onUpdated);
          cleanup();
          resolve(null);
        }, 55000);
      }
    );
  });
}

async function runTabScript(tabId, videoId, transcriptLang, log) {
  try {
    log('Running script in MAIN world...');
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (vid, tLang, config) => {
        const log = [];
        const L = (m) => log.push(m);

        L('Trying Android API from page context...');
        try {
          const resp = await fetch('/youtubei/v1/player', {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: 'ANDROID',
                  clientVersion: config.androidClientVersion,
                  androidSdkVersion: config.androidSdkVersion,
                  hl: 'en'
                }
              },
              videoId: vid,
              contentCheckOk: true,
              racyCheckOk: true
            })
          });
          L(`Android API HTTP: ${resp.status}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data?.videoDetails?.videoId && data.videoDetails.videoId !== vid) {
              L(`Wrong video in Android response (found ${data.videoDetails.videoId}, expected ${vid}) — skip`);
            } else {
            const title = data?.videoDetails?.title || vid;
            const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            L(`tracks=${tracks.length}`);
            if (tracks.length > 0) {
              const track = tLang === 'auto'
                ? tracks[0]
                : (tracks.find(t => t.languageCode?.startsWith(tLang)) ||
                   tracks.find(t => t.languageCode?.startsWith('en')) ||
                   tracks[0]);
              if (!track?.baseUrl) { L('No baseUrl on track — skip'); }
              else {
              const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
              for (const suffix of ['&fmt=json3', '', '&fmt=srv3']) {
                try {
                  const r = await fetch(base + suffix, { credentials: 'omit' });
                  const txt = await r.text();
                  L(`Transcript fetch: HTTP ${r.status}, length ${txt.length}`);
                  if (txt.length > 10) {
                    try {
                      const j = JSON.parse(txt);
                      const lines = (j.events || []).filter(e => e.segs)
                        .map(e => e.segs.map(s => s.utf8 || '').join('').replace(/\n/g,' ').trim())
                        .filter(t => t && !/^\[.*\]$/.test(t));
                      if (lines.length > 0) return { title, transcript: lines.join('\n'), log };
                    } catch (_) {}
                    const xmlLines = [...txt.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
                      .map(m => m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim())
                      .filter(Boolean);
                    if (xmlLines.length > 0) return { title, transcript: xmlLines.join('\n'), log };
                  }
                } catch (e) { L(`Fetch err: ${e.message}`); }
              }
              }
            }
            }
          }
        } catch (e) { L(`Android API error: ${e.message}`); }

        L('Reading ytInitialPlayerResponse from page...');
        let data = window.ytInitialPlayerResponse;
        if (!data) {
          for (const sc of document.querySelectorAll('script:not([src])')) {
            const txt = sc.textContent;
            if (!txt.includes('ytInitialPlayerResponse')) continue;
            const idx = txt.indexOf('ytInitialPlayerResponse');
            const start = txt.indexOf('{', idx);
            if (start === -1) continue;
            let depth = 0, inStr = false, esc = false;
            for (let i = start; i < txt.length; i++) {
              const c = txt[i];
              if (esc) { esc = false; continue; }
              if (c === '\\' && inStr) { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === '{') depth++;
              else if (c === '}' && --depth === 0) {
                try { data = JSON.parse(txt.slice(start, i + 1)); } catch (_) {}
                break;
              }
            }
            if (data) break;
          }
        }

        if (!data) { L('ytInitialPlayerResponse not found'); return { title: vid, transcript: null, log }; }

        if (data?.videoDetails?.videoId && data.videoDetails.videoId !== vid) {
          L(`Wrong video in tab (found ${data.videoDetails.videoId} "${data?.videoDetails?.title}", expected ${vid}) — tab shows a different video`);
          return { title: vid, transcript: null, log, mismatch: true };
        }

        const title = data?.videoDetails?.title || vid;
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        L(`ytInitialPlayerResponse OK: title="${title}", tracks=${tracks.length}`);
        if (!tracks.length) return { title, transcript: null, log };

        const track = tLang === 'auto'
          ? tracks[0]
          : (tracks.find(t => t.languageCode?.startsWith(tLang)) ||
             tracks.find(t => t.languageCode?.startsWith('en')) ||
             tracks[0]);
        if (!track?.baseUrl) return { title, transcript: null, log };

        const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
        for (const suffix of ['&fmt=json3', '', '&fmt=srv3']) {
          try {
            const r = await fetch(base + suffix, { credentials: 'omit' });
            const txt = await r.text();
            L(`Transcript HTTP ${r.status}, length ${txt.length}`);
            if (txt.length < 10) { L('Empty body'); continue; }
            try {
              const j = JSON.parse(txt);
              const lines = (j.events || []).filter(e => e.segs)
                .map(e => e.segs.map(s => s.utf8 || '').join('').replace(/\n/g,' ').trim())
                .filter(t => t && !/^\[.*\]$/.test(t));
              if (lines.length > 0) return { title, transcript: lines.join('\n'), log };
            } catch (_) {}
            const xmlLines = [...txt.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
              .map(m => m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim())
              .filter(Boolean);
            if (xmlLines.length > 0) return { title, transcript: xmlLines.join('\n'), log };
          } catch (e) { L(`Error: ${e.message}`); }
        }
        return { title, transcript: null, log };
      },
      args: [videoId, transcriptLang, CONFIG.youtube]
    });

    const tabResult = results?.[0]?.result;
    if (tabResult?.log?.length) log(`Script log:\n${tabResult.log.map(l => '  ' + l).join('\n')}`);
    if (tabResult?.transcript) {
      log(`Transcript found (${tabResult.transcript.length} chars)`);
      return tabResult;
    }
    if (tabResult?.mismatch) {
      log('Reused tab shows a different video');
      return { transcript: null, mismatch: true };
    }
    log('No transcript from tab');
    return null;
  } catch (e) {
    log(`Scripting error: ${e.message}`);
    return null;
  }
}

function parseTranscriptText(text) {
  try {
    const json = JSON.parse(text);
    const lines = (json.events || [])
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim())
      .filter(t => t && !/^\[.*\]$/.test(t));
    if (lines.length > 0) return lines.join('\n');
  } catch (_) {}

  const xmlLines = [...text.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map(m => m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim())
    .filter(Boolean);
  if (xmlLines.length > 0) return xmlLines.join('\n');

  return null;
}

function extractYtInitialPlayerResponse(html) {
  const idx = html.indexOf('ytInitialPlayerResponse');
  if (idx === -1) return null;
  const jsonStart = html.indexOf('{', idx);
  if (jsonStart === -1) return null;

  let depth = 0, inString = false, escaped = false;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(jsonStart, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function encodeTranscriptParams(videoId) {
  const enc = new TextEncoder();
  const idBytes = enc.encode(videoId);
  const inner = new Uint8Array([0x0a, idBytes.length, ...idBytes]);
  const outer = new Uint8Array([0x0a, inner.length, ...inner]);
  return btoa(String.fromCharCode(...outer));
}

function parseGetTranscriptResponse(data, log) {
  const segments = findInObject(data, 'initialSegments');
  if (!segments?.length) {
    log('initialSegments not found in response');
    const renderer = findInObject(data, 'transcriptSegmentListRenderer');
    if (renderer) log(`transcriptSegmentListRenderer found but initialSegments missing`);
    return null;
  }

  const lines = segments
    .map(s => {
      const runs = s?.transcriptSegmentRenderer?.snippet?.runs || [];
      return runs.map(r => r.text || '').join('').replace(/\n/g, ' ').trim();
    })
    .filter(t => t && !/^\[.*\]$/.test(t));

  log(`Segments found: ${segments.length}, valid lines: ${lines.length}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

// ── Playlist continuations (long playlists) ──────────────────────────────────
// The InnerTube /browse continuation endpoint answers the service worker with
// Google's anti-abuse "Sorry" 403 (the chrome-extension Origin trips it), so
// pages past the first ~100 videos can't be fetched directly from the background.
// They fetch fine from a real youtube.com page context, though: we reuse an
// already-open YouTube tab when there is one (no visible flash), otherwise open
// a throwaway background tab, run the continuation loop in the page's MAIN world,
// and collect the rest. Best-effort — returns whatever it got (possibly []),
// never throws, so the caller keeps its first-page results on any failure.
export async function tabBrowseContinuations(listId, startToken, apiKey, clientVersion, max, log = () => {}) {
  // Runs in the page (MAIN world): loops the browse continuation from youtube.com
  // itself. Self-contained — it can't reference anything from the extension.
  const injected = async (fallbackKey, fallbackCv, startToken, max, listId) => {
    // Prefer the page's own InnerTube config (real API key, client version and
    // visitorData) over a reconstructed WEB context — sending exactly what
    // youtube.com sends is what keeps the continuation off the anti-abuse 403.
    const ytcfgGet = (k) => {
      try { if (window.ytcfg?.get) { const v = window.ytcfg.get(k); if (v != null) return v; } } catch { /* fall through */ }
      return window.ytcfg?.data_?.[k];
    };
    const pageKey = ytcfgGet('INNERTUBE_API_KEY');
    const pageContext = ytcfgGet('INNERTUBE_CONTEXT');
    const apiKey = pageKey || fallbackKey;
    const baseContext = pageContext
      ? JSON.parse(JSON.stringify(pageContext))
      : { client: { clientName: 'WEB', clientVersion: fallbackCv, hl: 'en', gl: 'US' } };
    const out = [];
    const seen = new Set();
    let dupes = 0; // playlist entries whose video we already have (the same video listed twice)
    let countDupes = true; // off during the logged-in second pass (which re-sees the same videos)
    const isVideoId = (s) => typeof s === 'string' && /^[\w-]{11}$/.test(s);
    const skippedLockup = {}; // contentType -> count, for diagnosing missed items
    const add = (videoId, title) => {
      if (!isVideoId(videoId)) return;
      if (seen.has(videoId)) { if (countDupes) dupes++; return; }
      seen.add(videoId); out.push({ videoId, title: title || null });
    };
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) collect(n); return; }
      const lv = node.lockupViewModel;
      if (lv?.contentId) {
        // Accept any lockup whose id is a video id and that isn't explicitly a
        // playlist/channel lockup — YouTube uses several VIDEO-ish contentTypes
        // (music, podcast episodes, …) and requiring the exact VIDEO enum drops
        // some real entries. Record what we skip so misses are diagnosable.
        const ct = lv.contentType || '';
        if (isVideoId(lv.contentId) && !/PLAYLIST|CHANNEL|SHOW/.test(ct)) {
          add(lv.contentId, lv.metadata?.lockupMetadataViewModel?.title?.content);
        } else if (!seen.has(lv.contentId)) {
          skippedLockup[ct || '(none)'] = (skippedLockup[ct || '(none)'] || 0) + 1;
        }
      }
      // Classic renderers that carry a videoId directly.
      for (const key of ['playlistVideoRenderer', 'videoRenderer', 'gridVideoRenderer', 'playlistPanelVideoRenderer']) {
        const r = node[key];
        if (r?.videoId) add(r.videoId, r.title?.runs?.map(x => x.text).join('') || r.title?.simpleText || null);
      }
      for (const k in node) {
        if (k === 'lockupViewModel' || k === 'playlistVideoRenderer' || k === 'videoRenderer'
          || k === 'gridVideoRenderer' || k === 'playlistPanelVideoRenderer') continue;
        collect(node[k]);
      }
    };
    const deepFind = (node, key, depth = 30) => {
      if (!node || typeof node !== 'object' || depth < 0) return null;
      if (node[key] !== undefined) return node[key];
      for (const v of Object.values(node)) { if (v && typeof v === 'object') { const f = deepFind(v, key, depth - 1); if (f != null) return f; } }
      return null;
    };
    // Collect EVERY continuation token anywhere in a response, regardless of
    // nesting or wrapper renderer. YouTube's playlist grid keeps moving where the
    // "load more" token lives (continuationItemRenderer, richGrid wrappers, …),
    // so instead of guessing the path we gather all candidates and just try them.
    const collectTokens = (node, acc, seenT, depth = 40) => {
      if (!node || typeof node !== 'object' || depth < 0) return acc;
      if (Array.isArray(node)) { for (const n of node) collectTokens(n, acc, seenT, depth - 1); return acc; }
      const t = node.continuationCommand?.token
        || node.continuationEndpoint?.continuationCommand?.token
        || node.nextContinuationData?.continuation
        || node.reloadContinuationData?.continuation;
      if (typeof t === 'string' && t.length > 10 && !seenT.has(t)) { seenT.add(t); acc.push(t); }
      for (const k in node) collectTokens(node[k], acc, seenT, depth - 1);
      return acc;
    };
    const tokensIn = (root) => collectTokens(root, [], new Set());

    // Read the playlist's declared size from the live page (more reliable than
    // the background's HTML fetch). Only trust a value that isn't below what we
    // already see, so a stray "1 video" elsewhere on the page can't win.
    const parseTotal = (root, floor) => {
      for (const key of ['numVideosText', 'videoCountText', 'stats', 'videoCountShortText']) {
        const v = deepFind(root, key);
        const arr = Array.isArray(v) ? v : [v];
        for (const item of arr) {
          const s = item?.runs?.map(r => r.text).join('') || item?.simpleText || item?.content || '';
          const m = s.replace(/[.,](?=\d{3}\b)/g, '').match(/\d[\d,\.]*\s*video/i);
          if (m) { const n = parseInt(m[0].replace(/[^\d]/g, ''), 10); if (Number.isFinite(n) && n >= floor) return n; }
        }
      }
      return null;
    };

    // POST /youtubei/v1/browse with an arbitrary body. Anonymous first (a
    // logged-in session's own calls carry an Authorization: SAPISIDHASH header we
    // can't reproduce), then credentialed as a fallback.
    const statuses = [];
    let credsOverride = null; // when set, use only this credentials mode
    const browse = async (body) => {
      for (const cred of (credsOverride ? [credsOverride] : ['omit', 'include'])) {
        let resp;
        try {
          resp = await fetch(`/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
            method: 'POST', credentials: cred,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: baseContext, ...body })
          });
        } catch { statuses.push(`${cred}:ERR`); continue; }
        statuses.push(`${cred}:${resp.status}`);
        if (resp.ok) { try { return await resp.json(); } catch { return null; } }
      }
      return null;
    };

    // Read the declared total from the live page if it happens to be loaded.
    let liveTotal = null, seededFromLive = false;
    try {
      const live = window.ytInitialData
        || (window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.RAW_INITIAL_DATA);
      if (live && (!listId || location.href.includes(listId))) {
        liveTotal = parseTotal(live, 0);
        seededFromLive = true;
      }
    } catch { /* ignore */ }

    const pageAdds = [];
    let guard = 0;
    // Follow a continuation chain to its end, recording how many NEW videos each
    // page contributes (so a premature stop is visible in the debug output).
    const drain = async (firstData) => {
      let data = firstData;
      let token = data ? (tokensIn(data)[0] || null) : null;
      if (data) { const b0 = out.length; collect(data); pageAdds.push(out.length - b0); }
      let prev = null;
      while (token && out.length < max && guard < 200) {
        guard++;
        const before = out.length;
        data = await browse({ continuation: token });
        if (!data) break;
        collect(data);
        pageAdds.push(out.length - before);
        const next = tokensIn(data).find(t => t !== token && t !== prev) || null;
        prev = token; token = next;
      }
    };

    // Primary, canonical method: browse the playlist by id ("VL"+listId). This
    // returns playlistVideoRenderer items 100-at-a-time with a clean continuation
    // token that paginates to the true end — far more reliable than scraping
    // whatever tokens happen to sit in the live page's ytInitialData.
    // params 'wgYCCAA=' is yt-dlp's flag that makes the browse response INCLUDE
    // videos the WEB client otherwise hides (region-blocked, age-gated, some
    // "unavailable" entries) — the difference between the 154 the WEB grid shows
    // and the full count the Data API reports.
    const SHOW_UNAVAILABLE = 'wgYCCAA=';
    let usedBrowseId = false;
    if (listId) {
      const first = await browse({ browseId: 'VL' + listId, params: SHOW_UNAVAILABLE });
      if (first) { usedBrowseId = true; if (liveTotal == null) liveTotal = parseTotal(first, 0); await drain(first); }
    }

    // Fallback: only when browse-by-id itself failed (blocked / empty). When it
    // succeeded it already yielded the complete unique list, so re-scanning the
    // live page here would just re-count the same videos as duplicates.
    if (!usedBrowseId || out.length === 0) {
      try {
        const live = window.ytInitialData
          || (window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.RAW_INITIAL_DATA);
        if (live && (!listId || location.href.includes(listId))) {
          const b0 = out.length; collect(live); pageAdds.push(out.length - b0);
          const tried = new Set();
          const queue = tokensIn(live);
          if (startToken) queue.unshift(startToken);
          while (queue.length && out.length < max && guard < 200) {
            const tok = queue.shift();
            if (!tok || tried.has(tok)) continue;
            tried.add(tok); guard++;
            const before = out.length;
            const data = await browse({ continuation: tok });
            if (!data) continue;
            collect(data);
            pageAdds.push(out.length - before);
            for (const t of tokensIn(data)) { if (!tried.has(t)) queue.push(t); }
          }
        }
      } catch { /* keep whatever we have */ }
    }

    // Second pass with the logged-in session. The anonymous pass can't see
    // videos that are age- or region-gated for signed-out users; the user's own
    // cookies often can. Only worth it when we came up short with no error.
    let pass2Added = 0;
    const cleanSoFar = !statuses.some(s => !/:2\d\d$/.test(s));
    if (listId && usedBrowseId && cleanSoFar && out.length < (liveTotal || 0)) {
      const beforeP2 = out.length;
      countDupes = false; // re-seeing the same videos here isn't a real duplicate
      credsOverride = 'include';
      try {
        const first2 = await browse({ browseId: 'VL' + listId, params: SHOW_UNAVAILABLE });
        if (first2) await drain(first2);
      } catch { /* keep pass-1 results */ }
      credsOverride = null;
      pass2Added = out.length - beforeP2;
    }

    return { videos: out, total: liveTotal, dupes, dbg: { startTokenLen: (startToken || '').length, seededFromLive, usedBrowseId, liveTotal, dupes, pass2Added, pages: guard, pageAdds, skippedLockup, statuses, collected: out.length, usedPageCfg: !!pageKey, href: location.href } };
  };

  // The injected code seeds from the tab's own window.ytInitialData, so the tab
  // must actually be showing THIS playlist. Reuse an already-open tab on this
  // list if there is one; otherwise open a throwaway background tab on it. (A
  // random open YouTube tab won't do — its ytInitialData is a different page.)
  const openTabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*'] });
  let tab = openTabs.find(t => t.url && t.url.includes(`list=${listId}`) && t.status === 'complete');
  let createdTabId = null;
  try {
    if (!tab) {
      tab = await new Promise((resolve) => {
        chrome.tabs.create({ url: `https://www.youtube.com/playlist?list=${listId}`, active: false }, (t) => resolve(t || null));
      });
      if (!tab) return { videos: [], total: null };
      createdTabId = tab.id;
      await new Promise((resolve) => {
        const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); };
        const onUpdated = (id, info) => { if (id === createdTabId && info.status === 'complete') done(); };
        chrome.tabs.onUpdated.addListener(onUpdated);
        setTimeout(done, 15000);
      });
    }
    log(`Paging playlist continuations in tab ${tab.id} (created=${createdTabId !== null})`);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: injected,
      args: [apiKey, clientVersion, startToken, max, listId]
    });
    const r = results?.[0]?.result;
    log(`continuations dbg: ${JSON.stringify(r?.dbg)}`);
    return { videos: r?.videos || [], total: r?.total ?? null, dupes: r?.dupes ?? 0 };
  } catch (e) {
    log(`tabBrowseContinuations error: ${e.message || e}`);
    return { videos: [], total: null, dupes: 0 };
  } finally {
    if (createdTabId !== null) chrome.tabs.remove(createdTabId, () => { void chrome.runtime.lastError; });
  }
}
