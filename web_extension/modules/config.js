// ── Config ─────────────────────────────────────────────────────────────────────
// Centralized configuration for the YT Transcript Summarizer extension.

// ── YouTube InnerTube config ───────────────────────────────────────────────────
// Update these values when YouTube changes its internal API versions.
export const CONFIG = {
  youtube: {
    // InnerTube public API key
    apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    // Known working client versions
    androidClientVersion: '20.10.38',
    androidSdkVersion: 34,
    // IOS is a second, independent attestation path (iOSGuard vs DroidGuard):
    // when YouTube tightens PO-token enforcement on ANDROID, IOS often still
    // returns caption tracks. Verified working without a PO token.
    iosClientVersion: '20.10.4',
    iosDeviceModel: 'iPhone16,2',
    webClientVersion: '2.20240530.02.00'
  },

  // ── Provider Web URLs ──────────────────────────────────────────────────────
  // Used when the user wants to open the chat in a new tab instead of via API.
  // Add a new key here if you add a provider with hasWebUI: true in PROVIDERS.
  providerWebUrls: {
    anthropic:  'https://claude.ai/new',
    openai:     'https://chatgpt.com/',
    gemini:     'https://gemini.google.com/app',
  },

  transcript: {
    // A caption track is accepted only if its last cue lands within this fraction
    // of the video's real duration. YouTube sometimes serves a partial timedtext
    // body (expired URL / partial PO-token enforcement); without this check a
    // half-transcript would be summarized as if it were the whole video.
    minCoverage: 0.80,
    // Cue texts that are pure sound annotations and carry no speech. Only these
    // are dropped — a blanket /^\[.*\]$/ filter also removed legitimate lines
    // (stage directions, speaker labels) present in many manual caption tracks.
    noiseCues: /^\[(music|musica|música|musique|musik|applause|applausi|aplausos|applaudissements|laughter|risate|risas|rires|silence|silenzio|no audio|sound effects?|[^\]]*\bmusic\b[^\]]*)\]$/i
  },

  // Per-provider transcript budget, in characters. The old flat 120k cap silently
  // dropped the tail of any video longer than ~2 h even on 200k+ token models.
  // Values leave generous room for the prompt and the response.
  maxTranscriptChars: {
    anthropic:  500000,   // 200k-token context
    openai:     350000,   // 128k-token context
    gemini:     900000,   // 1M-token context
    openrouter: 300000,   // unknown model — conservative
    custom:     200000,   // typically a small local model
    default:    200000
  },

  // Optional manual splitting of a long transcript into several sequential API
  // calls. Off by default (parts = 1): it multiplies cost and latency, and only
  // pays off on videos long enough that one call would truncate or lose detail.
  chunking: {
    maxParts:         20,      // upper bound for the UI / sanitizer
    defaultParts:     1,       // 1 = disabled
    defaultMinChars:  100000   // don't split anything shorter than this
  }
};

