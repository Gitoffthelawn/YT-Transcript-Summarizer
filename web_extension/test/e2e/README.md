# Driver E2E — driving the real extension in Chrome

No dependencies: Node 24 has a global `WebSocket`, so ~40 lines of a CDP
client (`cdp.mjs`) are enough. Puppeteer is **not** needed. The full recipe, with
the pitfalls, is in `TESTING-TODO.md` §6.

## Startup

```bash
# 1. the extension must live in a SHORT path with NO SPACES
cp -r <repo>/* /c/Users/Admin/ytsx/

# 2. Chrome with the debug port
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --user-data-dir=C:/Users/Admin/ytsp --remote-debugging-port=9333 \
  --enable-unsafe-extension-debugging --no-first-run \
  --no-default-browser-check about:blank &

# 3. load the extension via CDP (--load-extension is IGNORED)
node -e "import('./cdp.mjs').then(async m=>{const c=await m.connect(9333);
  console.log(await c.send('Extensions.loadUnpacked',{path:'C:/Users/Admin/ytsx'}));c.close()})"
```

The id returned goes into `EXT_ID` for all the scripts below.

## The scripts

| file | what it does | does it send? |
|---|---|---|
| `cdp.mjs` | minimal CDP client: `connect()`, `send()`, `attach()`, `targets()` | — |
| `drive.mjs` | opens `popup.html`, sends `startBatch`, polls the jobs | — |
| `long-video.mjs` | §7.5: splits a **real** 4h/8h video, without opening any provider | no |
| `real-run.mjs` | the full supported flow + composer screenshot | **no** |
| `claim-race.mjs` | §7.8: two tabs together, 60 s lock, 5 min TTL | **no** |
| `combined-live.mjs` | §4.7/§7.6: combined, one report → all rows | **no** |
| `paste-recorder.mjs` | records every value of the composer from before the content script | **no** |
| `merge-quality.mjs` | §1.2: full merge run; tells whether the partials were pasted back and measures how much of each survives in the merge. `PROVIDER=gemini\|anthropic\|openai` | **YES** |
| `test-merge.mjs` | full 4-part + merge run, mechanics only (without the answers) | **YES** |
| `merge-run-2026-07-27.txt` | the 5 answers from the run that found §4.4 — evidence, not a script | — |
| `merge-run-2026-07-27-inlined.txt` | the 5 answers from the same run **with fix K**: the before/after of §4.4-ter | — |
| `merge-run-2026-07-28-claude.txt` | the 3 answers from the Claude run, fix K confirmed on a second provider | — |
| `merge-run-2026-07-28-chatgpt.txt` | the two partials on ChatGPT (extracted from the merge message) and the final fusion, after fixes M and N | — |
| `wait-report.mjs` | waits for a sequence to finish and prints the real verdict | — |
| `peek-all.mjs` | inspects all Gemini tabs: turns sent, composer, busy | — |
| `measure-cap.mjs` | measures a provider's composer cap | no |
| `gemini-drop.mjs` | tries the attachment via simulated drop (4-bis, negative outcome) | no |

### Firefox (§8) — the browser it's published on

Chrome and Firefox share nothing of the recipe above: on Gecko there is neither
`Extensions.loadUnpacked` nor the CDP browser socket. The protocol is **WebDriver BiDi**.

| file | what it does | does it send? |
|---|---|---|
| `bidi.mjs` | minimal BiDi client — the twin of `cdp.mjs`; includes the static server | — |
| `drive-gecko.mjs` | the twin of `drive.mjs`: finds `popup.html`, sends `startBatch` | — |
| `gecko-paste.html` | a three-editor test bench that loads the **real** `paste_common.js` | no |
| `gecko-paste.mjs` | §8.1: runs the bench on Firefox — found bug O | **no** |
| `chrome-paste.mjs` | the **same** page on headless Chrome: regression check | **no** |
| `clear-retry.html` | §3.9: the retry that doubled the message. `ytsClearInput` on the three real editors, with a control check that **without** the clear the duplicate is there | no |
| `clear-retry.mjs` | runs the bench above; launches the browser itself. `node test/e2e/clear-retry.mjs [chrome\|firefox]` | **no** |
| `upload-probe.mjs` | §4.4: attaching the transcript as a **file** instead of pasting it. Looks for `input[type=file]` (shadow roots included), tries a simulated drop and `input.files = dt.files`. **Persistent** profile: log in once. `node test/e2e/upload-probe.mjs [gemini\|anthropic\|openai]` | **no** |
| `firefox-live.mjs` | **the live run to use today**: a real run of the real extension in Firefox, without going through the popup. `node test/e2e/firefox-live.mjs [gemini\|anthropic\|openai]`, `SUBMIT=1` for the forced split | **no** |
| `firefox-run.mjs` | §8.4: the zero-cost run via popup. ⚠️ **no longer works since Firefox 153** — see below; replaced by `firefox-live.mjs` | **no** |

