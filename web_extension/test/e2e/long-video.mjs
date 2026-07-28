// §7.5 — a 4h+ video, live, at ZERO provider cost.
//
// The open question was never "does Gemini accept 11 messages" (the doc itself
// says such a run would mostly measure Gemini stalling, §4.3-bis). It was: on a
// REAL long transcript, does the automatic raise land on a sane number of parts
// with overflow zero, or does the tail vanish?
//
// That question is answered entirely by the transcript plus plannedChunkCount /
// buildChunkMessages. So this fetches the real captions with the extension's own
// youtube-api module and runs the extension's own chunking module on them, in
// the extension's own origin — no provider tab, no message sent, no quota.
//
//   EXT_ID=<id> node test/e2e/long-video.mjs
import { openPopup } from './drive.mjs';

const VIDEOS = [
  ['rfscVS0vtbw', 'freeCodeCamp — Learn Python, ~4h26m'],
  ['RBSGKlAvoiM', 'freeCodeCamp — Data Structures, ~8h'],
];

const { c, evalIn } = await openPopup();

for (const [id, label] of VIDEOS) {
  console.log(`\n=== ${id} — ${label} ===`);
  const out = await evalIn(`(async () => {
    const yt  = await import(chrome.runtime.getURL('modules/youtube-api.js'));
    const llm = await import(chrome.runtime.getURL('modules/llm-api.js'));
    const cfg = await import(chrome.runtime.getURL('modules/config.js'));

    let r = null;
    for (const fn of [yt.fetchViaGetTranscript, yt.fetchViaAndroidPlayer]) {
      try { r = await fn(${JSON.stringify(id)}, () => {}, 'en'); } catch (e) { r = null; }
      if (r?.transcript) break;
    }
    if (!r?.transcript) return { error: 'no transcript' };

    const cap = cfg.CONFIG.maxWebMessageChars.gemini;
    const base = {
      prompt: 'Summarize the following video.', transcriptLang: 'en',
      maxMessageChars: cap, chunkMerge: false,
    };
    // The real web-mode settings: the composer cap applies, and auto-submit ON is
    // what unlocks the automatic raise (the splitToFit gate, fix A-bis).
    const on  = llm.buildChunkMessages(r.transcript, { ...base, chunkParts: 2, splitToFit: true  });
    const off = llm.buildChunkMessages(r.transcript, { ...base, chunkParts: 2, splitToFit: false });

    const stat = w => ({
      parts: w.chunks, messages: w.parts.length,
      longest: Math.max(...w.parts.map(p => p.length)),
      overflow: w.overflow,
      // Nothing may be lost between the slices and the messages.
      totalText: w.parts.reduce((n, p) => n + p.length, 0),
    });
    return {
      title: r.title, chars: r.transcript.length, hours: null, cap,
      maxAutoParts: cfg.CONFIG.chunking.maxAutoParts,
      on: stat(on), off: stat(off),
      // Reassemble the transcript from the slices to prove nothing was dropped.
      rebuilt: llm.splitTranscript(r.transcript, on.chunks).join('').length,
      strippedLen: r.transcript.replace(/\\s/g, '').length,
      rebuiltStripped: llm.splitTranscript(r.transcript, on.chunks).join('').replace(/\\s/g, '').length,
    };
  })()`);

  if (out.error) { console.log(`   ❌ ${out.error}`); continue; }
  console.log(`   "${out.title}"`);
  console.log(`   transcript: ${out.chars.toLocaleString()} chars · Gemini cap ${out.cap.toLocaleString()} · maxAutoParts ${out.maxAutoParts}`);
  console.log(`   auto-submit ON : ${out.on.parts} parts, longest ${out.on.longest.toLocaleString()}, overflow ${out.on.overflow}`);
  console.log(`   auto-submit OFF: ${out.off.parts} parts, longest ${out.off.longest.toLocaleString()}, overflow ${out.off.overflow.toLocaleString()}`);
  console.log(`   slices rebuild: ${out.rebuiltStripped === out.strippedLen ? '✅ no text lost' : `❌ ${out.strippedLen - out.rebuiltStripped} chars lost`}`);

  const verdict = [];
  verdict.push(out.on.overflow === 0
    ? `   ✅ ON: every one of the ${out.on.parts} messages fits the composer`
    : `   ⚠️ ON: still ${out.on.overflow} over — past maxAutoParts, the warning takes over`);
  verdict.push(out.on.parts > 10
    ? `   ✅ raised past the user-facing maxParts (10) — this is exactly what fix I added`
    : `   ·  ${out.on.parts} parts: within maxParts, fix I not exercised by this video`);
  verdict.push(out.off.overflow > 0
    ? `   ✅ OFF: overflow reported (${Math.ceil(out.off.overflow / 1000)}k) instead of silently truncating`
    : `   ❌ OFF: expected an overflow warning`);
  console.log(verdict.join('\n'));
}

c.close();
process.exit(0);
