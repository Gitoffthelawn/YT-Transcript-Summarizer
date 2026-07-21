// ── LLM API Calls ─────────────────────────────────────────────────────────────
import { CONFIG } from './config.js';

async function fetchLLM(url, headers, bodyObj, providerName) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000); // 3 min timeout

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: headers,
      body: JSON.stringify(bodyObj)
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Timeout ${providerName} API (>3 min)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`${providerName} API error ${resp.status}: ${errBody.slice(0, 300)}`);
  }
  try {
    return await resp.json();
  } catch (e) {
    throw new Error(`${providerName} returned a malformed (non-JSON) response`);
  }
}

/**
 * Clamp the transcript to what the selected provider can take. The old flat
 * 120k-char cap silently dropped the tail of anything longer than ~2 h even on
 * 200k+ token models, and nothing downstream ever learned about it — the .md
 * looked like a summary of the whole video. Callers now receive the flag.
 */
function trimTranscript(transcript, provider) {
  const max = CONFIG.maxTranscriptChars[provider] ?? CONFIG.maxTranscriptChars.default;
  if (transcript.length <= max) {
    return { text: transcript, truncated: false, kept: transcript.length, total: transcript.length };
  }
  return {
    text: transcript.slice(0, max) + '\n\n[... transcript truncated — the video is longer than the model context ...]',
    truncated: true,
    kept: max,
    total: transcript.length
  };
}

function requireKey(apiKey, providerName) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error(`${providerName}: no API key configured (Advanced Settings ⚙️).`);
  }
}

/**
 * Dispatcher: routes to the right provider.
 * @returns {Promise<{summary: string, truncated: boolean, kept: number, total: number}>}
 */
export async function callLLM(transcript, settings) {
  const provider = settings.provider || 'anthropic';
  const apiKey = (settings.apiKeys && settings.apiKeys[provider]) || settings.apiKey || '';
  const s = { ...settings, apiKey };
  const trimmed = trimTranscript(String(transcript ?? ''), provider);

  let summary;
  switch (provider) {
    case 'openai':
      summary = await callOpenAICompat(trimmed.text, s, 'https://api.openai.com/v1/chat/completions', 'OpenAI');
      break;
    case 'gemini':
      summary = await callGemini(trimmed.text, s);
      break;
    case 'openrouter':
      summary = await callOpenAICompat(trimmed.text, s, 'https://openrouter.ai/api/v1/chat/completions', 'OpenRouter');
      break;
    case 'custom': {
      const endpoint = s.customEndpointUrl;
      if (!endpoint) throw new Error('Custom endpoint URL not configured. Set it in Advanced Settings.');
      summary = await callOpenAICompat(trimmed.text, s, endpoint, 'Custom');
      break;
    }
    default:
      summary = await callAnthropic(trimmed.text, s);
  }

  return { summary, truncated: trimmed.truncated, kept: trimmed.kept, total: trimmed.total };
}

// Anthropic Claude
async function callAnthropic(trimmed, settings) {
  requireKey(settings.apiKey, 'Anthropic');

  const model = settings.model || '';
  // Claude 4.6+ takes adaptive thinking; the old fixed `budget_tokens` form was
  // removed on Opus 4.7/4.8, Sonnet 5 and Fable 5 and now returns HTTP 400.
  const ADAPTIVE = /^claude-(fable-5|mythos-5|opus-4-(6|7|8)|sonnet-(5|4-6))/;
  const LEGACY_THINKING = /^claude-(3-7-sonnet|opus-4-5|sonnet-4-5|haiku-4-5)/;
  const useThinking = !!settings.useThinking && (ADAPTIVE.test(model) || LEGACY_THINKING.test(model));
  const maxTokens = useThinking ? 16000 : 8192;

  const bodyObj = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: `${settings.prompt}\n\n---\n\n${trimmed}` }]
  };
  if (useThinking) {
    if (ADAPTIVE.test(model)) {
      bodyObj.thinking = { type: 'adaptive' };
      bodyObj.output_config = { effort: 'high' };
    } else {
      bodyObj.thinking = { type: 'enabled', budget_tokens: 4096 };
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };

  const data = await fetchLLM('https://api.anthropic.com/v1/messages', headers, bodyObj, 'Anthropic');
  // `data.content.filter(...)` used to throw a bare "Cannot read properties of
  // undefined" whenever the shape was unexpected (HTTP 200 with an error body,
  // refusal, empty completion).
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks.filter(b => b?.type === 'text').map(b => b.text || '').join('');
  if (!text.trim()) {
    throw new Error(`Anthropic returned an empty summary (stop_reason: ${data?.stop_reason || 'unknown'})`);
  }
  return text;
}

// OpenAI-compatible (OpenAI, OpenRouter, Custom)
async function callOpenAICompat(trimmed, settings, endpoint, providerName) {
  if (providerName !== 'Custom') requireKey(settings.apiKey, providerName);
  const model = settings.model;
  if (!model) throw new Error(`${providerName}: no model selected.`);

  const bodyObj = {
    model,
    messages: [{ role: 'user', content: `${settings.prompt}\n\n---\n\n${trimmed}` }]
  };

  // o1/o3/gpt-5 style reasoning models use max_completion_tokens; others max_tokens
  if (/^(o\d|gpt-5)/.test(model)) {
    bodyObj.max_completion_tokens = 8192;
  } else {
    bodyObj.max_tokens = 8192;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  const data = await fetchLLM(endpoint, headers, bodyObj, providerName);
  const choice = data?.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (!String(text).trim()) {
    const reason = choice?.finish_reason || data?.error?.message || 'unknown';
    throw new Error(`${providerName} returned an empty summary (finish_reason: ${reason})`);
  }
  return text;
}

// Google Gemini
async function callGemini(trimmed, settings) {
  requireKey(settings.apiKey, 'Gemini');
  const model = settings.model || 'gemini-2.0-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const bodyObj = {
    contents: [{
      role: 'user',
      parts: [{ text: `${settings.prompt}\n\n---\n\n${trimmed}` }]
    }],
    generationConfig: { maxOutputTokens: 16384 }
  };

  // The key travels in a header rather than the query string so it cannot leak
  // through referrers, proxy logs or an error message echoing the URL.
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey };

  const data = await fetchLLM(endpoint, headers, bodyObj, 'Gemini');
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map(p => p?.text || '').join('');
  if (!text.trim()) {
    // On 2.5-family models the thinking tokens are billed against
    // maxOutputTokens, so a small budget yields MAX_TOKENS with no parts at all.
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || 'unknown';
    throw new Error(
      reason === 'MAX_TOKENS'
        ? 'Gemini hit the output limit before writing anything (thinking tokens consumed the budget) — try a shorter summary or another model.'
        : `Gemini returned an empty summary (finishReason: ${reason})`
    );
  }
  return text;
}
