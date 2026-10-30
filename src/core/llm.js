// Minimal LLM client: Anthropic Messages API or any OpenAI-compatible chat endpoint.
// Returns plain text; callers that need JSON use completeJson(), which extracts the first object.
const settings = require('./settings');

const DEFAULT_MODELS = { anthropic: 'claude-haiku-5-5', 'openai-compatible': 'gpt-4o-mini' };

async function isEnabled() {
  const c = await settings.llmConfig();
  return Boolean(c.provider && (c.apiKey || c.provider === 'openai-compatible' && c.baseUrl));
}

async function complete({ system, prompt, maxTokens = 1024, timeoutMs = 20000 }) {
  const c = await settings.llmConfig();
  if (!c.provider) throw new Error('LLM is not configured');
  const model = c.model || DEFAULT_MODELS[c.provider];
  const signal = AbortSignal.timeout(timeoutMs);

  if (c.provider === 'anthropic') {
    const r = await fetch((c.baseUrl || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  if (c.provider === 'openai-compatible') {
    const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`LLM API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  }

  throw new Error(`Unknown LLM_PROVIDER "${c.provider}"`);
}

async function completeJson(opts) {
  const text = await complete(opts);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('LLM returned no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { isEnabled, complete, completeJson };
