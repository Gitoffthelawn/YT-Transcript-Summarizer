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
    webClientVersion: '2.20240530.02.00',
    iosClientVersion: '19.45.4',
    iosDeviceModel: 'iPhone16,2',
    iosOsVersion: '17.5.1.21F90',
    tvClientVersion: '7.20231021.0.0'
  },

  // ── Provider Web URLs ──────────────────────────────────────────────────────
  // Used when the user wants to open the chat in a new tab instead of via API.
  // Add a new key here if you add a provider with hasWebUI: true in PROVIDERS.
  providerWebUrls: {
    anthropic:  'https://claude.ai/new',
    openai:     'https://chatgpt.com/',
    gemini:     'https://gemini.google.com/app',
  }
};

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
      { value: 'claude-sonnet-4-6',          label: 'claude-sonnet-4-6 (Recommended)' },
      { value: 'claude-opus-4-7',             label: 'claude-opus-4-7 (Most capable)' },
      { value: 'claude-3-7-sonnet-20250219',  label: 'claude-3-7-sonnet' },
      { value: 'claude-3-5-sonnet-latest',    label: 'claude-3-5-sonnet' },
    ],
    defaultModel:      'claude-sonnet-4-6',
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
