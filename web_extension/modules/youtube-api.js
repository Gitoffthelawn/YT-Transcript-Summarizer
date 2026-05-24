import { CONFIG } from './config.js';
import { fetchWithTimeout, findInObject, sleep } from './utils.js';

export async function fetchViaAndroidPlayer(videoId, log, transcriptLang = 'it') {
  const clients = [
    { clientName: 'ANDROID', clientVersion: CONFIG.youtube.androidClientVersion, androidSdkVersion: CONFIG.youtube.androidSdkVersion, hl: 'en', gl: 'US', utcOffsetMinutes: 0 },
    { clientName: 'IOS', clientVersion: CONFIG.youtube.iosClientVersion, deviceModel: CONFIG.youtube.iosDeviceModel, deviceMake: 'Apple', osName: 'iPhone', osVersion: CONFIG.youtube.iosOsVersion, hl: 'en', gl: 'US' },
    { clientName: 'TVHTML5', clientVersion: CONFIG.youtube.tvClientVersion, hl: 'en', gl: 'US' }
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
            const tResp = await fetchWithTimeout(baseUrl + suffix, {}, 12000);
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

  log(`Falling back to get_transcript API...`);
  const params = encodeTranscriptParams(videoId);
  log(`params (base64): ${params}`);

  try {
    const resp = await fetchWithTimeout(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
      {
        method: 'POST',
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

export async function fetchViaTimedText(videoId, log, lang = 'en') {
  log('Trying timedtext API...');
  const primary = lang === 'auto' ? 'en' : lang;
  const candidates = [...new Set([primary, 'en'])];

  for (const l of candidates) {
    for (const extra of ['', '&kind=asr']) {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${l}${extra}&fmt=json3`;
      try {
        const resp = await fetchWithTimeout(url, {}, 12000);
        if (!resp.ok) { log(`timedtext ${l}${extra}: HTTP ${resp.status}`); continue; }
        const text = await resp.text();
        if (text.length < 10) { log(`timedtext ${l}${extra}: empty`); continue; }
        const parsed = parseTranscriptText(text);
        if (parsed) {
          log(`timedtext ${l}${extra}: ✅ ${parsed.length} chars`);
          return { title: videoId, transcript: parsed };
        }
      } catch (e) { log(`timedtext ${l}${extra}: ${e.message}`); }
    }
  }
  return null;
}

export async function tabFetchTranscript(videoId, log, transcriptLang = 'it') {
  log(`Tab strategy for ${videoId}, lang="${transcriptLang}"`);

  const existingTabs = await chrome.tabs.query({ url: ['*://www.youtube.com/watch*', '*://youtu.be/*'] });
  const existingTab = existingTabs.find(t => t.url?.includes(videoId) && t.status === 'complete');
  if (existingTab) {
    log(`Reusing existing tab id=${existingTab.id}`);
    return runTabScript(existingTab.id, videoId, transcriptLang, log);
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
      if (changeInfo.status === 'complete') runScript(3000, 'loaded (complete)');
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
            const title = data?.videoDetails?.title || vid;
            const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            L(`tracks=${tracks.length}`);
            if (tracks.length > 0) {
              const track = tLang === 'auto'
                ? tracks[0]
                : (tracks.find(t => t.languageCode?.startsWith(tLang)) ||
                   tracks.find(t => t.languageCode?.startsWith('en')) ||
                   tracks[0]);
              const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
              for (const suffix of ['&fmt=json3', '', '&fmt=srv3']) {
                try {
                  const r = await fetch(base + suffix);
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
            const r = await fetch(base + suffix);
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
