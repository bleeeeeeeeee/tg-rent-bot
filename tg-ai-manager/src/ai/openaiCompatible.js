const OpenAI = require('openai');
const { SYSTEM_PROMPT, parseSummaryResponse, truncateText } = require('./summarizePrompt');
const { WRITE_SYSTEM_PROMPT, parseWriteResponse } = require('./writePrompt');

function createClient({ baseURL, apiKey, extraHeaders, maxRetries = 0, timeout = 45000 }) {
  return new OpenAI({
    apiKey: apiKey || 'ollama',
    baseURL,
    defaultHeaders: extraHeaders,
    maxRetries,
    timeout
  });
}

function extractJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return '{}';
  if (text.startsWith('{')) return text;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : '{}';
}

async function pingOpenAICompatible({ baseURL, apiKey, model, extraHeaders }) {
  const client = createClient({ baseURL, apiKey, extraHeaders });
  await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'ok' }],
    max_tokens: 5
  });
  return true;
}

async function summarizeWithOpenAICompatible({ baseURL, apiKey, model, text, extraHeaders }) {
  const client = createClient({ baseURL, apiKey, extraHeaders, maxRetries: 1, timeout: 90000 });
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: truncateText(text) }
  ];

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3
    });
    return parseSummaryResponse(response.choices[0]?.message?.content || '{}');
  } catch {
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.3
    });
    return parseSummaryResponse(extractJson(response.choices[0]?.message?.content));
  }
}

async function generateWithOpenAICompatible({
  baseURL,
  apiKey,
  model,
  userPrompt,
  systemPrompt = WRITE_SYSTEM_PROMPT,
  extraHeaders
}) {
  const client = createClient({ baseURL, apiKey, extraHeaders, maxRetries: 1, timeout: 120000 });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: truncateText(userPrompt, 6000) }
  ];

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7
    });
    return parseWriteResponse(response.choices[0]?.message?.content || '{}');
  } catch {
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.7
    });
    return parseWriteResponse(extractJson(response.choices[0]?.message?.content));
  }
}

async function validateOpenAICompatible(opts) {
  return pingOpenAICompatible(opts);
}

module.exports = {
  pingOpenAICompatible,
  summarizeWithOpenAICompatible,
  generateWithOpenAICompatible,
  validateOpenAICompatible
};
