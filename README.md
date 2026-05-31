# YT Transcript Summarizer

Extract transcripts from YouTube videos and summarize them with any AI — Claude, ChatGPT, Gemini, OpenRouter, or a local model.

The project ships as two complementary clients that share the same transcript-extraction logic and prompt presets:

| Client | Best for | Folder |
|--------|----------|--------|
| **Browser extension** (Chrome / Firefox) | Desktop, power users, batch processing | [`web_extension/`](web_extension/) — [Install on Firefox ↗](https://addons.mozilla.org/it/firefox/addon/yt-transcript-summarizer/) |
| **Progressive web app** | Mobile, quick one-off summaries | [`web_app/`](web_app/) |

---

## How it works

1. A YouTube URL is submitted.
2. The transcript is extracted using multiple strategies with automatic fallback (6 server-side strategies in the web app, 4 in the extension).
3. If the video has no captions in the requested language, YouTube's auto-translate (`tlang`) is used automatically.
4. A prompt is assembled (provider, language, length, and format are all configurable).
5. The result is either sent directly to an AI API, or copied so you can paste it into any chat UI.

---

## Features by client

| Feature | Extension | Web app |
|---------|-----------|---------|
| AI providers | Claude, OpenAI, Gemini, OpenRouter, Custom | Claude, OpenAI, Gemini |
| Web mode (open chat UI + copy) | ✅ | ✅ |
| API mode (call AI directly) | ✅ | — |
| Transcript download (.txt) | ✅ | ✅ |
| Extraction log export (copy) | — | ✅ |
| Batch queue | ✅ | — |
| Per-video settings | ✅ | — |
| Thinking mode (Claude) | ✅ | — |
| Auto-paste / auto-submit | ✅ | — |
| Text-to-Speech | ✅ | — |
| 7-day transcript cache (localStorage) | — | ✅ |
| Clear cache button | — | ✅ |
| Strategy badge (shows which method succeeded) | — | ✅ |
| Share to app (Web Share API, bypasses Android clipboard limit) | — | ✅ |
| Video history | ✅ (No limit) | ✅ (No limit) |
| Dark / light theme | ✅ | ✅ |
| Languages | English, Italian, Spanish | 15 languages + YouTube auto-translate |

---

## Language support

### Web app

The Language selector includes 15 languages: Italian, English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic, Russian, Dutch, Polish, Turkish, and Hindi.

Full native prompts are provided for Italian, English, Spanish, French, German, and Portuguese. Other languages fall back to the English prompt — the AI infers the correct output language from the transcript.

When a video has no captions in the requested language the app automatically uses YouTube's `tlang` auto-translate parameter, so you can always get a transcript in your chosen language as long as the video has any captions at all.

### Extension

English, Italian, Spanish.

---

## Shared logic

Both clients use the same:
- **Transcript extraction strategies** (Android Player API, `get_transcript` endpoint, Timedtext API)
- **Provider configuration** (names, models, default models, API endpoints)
- **Prompt presets** (Italian, English, Spanish, French, German, Portuguese; three lengths; two formats)

The extension is plain JavaScript (ES modules, Manifest V3); the web app is TypeScript (Next.js, React, Tailwind CSS 4). The shared configuration is kept in sync between `web_extension/modules/config.js` and `web_app/src/lib/config.ts`.

The web app also has two additional server-side-only strategies (Supadata API and Piped/Invidious instance rotator) that require server-side fetch and cannot run in a browser extension.

---

## Repository structure

```
YT-Transcript-Summarizer/
├── web_extension/          Chrome / Firefox extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js       Service worker: extraction, API calls, TTS
│   ├── popup.html/css      Extension popup UI
│   ├── popup.js            Popup orchestrator: init, port, job CRUD, batch
│   ├── *_paste.js          Content scripts for Claude, ChatGPT, Gemini
│   ├── tts_offscreen.*     Offscreen document for Web Speech API
│   └── modules/
│       ├── config.js           Providers, prompts, YouTube API config
│       ├── llm-api.js          AI provider integrations
│       ├── youtube-api.js      Transcript extraction strategies
│       ├── popup-state.js      Shared mutable state object
│       ├── popup-history.js    History panel
│       ├── popup-tts.js        TTS panel
│       ├── popup-render.js     Job rendering, chips, per-job settings
│       ├── popup-settings.js   Provider/settings panel
│       ├── ui-utils.js
│       └── utils.js
│
└── web_app/                Next.js PWA (mobile-first)
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx        Main UI (form, prompt editor, cache, history)
    │   │   ├── layout.tsx
    │   │   ├── globals.css
    │   │   └── api/transcript/ Server-side extraction endpoint (6 strategies)
    │   ├── components/
    │   │   ├── TranscriptForm.tsx
    │   │   └── ActionButtons.tsx
    │   └── lib/
    │       ├── config.ts       Providers, prompts, language list, YouTube API config
    │       ├── youtube-api.ts  Transcript extraction strategies + auto-translate
    │       └── utils.ts
    └── public/manifest.json    PWA manifest
```

---

## Quick start

### Extension

Firefox users can install directly from the [Firefox Add-ons page](https://addons.mozilla.org/it/firefox/addon/yt-transcript-summarizer/).

For Chrome or manual Firefox installation see [`web_extension/README.md`](web_extension/README.md).

### Web app

```bash
cd web_app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For production deployment see [`web_app/README.md`](web_app/README.md).

---

## License

MIT