// Wording injected around each chunk when a transcript is split. Keyed like
// PROMPTS so the partial summaries stay in the user's language; falls back to
// English for any language without an entry.
// `instruction` rides along with each chunk; `mergeChat` is the extra message
// sent to a web chat once every part has been posted (the conversation itself
// holds the partial summaries); `mergeApi` heads the final API call, which is
// followed by the partial summaries as text.
export const CHUNK_NOTES = {
  en: {
    part: 'Part',
    instruction: (i, n) => `This is part ${i} of ${n} of the transcript of ONE single video. Summarize only this part, following the instructions above. Do not write an introduction or a conclusion about the whole video — the parts will be joined together afterwards.`,
    mergeChat: (n) => `You have now seen all ${n} parts of the video. Write a SINGLE unified summary of the whole video, merging the ${n} partial summaries above: remove repetitions, keep every distinct point, and follow the formatting requested at the start. Output only the final summary.`,
    mergeApi: (n) => `Below are ${n} partial summaries of consecutive parts of ONE single video. Merge them into a SINGLE unified summary of the whole video: remove repetitions, keep every distinct point, and follow the formatting requested above. Output only the final summary.`
  },
  it: {
    part: 'Parte',
    instruction: (i, n) => `Questa è la parte ${i} di ${n} della trascrizione di UN SOLO video. Riassumi solo questa parte, seguendo le istruzioni sopra. Non scrivere introduzioni o conclusioni sull'intero video — le parti verranno unite successivamente.`,
    mergeChat: (n) => `Ora hai visto tutte le ${n} parti del video. Scrivi UN UNICO riassunto complessivo dell'intero video, unendo i ${n} riassunti parziali qui sopra: elimina le ripetizioni, conserva ogni punto distinto e rispetta il formato richiesto all'inizio. Restituisci solo il riassunto finale.`,
    mergeApi: (n) => `Qui sotto trovi ${n} riassunti parziali di parti consecutive di UN SOLO video. Uniscili in UN UNICO riassunto complessivo dell'intero video: elimina le ripetizioni, conserva ogni punto distinto e rispetta il formato richiesto sopra. Restituisci solo il riassunto finale.`
  },
  es: {
    part: 'Parte',
    instruction: (i, n) => `Esta es la parte ${i} de ${n} de la transcripción de UN SOLO video. Resume únicamente esta parte, siguiendo las instrucciones anteriores. No escribas una introducción ni una conclusión sobre el video completo — las partes se unirán después.`,
    mergeChat: (n) => `Ya has visto las ${n} partes del video. Escribe UN ÚNICO resumen unificado del video completo, fusionando los ${n} resúmenes parciales anteriores: elimina las repeticiones, conserva todos los puntos distintos y respeta el formato pedido al principio. Devuelve solo el resumen final.`,
    mergeApi: (n) => `A continuación hay ${n} resúmenes parciales de partes consecutivas de UN SOLO video. Fusiónalos en UN ÚNICO resumen del video completo: elimina las repeticiones, conserva todos los puntos distintos y respeta el formato pedido arriba. Devuelve solo el resumen final.`
  },
  fr: {
    part: 'Partie',
    instruction: (i, n) => `Ceci est la partie ${i} sur ${n} de la transcription d'UNE SEULE vidéo. Résume uniquement cette partie, en suivant les instructions ci-dessus. N'écris ni introduction ni conclusion sur la vidéo entière — les parties seront assemblées ensuite.`,
    mergeChat: (n) => `Tu as maintenant vu les ${n} parties de la vidéo. Rédige UN SEUL résumé unifié de la vidéo entière, en fusionnant les ${n} résumés partiels ci-dessus : supprime les répétitions, conserve chaque point distinct et respecte le format demandé au début. Ne renvoie que le résumé final.`,
    mergeApi: (n) => `Voici ${n} résumés partiels de parties consécutives d'UNE SEULE vidéo. Fusionne-les en UN SEUL résumé de la vidéo entière : supprime les répétitions, conserve chaque point distinct et respecte le format demandé ci-dessus. Ne renvoie que le résumé final.`
  },
  de: {
    part: 'Teil',
    instruction: (i, n) => `Dies ist Teil ${i} von ${n} des Transkripts EINES einzigen Videos. Fasse nur diesen Teil zusammen und folge dabei den obigen Anweisungen. Schreibe keine Einleitung und kein Fazit über das gesamte Video — die Teile werden anschließend zusammengefügt.`,
    mergeChat: (n) => `Du hast jetzt alle ${n} Teile des Videos gesehen. Schreibe EINE einzige zusammenhängende Zusammenfassung des gesamten Videos, indem du die ${n} Teilzusammenfassungen oben zusammenführst: entferne Wiederholungen, behalte jeden eigenständigen Punkt und halte dich an das anfangs geforderte Format. Gib nur die finale Zusammenfassung aus.`,
    mergeApi: (n) => `Unten stehen ${n} Teilzusammenfassungen aufeinanderfolgender Abschnitte EINES einzigen Videos. Führe sie zu EINER einzigen Zusammenfassung des gesamten Videos zusammen: entferne Wiederholungen, behalte jeden eigenständigen Punkt und halte dich an das oben geforderte Format. Gib nur die finale Zusammenfassung aus.`
  },
  pt: {
    part: 'Parte',
    instruction: (i, n) => `Esta é a parte ${i} de ${n} da transcrição de UM único vídeo. Resume apenas esta parte, seguindo as instruções acima. Não escrevas uma introdução nem uma conclusão sobre o vídeo inteiro — as partes serão unidas depois.`,
    mergeChat: (n) => `Já viste as ${n} partes do vídeo. Escreve UM ÚNICO resumo unificado do vídeo inteiro, juntando os ${n} resumos parciais acima: elimina repetições, mantém todos os pontos distintos e respeita o formato pedido no início. Devolve apenas o resumo final.`,
    mergeApi: (n) => `Abaixo estão ${n} resumos parciais de partes consecutivas de UM único vídeo. Junta-os num ÚNICO resumo do vídeo inteiro: elimina repetições, mantém todos os pontos distintos e respeita o formato pedido acima. Devolve apenas o resumo final.`
  }
};

