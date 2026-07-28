# Roadmap

Cosa manca a questa estensione rispetto a quello che fanno gli altri, e come si farebbe.
Non sono promesse: sono valutazioni, ciascuna con il suo costo e la trappola che ci si
aspetta — perché è quella che decide se vale la pena.

Due voci, nate da un confronto con la concorrenza fatto il 2026-07-28. Il contesto tecnico
di ogni scelta già presa sta in `NOTES.md` (note di lavoro, non spedite).

---

## 1. Ripiego per i video senza sottotitoli

### Il problema

Oggi, se YouTube non ha caption, `acquireTranscript()` prova le tre strategie, fallisce, e il
job chiude con `⚠️ No transcript available for this video`. Corretto e onesto, ma è un vicolo
cieco: **il video ha comunque un audio**. I casi reali sono lezioni, dirette, canali piccoli,
lingue minori — cioè spesso proprio i video che uno vorrebbe riassumere, perché non li ha
già riassunti nessun altro.

### Chi lo fa, e come

Nessuna **estensione** lo fa. Lo fanno i progetti a runtime locale o server, sempre con lo
stesso schema:

| progetto | schema |
|---|---|
| [AI-Video-Transcriber](https://github.com/wendy7756/AI-Video-Transcriber) | caption native se ci sono; **Whisper solo come ripiego**, così il caso comune resta istantaneo |
| [YouTube-Video-Summarizer](https://github.com/EbrahimAR/YouTube-Video-Summarizer) | `yt-dlp` scarica l'audio → **Faster-Whisper** trascrive → Gemini riassume |
| [Llama2YT](https://github.com/Siris2314/Llama2YT) | Whisper + Llama-2 in locale |
| [steipete/summarize](https://github.com/steipete/summarize) | CLI + estensione: il lavoro pesante sta nella CLI, l'estensione è solo la faccia |

Il consenso pratico [2026](https://roundproxies.com/blog/scrape-youtube/) è: `yt-dlp` come
default, InnerTube quando serve, Playwright solo contro i CAPTCHA. Noi siamo già su
InnerTube con tre strategie e controllo di copertura — **su questo pezzo siamo messi bene**,
il buco è solo il "niente caption".

### Come si farebbe qui — e perché è la voce più difficile

⚠️ **In un'estensione pura non si può.** Servono `yt-dlp` (o comunque un download del flusso
audio) e un modello di trascrizione: nessuno dei due gira in un service worker MV3. Le tre
strade, in ordine di realismo:

**A. Helper locale opzionale (consigliata).** Un piccolo server su `127.0.0.1` — `yt-dlp` +
`faster-whisper` — e l'estensione ci parla solo quando le tre strategie hanno fallito.
- `optional_host_permissions` ha già `http://localhost/*` e `http://127.0.0.1/*`: **il
  permesso c'è già**, ed è lo stesso schema del provider `custom`, che punta già a un
  endpoint locale (Ollama). Quindi il precedente architetturale esiste.
- Innesto: una quarta voce in `acquireTranscript()`, `['S4-LocalWhisper', fetchViaLocalHelper]`,
  che parte solo se `best === null`. Zero rischio sul percorso normale.
- Il risultato deve rientrare nel formato di `parseTranscript` (o almeno `{text, endMs}`),
  così i timestamp del §3 continuano a funzionare: Whisper restituisce i segmenti con
  `start`, quindi basta mapparli su `pushCue(cues, seg.text, seg.start * 1000)`.
- Costo vero: **la distribuzione**. Va scritto, impacchettato e fatto installare (Python o
  un binario). L'estensione diventa "estensione + programma", ed è un'altra categoria di
  prodotto. Da fare solo se il canale «lezioni e dirette senza caption» ti interessa davvero.

**B. Whisper nel browser** (`transformers.js`, whisper-tiny in WASM/WebGPU). Niente da
installare. Ma: il download del modello è di centinaia di MB, la trascrizione di un video da
due ore è **lentissima** su CPU, e comunque **manca lo stream audio** — che è il muro vero.

**C. API di trascrizione a pagamento** (Deepgram, AssemblyAI, Groq Whisper). Poche righe di
codice, ma serve di nuovo l'audio, e introduce un costo per minuto in un'estensione che oggi
può girare a costo zero (modalità Web). Contro la sua stessa proposta di valore.

⚠️ **Il muro comune a tutte e tre è lo stesso: procurarsi l'audio.** Gli URL di
`googlevideo.com` sono firmati, a scadenza, e legati al client che ha chiesto il player
response; e da qualche tempo la parte più protetta richiede attestazione (PO token / DroidGuard).
`yt-dlp` insegue quella superficie a tempo pieno ed è per questo che l'opzione A lo delega a
lui invece di rifarlo. **Prima di scrivere una riga di codice**: verificare che l'URL audio
ottenuto dal player response che già scarichiamo (`fetchViaAndroidPlayer`) sia ancora
scaricabile senza attestazione. Se non lo è, A resta l'unica strada e il lavoro è tutto
nell'helper.

**Prerequisito legale/policy, non tecnico:** scaricare il flusso audio è un'altra cosa
rispetto a leggere i sottotitoli. Da rileggere §4.5 (dichiarazione dati su AMO) e i termini
degli store prima di impegnarsi.

---

## 2. Ricerca nei sottotitoli e riassunti per capitolo

Molto più economica della prima, e con un pezzo **già in casa**.

### Il problema

Il riassunto è un blocco unico. Chi guarda un video da due ore vuole due cose che oggi non
ha: *«dove parla di X?»* e *«riassumimi solo il capitolo 3»*.

### Chi lo fa

- [BibiGPT](https://bibigpt.co/en/blog/posts/best-youtube-ai-summarizer-chrome-extensions) —
  è esattamente la sua proposta: riassunti **per capitolo** in pagina, **ricerca nei
  sottotitoli**, traduzione in un clic, tutto nella sidebar di YouTube.
- [Eightify](https://www.notelm.ai/blog/youtube-summary-chrome-extension) — «key insights»
  con timestamp cliccabili (~$9,99/mese).
- [NoteGPT / Recall](https://www.recall.it/post/best-youtube-video-summarizers) — timestamp,
  mappe mentali, sincronizzazione su Notion.

### Come si farebbe qui

**2a — Capitoli (il pezzo facile).** I capitoli di YouTube sono **già dentro** la risposta
del player che scarichiamo: `playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer`
→ `chapters[]`, con `title` e `timeRangeStartMillis`. Non serve nessuna richiesta in più: si
estraggono con lo stesso `deepFind()` che c'è già in `background.js`.

Poi, due usi indipendenti, ed è meglio farli in quest'ordine:

1. **Passarli al modello come scaletta.** Un blocco `## Capitoli` in testa alla trascrizione
   (titolo + `[m:ss]`): costa qualche centinaio di caratteri e dà al modello la struttura
   dell'autore invece di fargliela indovinare. Ha ottime probabilità di migliorare i
   riassunti lunghi da solo, ed è mezz'ora di lavoro. **Da provare per primo.**
2. **Tagliare per capitolo invece che per lunghezza.** `splitTranscript()` oggi taglia in
   fette uguali cercando un `\n` vicino al confine. Con i timestamp del §3 **si può tagliare
   sui capitoli**: ogni parte diventa un capitolo (o un gruppo di capitoli sotto il cap del
   composer), e i riassunti parziali diventano riassunti *di qualcosa*, non di una fetta
   arbitraria a metà frase.
   ⚠️ La struttura dei fix K/N va rispettata: `plannedChunkCount` deve continuare a
   comandare sul **numero** di parti (è quello che tiene i messaggi dentro il cap del
   composer), quindi il taglio per capitoli è un *raffinamento del confine*, non un modo
   alternativo di decidere quante parti fare. Se i capitoli sono più dei chunk consentiti, si
   raggruppano; se sono meno, si tiene il taglio attuale dentro il capitolo. Test da scrivere
   per primo: **nessun carattere perso** (quello in `chunking.test.mjs` è già pronto da
   copiare).

**2b — Ricerca nei sottotitoli.** Un campo di ricerca nel popup che filtra le righe della
trascrizione e mostra i risultati con il `[m:ss]` cliccabile che ora abbiamo. È
**interamente locale**: nessun modello, nessuna chiamata, nessun costo. Il pezzo mancante è
solo *dove tenerla*: oggi la trascrizione non viene conservata (finisce in un file o in una
chat), quindi serve una cache per video in `storage.local` — c'è già `unlimitedStorage`.

⚠️ Il vero limite di 2b è che vive nel **popup**, mentre da BibiGPT in giù tutti stanno
**nella pagina di YouTube**. Una ricerca nei sottotitoli in un popup che si chiude a ogni
clic fuori è molto meno utile. Se si fa 2b, il passo dopo è quasi obbligato: un pannello
iniettato in `youtube.com/watch` — che però è il lavoro grosso (nuovo content script, nuovo
ciclo di vita, la SPA di YouTube che non ricarica mai la pagina, e la manutenzione che ne
segue).

---

## Ordine consigliato

1. **Capitoli come scaletta nel prompt** (2a.1) — mezz'ora, nessun rischio, migliora subito i
   riassunti lunghi.
2. **Taglio per capitolo** (2a.2) — mezza giornata, tocca `splitTranscript` (percorso
   delicato: coperto dai test, ma leggere i fix K/N in NOTES §3.4/§3.6 prima).
3. **Ricerca nei sottotitoli** (2b) — solo se si è disposti ad andare verso il pannello in
   pagina, altrimenti resta una mezza feature.
4. **Whisper** (1) — solo se il pubblico «video senza caption» conta davvero, e solo per la
   via A. È un cambio di categoria di prodotto, non una feature.
