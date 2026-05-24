// ── Version ────────────────────────────────────────────────────────────────────
// Automatically read from package.json — bump the version there, not here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const APP_VERSION: string = require("../../package.json").version;

// ── YouTube InnerTube config ───────────────────────────────────────────────────
// Update these values when YouTube changes its internal API versions.
export const CONFIG = {
  youtube: {
    // InnerTube public API key
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    // Known working client versions
    androidClientVersion: "20.10.38",
    androidSdkVersion: 34,
    webClientVersion: "2.20240530.02.00",
    iosClientVersion: "19.45.4",
    iosDeviceModel: "iPhone16,2",
    iosOsVersion: "17.5.1.21F90",
    tvClientVersion: "7.20231021.0.0",
  },

  // ── Provider Web URLs ──────────────────────────────────────────────────────
  // Used when the user wants to open the chat in a new tab instead of via API.
  // Add a new key here if you add a provider with hasWebUI: true in PROVIDERS.
  providerWebUrls: {
    anthropic:  "https://claude.ai/new",
    openai:     "https://chatgpt.com/",
    gemini:     "https://gemini.google.com/app",
  } as Record<string, string>
};

export type ProviderConfig = {
  name: string;
  models: { value: string; label: string }[];
  defaultModel: string;
  supportsThinking: boolean;
  hasWebUI: boolean;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
};

// ── Providers & Models ─────────────────────────────────────────────────────────
// HOW TO ADD A PROVIDER:
//   1. Add a new key below with the required fields.
//   2. If it has a web UI, add its URL to CONFIG.providerWebUrls above.
//   3. If it needs a paste script, create web_extension/<provider>_paste.js
//      and register it in web_extension/manifest.json > content_scripts.
//
// HOW TO ADD/REMOVE A MODEL:
//   - Edit the `models` array of the relevant provider.
//   - Update `defaultModel` if the current default is removed.
// ─────────────────────────────────────────────────────────────────────────────
export const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    name: "Anthropic Claude",
    models: [
      { value: "claude-sonnet-4-6",          label: "claude-sonnet-4-6 (Recommended)" },
      { value: "claude-opus-4-7",             label: "claude-opus-4-7 (Most capable)" },
      { value: "claude-3-7-sonnet-20250219",  label: "claude-3-7-sonnet" },
      { value: "claude-3-5-sonnet-latest",    label: "claude-3-5-sonnet" },
    ],
    defaultModel:      "claude-sonnet-4-6",
    supportsThinking:  true,
    hasWebUI:          true,
    apiKeyLabel:       "API Key",
    apiKeyPlaceholder: "sk-ant-...",
  },
  openai: {
    name: "OpenAI",
    models: [
      { value: "gpt-4o",       label: "gpt-4o (Recommended)" },
      { value: "gpt-4o-mini",  label: "gpt-4o-mini (Fast)" },
      { value: "o1",           label: "o1 (Reasoning)" },
      { value: "o1-mini",      label: "o1-mini" },
      { value: "gpt-4-turbo",  label: "gpt-4-turbo" },
    ],
    defaultModel:      "gpt-4o",
    supportsThinking:  false,
    hasWebUI:          true,
    apiKeyLabel:       "API Key",
    apiKeyPlaceholder: "sk-...",
  },
  gemini: {
    name: "Google Gemini",
    models: [
      { value: "gemini-2.0-flash",  label: "gemini-2.0-flash (Recommended)" },
      { value: "gemini-1.5-pro",    label: "gemini-1.5-pro" },
      { value: "gemini-1.5-flash",  label: "gemini-1.5-flash (Fast)" },
    ],
    defaultModel:      "gemini-2.0-flash",
    supportsThinking:  false,
    hasWebUI:          true,
    apiKeyLabel:       "API Key (Google AI Studio)",
    apiKeyPlaceholder: "AIza...",
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
type PromptsMap = {
  [lang: string]: {
    [fmt: string]: {
      [len: string]: string;
    };
  };
};

export const PROMPTS: PromptsMap = {
  // ── English ──────────────────────────────────────────────────────────────
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
  // ── Italian ───────────────────────────────────────────────────────────────
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
  // ── Spanish ───────────────────────────────────────────────────────────────
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
  }
  // ── Add new languages below following the same structure ──────────────────
};

export function getPreset(lang: string, fmt: string, len: string = "normal"): string {
  const isMD = fmt !== "chat";
  const langKey = PROMPTS[lang] ? lang : "en";
  const fmtKey = isMD ? "md" : "chat";
  return PROMPTS[langKey][fmtKey][len] || PROMPTS[langKey][fmtKey]["normal"];
}
