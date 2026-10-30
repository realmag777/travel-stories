// Story translation through the configured LLM ("Перекласти" in the admin and MCP).
const db = require('../../core/db');
const llm = require('../../core/llm');

const LANG = { en: 'English', es: 'Spanish' };

async function translateStory(id, locale) {
  if (!LANG[locale]) throw Object.assign(new Error('Unsupported locale'), { status: 400 });
  if (!(await llm.isEnabled())) throw Object.assign(new Error('LLM is not configured: set LLM_PROVIDER and LLM_API_KEY or fill the LLM block in admin settings'), { status: 409 });
  const s = await db('stories').where({ id }).first();
  if (!s) throw Object.assign(new Error('Story not found'), { status: 404 });
  const out = await llm.completeJson({
    system: `You are a professional literary translator. Translate Ukrainian travel stories into natural ${LANG[locale]}. Keep facts, names and paragraph breaks. Reply with JSON only.`,
    prompt: `Translate to ${LANG[locale]}. Return {"title": "...", "article": "...", "region": "..."}.\nTitle (max 110 chars): ${s.title}\nRegion: ${s.region || ''}\nArticle:\n${s.article}`,
    maxTokens: 4000,
    timeoutMs: 90000,
  });
  if (!out.title || !out.article) throw new Error('LLM returned an incomplete translation');
  const patch = { [`title_${locale}`]: String(out.title).slice(0, 120), [`article_${locale}`]: String(out.article).slice(0, 5000), updated_at: db.fn.now() };
  if (out.region && !s[`region_${locale}`]) patch[`region_${locale}`] = String(out.region).slice(0, 80);
  await db('stories').where({ id }).update(patch);
  return patch;
}

module.exports = { translateStory };
