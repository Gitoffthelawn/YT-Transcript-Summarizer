# Roadmap

What this extension is missing compared to what the others do, and how it would be
built. These are not promises: they are assessments, each with its cost and the pitfall
to expect — because that is what decides whether it is worth it.

Two entries, from a competitive comparison made on 2026-07-28. The technical rationale
behind every choice already made lives in `NOTES.md` (working notes, not shipped).

---

## 1. A fallback for videos without captions

### The problem

Today, if YouTube has no captions, `acquireTranscript()` tries all three strategies, fails,
and the job ends with `⚠️ No transcript available for this video`. Correct and honest, but a
dead end: **the video still has audio**. The real cases are lectures, live streams, small
channels, minor languages — which is often exactly the material worth summarizing, because
nobody else has summarized it already.

### Who does it, and how

No **extension** does. The projects that do run locally or on a server, always with the same
shape:

| project | shape |
|---|---|
| [AI-Video-Transcriber](https://github.com/wendy7756/AI-Video-Transcriber) | native captions when they exist; **Whisper only as a fallback**, so the common case stays instant |
| [YouTube-Video-Summarizer](https://github.com/EbrahimAR/YouTube-Video-Summarizer) | `yt-dlp` downloads the audio → **Faster-Whisper** transcribes → Gemini summarizes |
| [Llama2YT](https://github.com/Siris2314/Llama2YT) | Whisper + Llama-2, locally |
| [steipete/summarize](https://github.com/steipete/summarize) | CLI + extension: the heavy lifting is in the CLI, the extension is only the face |

The practical [2026](https://roundproxies.com/blog/scrape-youtube/) consensus is: `yt-dlp` by
default, InnerTube when needed, Playwright only against CAPTCHAs. We are already on InnerTube
with three strategies and a coverage check — **this part is in good shape here**; the gap is
only the "no captions at all" case.

### How it would be built here — and why it is the harder entry

⚠️ **A pure extension cannot do it.** It needs `yt-dlp` (or some way to download the audio
stream) and a transcription model: neither runs in an MV3 service worker. The three routes,
in order of realism:

**A. Optional local helper (recommended).** A small server on `127.0.0.1` — `yt-dlp` +
`faster-whisper` — that the extension only talks to once all three strategies have failed.
- `optional_host_permissions` already carries `http://localhost/*` and `http://127.0.0.1/*`:
  **the permission is already there**, and it is the same shape as the `custom` provider,
  which already points at a local endpoint (Ollama). So the architectural precedent exists.
- Where it plugs in: a fourth entry in `acquireTranscript()`,
  `['S4-LocalWhisper', fetchViaLocalHelper]`, reached only when `best === null`. Zero risk to
  the normal path.
- The result has to come back in `parseTranscript` shape (or at least `{text, endMs}`), so the
  timestamps from §3 keep working: Whisper returns segments carrying `start`, so it is just a
  matter of mapping them onto `pushCue(cues, seg.text, seg.start * 1000)`.
- The real cost is **distribution**. It has to be written, packaged and installed (Python or a
  binary). The extension becomes "extension + program", which is a different category of
  product. Worth doing only if the "lectures and live streams without captions" audience
  genuinely matters to you.

**B. Whisper in the browser** (`transformers.js`, whisper-tiny on WASM/WebGPU). Nothing to
install. But the model download is hundreds of MB, transcribing a two-hour video is
**very slow** on CPU, and **the audio stream is still missing** — which is the real wall.

**C. A paid transcription API** (Deepgram, AssemblyAI, Groq Whisper). A few lines of code, but
it needs the audio again, and it introduces a per-minute cost in an extension that today can
run at zero cost (Web mode). Against its own value proposition.

⚠️ **The wall common to all three is the same: getting hold of the audio.**
`googlevideo.com` URLs are signed, expiring, and tied to the client that requested the player
response; and for a while now the most protected part has required attestation (PO token /
DroidGuard). `yt-dlp` chases that surface full time, which is why option A delegates to it
instead of reimplementing it. **Before writing a line of code**: check whether the audio URL
from the player response we already download (`fetchViaAndroidPlayer`) is still downloadable
without attestation. If it is not, A is the only route left and all the work is in the helper.

**A legal/policy prerequisite, not a technical one:** downloading the audio stream is a
different thing from reading subtitles. Re-read §4.5 (the AMO data declaration) and the store
terms before committing.

---

## 2. Subtitle search and per-chapter summaries

Much cheaper than the first, and one piece of it is **already in the house**.

### The problem

The summary is a single block. Someone watching a two-hour video wants two things they do not
have today: *"where does it talk about X?"* and *"summarize chapter 3 only"*.

### Who does it

- [BibiGPT](https://bibigpt.co/en/blog/posts/best-youtube-ai-summarizer-chrome-extensions) —
  this is precisely its pitch: **per-chapter** summaries in the page, **subtitle search**,
  one-click translation, all in the YouTube sidebar.
- [Eightify](https://www.notelm.ai/blog/youtube-summary-chrome-extension) — "key insights"
  with clickable timestamps (~$9.99/month).
- [NoteGPT / Recall](https://www.recall.it/post/best-youtube-video-summarizers) — timestamps,
  mind maps, Notion sync.

### How it would be built here

**2a — Chapters (the easy piece).** YouTube's chapters are **already inside** the player
response we download: `playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer`
→ `chapters[]`, with `title` and `timeRangeStartMillis`. No extra request is needed: they can
be pulled out with the same `deepFind()` that is already in `background.js`.

Then two independent uses, best done in this order:

1. **Hand them to the model as an outline.** A `## Chapters` block at the top of the
   transcript (title + `[m:ss]`): it costs a few hundred characters and gives the model the
   author's own structure instead of making it guess. Good odds of improving long summaries on
   its own, and it is half an hour of work. **Try this first.**
2. **Cut on chapters instead of on length.** `splitTranscript()` currently cuts into equal
   slices, looking for a `\n` near the boundary. With the timestamps from §3 **the cut can
   follow the chapters**: each part becomes a chapter (or a group of chapters under the
   composer cap), and the partial summaries become summaries *of something*, rather than of an
   arbitrary slice ending mid-sentence.
   ⚠️ The structure of fixes K/N has to be respected: `plannedChunkCount` must stay in charge
   of **how many** parts there are (that is what keeps messages inside the composer cap), so
   cutting on chapters is a *refinement of the boundary*, not an alternative way of deciding
   the part count. If there are more chapters than allowed chunks, group them; if there are
   fewer, keep the current cut inside the chapter. First test to write: **not one character
   lost** (the one in `chunking.test.mjs` is ready to copy).

**2b — Subtitle search.** A search field in the popup that filters the transcript lines and
shows the results with the clickable `[m:ss]` we now have. It is **entirely local**: no model,
no call, no cost. The missing piece is only *where to keep it*: today the transcript is not
retained (it ends up in a file or in a chat), so it needs a per-video cache in
`storage.local` — `unlimitedStorage` is already granted.

⚠️ The real limitation of 2b is that it lives in the **popup**, while everyone from BibiGPT
down lives **inside the YouTube page**. Subtitle search in a popup that closes on every click
outside is far less useful. If 2b gets done, the next step is nearly forced: a panel injected
into `youtube.com/watch` — which is the big job (a new content script, a new lifecycle,
YouTube's SPA that never reloads the page, and the maintenance that follows).

---

## Recommended order

1. **Chapters as an outline in the prompt** (2a.1) — half an hour, no risk, improves long
   summaries immediately.
2. **Cutting on chapters** (2a.2) — half a day, touches `splitTranscript` (a delicate path:
   covered by tests, but read fixes K/N in NOTES §3.4/§3.6 first).
3. **Subtitle search** (2b) — only if you are willing to go on towards the in-page panel;
   otherwise it stays half a feature.
4. **Whisper** (1) — only if the "videos without captions" audience really counts, and only
   via route A. It is a change of product category, not a feature.
