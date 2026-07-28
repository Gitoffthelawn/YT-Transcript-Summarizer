# Driver E2E — pilotare l'estensione vera in Chrome

Nessuna dipendenza: Node 24 ha `WebSocket` globale, quindi bastano ~40 righe di
client CDP (`cdp.mjs`). Puppeteer **non** serve. La ricetta completa, con le
trappole, è in `TESTING-TODO.md` §6.

## Avvio

```bash
# 1. l'estensione va in un path CORTO e SENZA SPAZI
cp -r <repo>/* /c/Users/Admin/ytsx/

# 2. Chrome con la porta di debug
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --user-data-dir=C:/Users/Admin/ytsp --remote-debugging-port=9333 \
  --enable-unsafe-extension-debugging --no-first-run \
  --no-default-browser-check about:blank &

# 3. caricare l'estensione via CDP (--load-extension viene IGNORATO)
node -e "import('./cdp.mjs').then(async m=>{const c=await m.connect(9333);
  console.log(await c.send('Extensions.loadUnpacked',{path:'C:/Users/Admin/ytsx'}));c.close()})"
```

L'id che torna va in `EXT_ID` per tutti gli script sotto.

## Gli script

| file | a cosa serve | invia? |
|---|---|---|
| `cdp.mjs` | client CDP minimo: `connect()`, `send()`, `attach()`, `targets()` | — |
| `drive.mjs` | apre `popup.html`, manda `startBatch`, fa polling dei job | — |
| `long-video.mjs` | §7.5: split di un video da 4h/8h **veri**, senza aprire alcun provider | no |
| `real-run.mjs` | il flusso supportato completo + screenshot del composer | **no** |
| `claim-race.mjs` | §7.8: due tab insieme, lock a 60 s, TTL a 5 min | **no** |
| `combined-live.mjs` | §4.7/§7.6: combined, un report → tutte le righe | **no** |
| `paste-recorder.mjs` | registra ogni valore del composer da prima del content script | **no** |
| `merge-quality.mjs` | §1.2: run di merge completo; dice se i parziali sono stati reincollati e misura quanto di ciascuno sopravvive nel merge. `PROVIDER=gemini\|anthropic\|openai` | **SÌ** |
| `test-merge.mjs` | run completo 4 parti + merge, solo meccanica (senza le risposte) | **SÌ** |
| `merge-run-2026-07-27.txt` | le 5 risposte del run che ha trovato il §4.4 — prova, non script | — |
| `merge-run-2026-07-27-inlined.txt` | le 5 risposte dello stesso run **col fix K**: il prima/dopo del §4.4-ter | — |
| `merge-run-2026-07-28-claude.txt` | le 3 risposte del run su Claude, fix K confermato su un secondo provider | — |
| `merge-run-2026-07-28-chatgpt.txt` | i due parziali su ChatGPT (estratti dal messaggio di merge) e la fusione finale, dopo i fix M e N | — |
| `wait-report.mjs` | aspetta la fine di una sequenza e stampa il verdetto vero | — |
| `peek-all.mjs` | ispeziona tutte le tab Gemini: turni inviati, composer, busy | — |
| `measure-cap.mjs` | misura il cap del composer di un provider | no |
| `gemini-drop.mjs` | prova l'allegato via drop simulato (4-bis, esito negativo) | no |

### Firefox (§8) — è il browser su cui si pubblica

Chrome e Firefox non condividono niente della ricetta qui sopra: su Gecko non esistono
`Extensions.loadUnpacked` né il socket browser di CDP. Il protocollo è **WebDriver BiDi**.

| file | a cosa serve | invia? |
|---|---|---|
| `bidi.mjs` | client BiDi minimo — il gemello di `cdp.mjs`; include il server statico | — |
| `drive-gecko.mjs` | il gemello di `drive.mjs`: trova `popup.html`, manda `startBatch` | — |
| `gecko-paste.html` | banco a tre editor che carica il **vero** `paste_common.js` | no |
| `gecko-paste.mjs` | §8.1: esegue il banco su Firefox — ha trovato il bug O | **no** |
| `chrome-paste.mjs` | la **stessa** pagina su Chrome headless: domanda di regressione | **no** |
| `firefox-run.mjs` | §8.4: il giro a costo zero, `PROVIDER=gemini\|anthropic\|openai` | **no** |

Avvio (l'estensione va caricata da `web-ext`, e `popup.html` **deve** essere aperta come
start-url: BiDi si rifiuta di *navigare* verso `moz-extension://`):

```
web-ext run --source-dir C:\Users\Admin\ytsfx --firefox-profile C:\Users\Admin\ytsff \
  --keep-profile-changes --no-reload --arg=--remote-debugging-port=9222 \
  --start-url moz-extension://<uuid>/popup.html

EXT_UUID=<uuid> PROVIDER=anthropic node test/e2e/firefox-run.mjs
```

L'`<uuid>` è quello **interno al profilo**, non l'id del manifest: sta in `prefs.js`
sotto `extensions.webextensions.uuids`.

**Due trappole già pagate.** BiDi ammette **una sola sessione per browser**: senza
`session.end` il run dopo muore con `Maximum number of active sessions`. E `web-ext` non
si attacca a un profilo senza `devtools.debugger.remote-enabled` in `user.js`.

**Il trucco che rende quasi tutto gratuito:** con `autoSubmit: false` il content
script incolla la parte 1 e si ferma. Claim, TTL, split, riga di stato, `pasteWatch`,
propagazione di `jobIds` e verdetto finale sono tutti esercitati per intero — ma
nessun messaggio parte, quindi non si consuma quota.

**Gli unici due che inviano davvero** sono `merge-quality.mjs` e `test-merge.mjs`
(auto-submit ON): 5 messaggi sull'account dell'utente, ~3 minuti. Da concordare prima.
Per la domanda ancora aperta usare `merge-quality.mjs`, che è l'unico a salvare il
**contenuto** delle risposte — che è ciò che va giudicato (TESTING-TODO §1.2).

## Trappole che costano tempo

- **Aprire le tab in background falsa i risultati.** L'estensione usa
  `chrome.tabs.create({ active: true })`. In una tab di background Chrome differisce
  il layout e limita i timer, e `ytsWaitForInput` pretende un elemento **visibile**:
  il paste non avviene mai. Con `Target.createTarget({ background: true })` questo
  test riportava fallimenti che il flusso vero non ha. Usare `background: false`.
- **Non seminare payload minuscoli.** Un testo di poche decine di caratteri si
  incolla e si esaurisce così in fretta da correre contro il boot di Angular, e il
  risultato è instabile. Usare una taglia realistica (~25k), che è anche l'unica che
  l'utente vede davvero.
- **Leggere `.ql-editor` e basta non basta più.** Con la UI ridisegnata di Gemini
  (2026-07-27) i candidati sono più di uno e quello pieno non è il primo: leggerli
  tutti e prendere il più lungo.

- **Mai `| tail`** su un run lungo: la pipe bufferizza e sembra piantato. Redirigere
  su file (`> run.log 2>&1`) e leggere quello.
- `measure-cap.mjs` si aspetta gli appunti **già pieni** dall'esterno
  (`Set-Clipboard` da PowerShell): `navigator.clipboard.writeText()` fallisce con
  `NotAllowedError` se la finestra non ha il focus, cosa che in automazione non ha
  mai.