export function chunkNotes(lang) {
  return CHUNK_NOTES[lang] || CHUNK_NOTES.en;
}

// ── Providers & Models ─────────────────────────────────────────────────────────
// HOW TO ADD A PROVIDER:
//   1. Add a new key below with the required fields.
//   2. If it has a web UI, add its URL to CONFIG.providerWebUrls above.
//   3. If it needs a paste script, create <provider>_paste.js in the extension
//      root and register it in manifest.json > content_scripts.
//
// HOW TO ADD/REMOVE A MODEL:
//   - Edit the `models` array of the relevant provider.
//   - Update `defaultModel` if the current default is removed.
// ─────────────────────────────────────────────────────────────────────────────
export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    models: [
      { value: 'claude-opus-4-8',   label: 'claude-opus-4-8 (Recommended)' },
      { value: 'claude-sonnet-5',   label: 'claude-sonnet-5 (Fast + capable)' },
      { value: 'claude-haiku-4-5',  label: 'claude-haiku-4-5 (Cheapest)' },
      { value: 'claude-opus-4-7',   label: 'claude-opus-4-7' },
      { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
    ],
    defaultModel:      'claude-opus-4-8',
    supportsThinking:  true,
    hasWebUI:          true,
    apiKeyLabel:       'API Key',
    apiKeyPlaceholder: 'sk-ant-...',
  },
  openai: {
    name: 'OpenAI',
    models: [
      { value: 'gpt-4o',       label: 'gpt-4o (Recommended)' },
      { value: 'gpt-4o-mini',  label: 'gpt-4o-mini (Fast)' },
      { value: 'o1',           label: 'o1 (Reasoning)' },
      { value: 'o1-mini',      label: 'o1-mini' },
      { value: 'gpt-4-turbo',  label: 'gpt-4-turbo' },
    ],
    defaultModel:      'gpt-4o',
    supportsThinking:  false,
    hasWebUI:          true,
    apiKeyLabel:       'API Key',
    apiKeyPlaceholder: 'sk-...',
  },
  gemini: {
    name: 'Google Gemini',
    models: [
      { value: 'gemini-2.0-flash',  label: 'gemini-2.0-flash (Recommended)' },
      { value: 'gemini-1.5-pro',    label: 'gemini-1.5-pro' },
      { value: 'gemini-1.5-flash',  label: 'gemini-1.5-flash (Fast)' },
    ],
    defaultModel:      'gemini-2.0-flash',
    supportsThinking:  false,
    hasWebUI:          true,
    apiKeyLabel:       'API Key (Google AI Studio)',
    apiKeyPlaceholder: 'AIza...',
  },
  openrouter: {
    name: 'OpenRouter',
    models: [
      { value: 'anthropic/claude-sonnet-4-6',          label: 'claude-sonnet-4-6' },
      { value: 'openai/gpt-4o',                        label: 'gpt-4o' },
      { value: 'google/gemini-2.0-flash-exp',          label: 'gemini-2.0-flash' },
      { value: 'meta-llama/llama-3.3-70b-instruct',    label: 'llama-3.3-70b' },
      { value: 'mistralai/mistral-large',              label: 'mistral-large' },
    ],
    defaultModel:      'anthropic/claude-sonnet-4-6',
    supportsThinking:  false,
    hasWebUI:          false,
    apiKeyLabel:       'API Key',
    apiKeyPlaceholder: 'sk-or-...',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    models:            [],
    defaultModel:      '',
    supportsThinking:  false,
    hasWebUI:          false,
    apiKeyLabel:       'API Key (optional)',
    apiKeyPlaceholder: '...',
  },
};

