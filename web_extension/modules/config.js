// ── Config ────────────────────────────────────────────────────────────
// Centralized configuration for the YT Transcript Summarizer

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
  
  // Provider Web URLs
  providerWebUrls: {
    anthropic:  'https://claude.ai/new',
    openai:     'https://chatgpt.com/',
    gemini:     'https://gemini.google.com/app',
  }
};

// ── Provider config ───────────────────────────────────────────────────────────
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

// ── Prompts ───────────────────────────────────────────────────────────────────
export const PROMPTS = {
  en: {
    md: {
      short: "Summarize the following video as a markdown file (.md). Focus only on the key takeaways.",
      normal: "Generate a complete and detailed summary of the following video as a markdown file (.md). You must consider the entire video. Make sure you don't leave out any important points, explanations, or details.",
      long: "Generate an in-depth, structured summary of the following video as a markdown file (.md). Cover every section, argument, example, and detail mentioned. Organize the output with clear headings and subheadings. Include topic transitions where relevant. Do not omit anything."
    },
    chat: {
      short: "Summarize the following video. Focus only on the key takeaways.",
      normal: "Generate a complete and detailed summary of the following video. Consider the entire video. Make sure you don't leave out any important points, explanations, or details.",
      long: "Generate an in-depth, structured summary of the following video. Cover every section, argument, example, and detail mentioned. Organize the output with clear sections. Include topic transitions where relevant. Do not omit anything."
    }
  },
  it: {
    md: {
      short: "Riassumi il seguente video in un file markdown (.md). Concentrati solo sui punti chiave.",
      normal: "Genera un riassunto completo e dettagliato del seguente video in un file markdown (.md). Devi considerare l'intero video. Assicurati di non tralasciare alcun punto, spiegazione o dettaglio importante.",
      long: "Genera un riassunto approfondito e strutturato del seguente video in un file markdown (.md). Tratta ogni sezione, argomento, esempio e dettaglio menzionato. Organizza l'output con titoli e sottotitoli chiari. Includi le transizioni tra argomenti dove rilevante. Non omettere nulla."
    },
    chat: {
      short: "Riassumi il seguente video. Concentrati solo sui punti chiave.",
      normal: "Genera un riassunto completo e dettagliato del seguente video. Devi considerare l'intero video. Assicurati di non tralasciare alcun punto, spiegazione o dettaglio importante.",
      long: "Genera un riassunto approfondito e strutturato del seguente video. Tratta ogni sezione, argomento, esempio e dettaglio menzionato. Organizza l'output con sezioni chiare. Includi le transizioni tra argomenti dove rilevante. Non omettere nulla."
    }
  },
  es: {
    md: {
      short: "Resume el siguiente video en un archivo markdown (.md). Céntrate solo en los puntos clave.",
      normal: "Genera un resumen completo y detallado del siguiente video en un archivo markdown (.md). Debes considerar el video completo. Asegúrate de no omitir ningún punto, explicación o detalle importante.",
      long: "Genera un resumen detallado y estructurado del siguiente video en un archivo markdown (.md). Cubre cada sección, argumento, ejemplo y detalle mencionado. Organiza el resultado con títulos y subtítulos claros. Incluye transiciones entre temas donde sea relevante. No omitas nada."
    },
    chat: {
      short: "Resume el siguiente video. Céntrate solo en los puntos clave.",
      normal: "Genera un resumen completo y detallado del siguiente video. Debes considerar el video completo. Asegúrate de no omitir ningún punto, explicación o detalle importante.",
      long: "Genera un resumen detallado y estructurado del siguiente video. Cubre cada sección, argumento, ejemplo y detalle mencionado. Organiza el resultado con secciones claras. Incluye transiciones entre temas donde sea relevante. No omitas nada."
    }
  }
};

export function getPreset(lang, fmt, len = 'normal') {
  const isMD = fmt !== 'chat';
  const langKey = PROMPTS[lang] ? lang : 'en';
  const fmtKey = isMD ? 'md' : 'chat';
  return PROMPTS[langKey][fmtKey][len] || PROMPTS[langKey][fmtKey]['normal'];
}