Startup (the extension must be loaded via `web-ext`, and `popup.html` **must** be opened as the
start-url: BiDi refuses to *navigate* to `moz-extension://`):

```
web-ext run --source-dir C:\Users\Admin\ytsfx --firefox-profile C:\Users\Admin\ytsff \
  --keep-profile-changes --no-reload --arg=--remote-debugging-port=9222 \
  --start-url moz-extension://<uuid>/popup.html

EXT_UUID=<uuid> PROVIDER=anthropic node test/e2e/firefox-run.mjs
```

The `<uuid>` is the one **internal to the profile**, not the manifest id: it lives in `prefs.js`
under `extensions.webextensions.uuids`.

⚠️ **This recipe no longer works from Firefox 153 onward** (verified on 2026-07-28). The
`--start-url moz-extension://…` **no longer opens** the popup, and BiDi keeps refusing to
navigate there (`Navigation to "moz-extension://…" is not allowed`): `browsingContext.getTree`
only reports a `chrome://browser/content/blanktab.html` and there's no way in. Also tried
and failed: `browser.startup.homepage` on the profile (web-ext opens an empty tab anyway)
and direct navigation via BiDi.

**The approach that works is `firefox-live.mjs`**: instead of driving the popup from outside, it
injects a few lines into a **throwaway copy** of the extension that kick off the run **from inside
the background** — where the extension APIs already exist — and report over HTTP to a
local collector. Nothing privileged to reach, and the repo isn't touched.

**Three pitfalls already paid for.** BiDi allows **only one session per browser**: without
`session.end` the next run dies with `Maximum number of active sessions` — and a script that
errors out **leaves it open**, so Firefox has to be restarted. `web-ext` won't attach
to a profile without `devtools.debugger.remote-enabled` in `user.js`. And in Git Bash
`C:\...` paths get rewritten: use regular slashes or `MSYS_NO_PATHCONV=1`, otherwise
web-ext looks for the extension at `C:\ytsfx\ytsfx`.

**The trick that makes almost everything free:** with `autoSubmit: false` the content
script pastes part 1 and stops. Claim, TTL, split, status line, `pasteWatch`,
`jobIds` propagation, and the final verdict are all fully exercised — but
no message ever goes out, so no quota is consumed.

**The only two that actually send** are `merge-quality.mjs` and `test-merge.mjs`
(auto-submit ON): 5 messages on the user's account, ~3 minutes. Must be agreed on beforehand.
For the still-open question use `merge-quality.mjs`, the only one that saves the
**content** of the answers — which is what needs to be judged (TESTING-TODO §1.2).

## Time-costly pitfalls

- **Opening tabs in the background skews the results.** The extension uses
  `chrome.tabs.create({ active: true })`. In a background tab Chrome defers
  layout and throttles timers, and `ytsWaitForInput` requires a **visible**
  element: the paste never happens. With `Target.createTarget({ background: true })` this
  test reported failures that the real flow doesn't have. Use `background: false`.
- **Don't seed tiny payloads.** A text of a few dozen characters gets
  pasted and finishes so fast it races against Angular's boot, and the
  result is flaky. Use a realistic size (~25k), which is also the only one
  the user actually sees.
- **Reading `.ql-editor` alone is no longer enough.** With Gemini's redesigned UI
  (2026-07-27) there is more than one candidate and the full one isn't the first: read
  them all and take the longest.

- **Never `| tail`** on a long run: the pipe buffers and it looks stuck. Redirect
  to a file (`> run.log 2>&1`) and read that.
- `measure-cap.mjs` expects the clipboard to be **already filled** from outside
  (`Set-Clipboard` from PowerShell): `navigator.clipboard.writeText()` fails with
  `NotAllowedError` if the window doesn't have focus, which in automation it
  never does.