// ── Prompts ────────────────────────────────────────────────────────────────────
// HOW TO ADD A LANGUAGE:
//   1. Add a new top-level key using the ISO 639-1 code (e.g. "fr", "de", "pt").
//   2. Copy the structure from an existing language block (md + chat, each with
//      short / normal / long variants) and translate the prompt text.
//   3. The UI will automatically pick up the new language — no other changes needed.
//
// HOW TO EDIT A PROMPT:
//   - Find the language key (e.g. "en"), then the format ("md" or "chat"),
//     then the length ("short", "normal", "long") and update the string.
// ─────────────────────────────────────────────────────────────────────────────
export const PROMPTS = {
  // ── English ────────────────────────────────────────────────────────────────
  en: {
    md: {
      short:  "Summarize the following video as a markdown file (.md). Focus only on the key takeaways.",
      normal: "Generate a complete and detailed summary of the following video as a markdown file (.md). You must consider the entire video. Make sure you don't leave out any important points, explanations, or details.",
      long:   "Generate an in-depth, structured summary of the following video as a markdown file (.md). Cover every section, argument, example, and detail mentioned. Organize the output with clear headings and subheadings. Include topic transitions where relevant. Do not omit anything."
    },
    chat: {
      short:  "Summarize the following video. Focus only on the key takeaways.",
      normal: "Generate a complete and detailed summary of the following video. Consider the entire video. Make sure you don't leave out any important points, explanations, or details.",
      long:   "Generate an in-depth, structured summary of the following video. Cover every section, argument, example, and detail mentioned. Organize the output with clear sections. Include topic transitions where relevant. Do not omit anything."
    }
  },
  // ── Italian ────────────────────────────────────────────────────────────────
  it: {
    md: {
      short:  "Riassumi il seguente video in un file markdown (.md). Concentrati solo sui punti chiave.",
      normal: "Genera un riassunto completo e dettagliato del seguente video in un file markdown (.md). Devi considerare l'intero video. Assicurati di non tralasciare alcun punto, spiegazione o dettaglio importante.",
      long:   "Genera un riassunto approfondito e strutturato del seguente video in un file markdown (.md). Tratta ogni sezione, argomento, esempio e dettaglio menzionato. Organizza l'output con titoli e sottotitoli chiari. Includi le transizioni tra argomenti dove rilevante. Non omettere nulla."
    },
    chat: {
      short:  "Riassumi il seguente video. Concentrati solo sui punti chiave.",
      normal: "Genera un riassunto completo e dettagliato del seguente video. Devi considerare l'intero video. Assicurati di non tralasciare alcun punto, spiegazione o dettaglio importante.",
      long:   "Genera un riassunto approfondito e strutturato del seguente video. Tratta ogni sezione, argomento, esempio e dettaglio menzionato. Organizza l'output con sezioni chiare. Includi le transizioni tra argomenti dove rilevante. Non omettere nulla."
    }
  },
  // ── Spanish ────────────────────────────────────────────────────────────────
  es: {
    md: {
      short:  "Resume el siguiente video en un archivo markdown (.md). Céntrate solo en los puntos clave.",
      normal: "Genera un resumen completo y detallado del siguiente video en un archivo markdown (.md). Debes considerar el video completo. Asegúrate de no omitir ningún punto, explicación o detalle importante.",
      long:   "Genera un resumen detallado y estructurado del siguiente video en un archivo markdown (.md). Cubre cada sección, argumento, ejemplo y detalle mencionado. Organiza el resultado con títulos y subtítulos claros. Incluye transiciones entre temas donde sea relevante. No omitas nada."
    },
    chat: {
      short:  "Resume el siguiente video. Céntrate solo en los puntos clave.",
      normal: "Genera un resumen completo y detallado del siguiente video. Debes considerar el video completo. Asegúrate de no omitir ningún punto, explicación o detalle importante.",
      long:   "Genera un resumen detallado y estructurado del siguiente video. Cubre cada sección, argumento, ejemplo y detalle mencionado. Organiza el resultado con secciones claras. Incluye transiciones entre temas donde sea relevante. No omitas nada."
    }
  },
  // ── French ───────────────────────────────────────────────────────────────
  fr: {
    md: {
      short:  "Résume la vidéo suivante dans un fichier markdown (.md). Concentre-toi uniquement sur les points clés.",
      normal: "Génère un résumé complet et détaillé de la vidéo suivante dans un fichier markdown (.md). Considère l'intégralité de la vidéo. Assure-toi de ne manquer aucun point, explication ou détail important.",
      long:   "Génère un résumé approfondi et structuré de la vidéo suivante dans un fichier markdown (.md). Couvre chaque section, argument, exemple et détail mentionné. Organise le résultat avec des titres et sous-titres clairs. Inclus les transitions entre sujets lorsque c'est pertinent. N'omets rien."
    },
    chat: {
      short:  "Résume la vidéo suivante. Concentre-toi uniquement sur les points clés.",
      normal: "Génère un résumé complet et détaillé de la vidéo suivante. Considère l'intégralité de la vidéo. Assure-toi de ne manquer aucun point, explication ou détail important.",
      long:   "Génère un résumé approfondi et structuré de la vidéo suivante. Couvre chaque section, argument, exemple et détail mentionné. Organise le résultat avec des sections claires. Inclus les transitions entre sujets lorsque c'est pertinent. N'omets rien."
    }
  },
  // ── German ────────────────────────────────────────────────────────────────
  de: {
    md: {
      short:  "Fasse das folgende Video als Markdown-Datei (.md) zusammen. Konzentriere dich nur auf die wichtigsten Punkte.",
      normal: "Erstelle eine vollständige und detaillierte Zusammenfassung des folgenden Videos als Markdown-Datei (.md). Berücksichtige das gesamte Video. Stelle sicher, dass du keine wichtigen Punkte, Erklärungen oder Details auslässt.",
      long:   "Erstelle eine ausführliche, strukturierte Zusammenfassung des folgenden Videos als Markdown-Datei (.md). Erfasse jeden Abschnitt, jedes Argument, Beispiel und Detail. Organisiere die Ausgabe mit klaren Überschriften und Unterüberschriften. Füge Themenübergänge ein, wo relevant. Lasse nichts aus."
    },
    chat: {
      short:  "Fasse das folgende Video zusammen. Konzentriere dich nur auf die wichtigsten Punkte.",
      normal: "Erstelle eine vollständige und detaillierte Zusammenfassung des folgenden Videos. Berücksichtige das gesamte Video. Stelle sicher, dass du keine wichtigen Punkte, Erklärungen oder Details auslässt.",
      long:   "Erstelle eine ausführliche, strukturierte Zusammenfassung des folgenden Videos. Erfasse jeden Abschnitt, jedes Argument, Beispiel und Detail. Organisiere die Ausgabe mit klaren Abschnitten. Füge Themenübergänge ein, wo relevant. Lasse nichts aus."
    }
  },
  // ── Portuguese ────────────────────────────────────────────────────────────
  pt: {
    md: {
      short:  "Resume o seguinte vídeo num ficheiro markdown (.md). Concentra-te apenas nos pontos principais.",
      normal: "Gera um resumo completo e detalhado do seguinte vídeo num ficheiro markdown (.md). Considera o vídeo na íntegra. Certifica-te de que não omites nenhum ponto, explicação ou detalhe importante.",
      long:   "Gera um resumo aprofundado e estruturado do seguinte vídeo num ficheiro markdown (.md). Aborda cada secção, argumento, exemplo e detalhe mencionado. Organiza o resultado com títulos e subtítulos claros. Inclui as transições entre temas onde relevante. Não omitas nada."
    },
    chat: {
      short:  "Resume o seguinte vídeo. Concentra-te apenas nos pontos principais.",
      normal: "Gera um resumo completo e detalhado do seguinte vídeo. Considera o vídeo na íntegra. Certifica-te de que não omites nenhum ponto, explicação ou detalhe importante.",
      long:   "Gera um resumo aprofundado e estruturado do seguinte vídeo. Aborda cada secção, argumento, exemplo e detalhe mencionado. Organiza o resultado com secções claras. Inclui as transições entre temas onde relevante. Não omitas nada."
    }
  }
  // ── Add new languages below following the same structure ──────────────────
};

export function getPreset(lang, fmt, len = 'normal') {
  const isMD = fmt !== 'chat';
  const langKey = PROMPTS[lang] ? lang : 'en';
  const fmtKey = isMD ? 'md' : 'chat';
  return PROMPTS[langKey][fmtKey][len] || PROMPTS[langKey][fmtKey]['normal'];
}

export function isPreset(text) {
  if (!text) return false;
  const trimmed = text.trim();
  for (const lang of Object.values(PROMPTS)) {
    for (const fmt of Object.values(lang)) {
      for (const preset of Object.values(fmt)) {
        if (preset.trim() === trimmed) return true;
      }
    }
  }
  return false;
}
