// ── LLM API Calls ─────────────────────────────────────────────────────────────

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
    const errBody = await resp.text();
    throw new Error(`${providerName} API error ${resp.status}: ${errBody.slice(0, 300)}`);
  }
  return await resp.json();
}

function trimTranscript(transcript) {
  const MAX_TRANSCRIPT = 120000;
  return transcript.length > MAX_TRANSCRIPT
    ? transcript.slice(0, MAX_TRANSCRIPT) + '\n\n[... transcript truncated ...]'
    : transcript;
}

// Dispatcher: routes to the right provider
export async function callLLM(transcript, settings) {
  const provider = settings.provider || 'anthropic';
  const apiKey = (settings.apiKeys && settings.apiKeys[provider]) || settings.apiKey || '';
  const s = { ...settings, apiKey };

  switch (provider) {
    case 'openai':
      return callOpenAICompat(transcript, s, 'https://api.openai.com/v1/chat/completions', 'OpenAI');
    case 'gemini':
      return callGemini(transcript, s);
    case 'openrouter':
      return callOpenAICompat(transcript, s, 'https://openrouter.ai/api/v1/chat/completions', 'OpenRouter');
    case 'custom': {
      const endpoint = s.customEndpointUrl;
      if (!endpoint) throw new Error('Custom endpoint URL not configured. Set it in Advanced Settings.');
      return callOpenAICompat(transcript, s, endpoint, 'Custom');
    }
    default:
      return callAnthropic(transcript, s);
  }
}

// Anthropic Claude
async function callAnthropic(transcript, settings) {
  const trimmed = trimTranscript(transcript);

  const THINKING_MODELS = ['claude-3-7-sonnet', 'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-8'];
  const useThinking = settings.useThinking && THINKING_MODELS.some(m => settings.model?.startsWith(m));
  const maxTokens = useThinking ? 16000 : 8192;

  const bodyObj = {
    model: settings.model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: `${settings.prompt}\n\n---\n\n${trimmed}` }]
  };
  if (useThinking) {
    bodyObj.thinking = { type: 'enabled', budget_tokens: 4096 };
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };

  const data = await fetchLLM('https://api.anthropic.com/v1/messages', headers, bodyObj, 'Anthropic');
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// OpenAI-compatible (OpenAI, OpenRouter, Custom)
async function callOpenAICompat(transcript, settings, endpoint, providerName) {
  const trimmed = trimTranscript(transcript);
  const model = settings.model;
  
  const bodyObj = {
    model,
    messages: [{ role: 'user', content: `${settings.prompt}\n\n---\n\n${trimmed}` }]
  };
  
  // o1 models use max_completion_tokens; all others use max_tokens
  if (model && model.startsWith('o1')) {
    bodyObj.max_completion_tokens = 8192;
  } else {
    bodyObj.max_tokens = 8192;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.apiKey}`
  };

  const data = await fetchLLM(endpoint, headers, bodyObj, providerName);
  return data.choices?.[0]?.message?.content || '';
}

// Google Gemini
async function callGemini(transcript, settings) {
  const trimmed = trimTranscript(transcript);
  const model = settings.model || 'gemini-2.0-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const bodyObj = {
    contents: [{
      role: 'user',
      parts: [{ text: `${settings.prompt}\n\n---\n\n${trimmed}` }]
    }],
    generationConfig: { maxOutputTokens: 8192 }
  };

  const headers = { 'Content-Type': 'application/json' };

  const data = await fetchLLM(endpoint, headers, bodyObj, 'Gemini');
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}
