const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/tg-ai-manager',
  'X-Title': 'TG AI Manager'
};

const KEY_URL = 'https://openrouter.ai/api/v1/key';

const DEPRECATED_MODELS = new Set(['google/gemma-2-9b-it:free']);

const DEFAULT_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

function resolveModel(model) {
  if (!model || DEPRECATED_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
}

async function validateOpenRouterKey(apiKey) {
  const res = await fetch(KEY_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...OPENROUTER_HEADERS
    }
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid API key');
  }
  if (res.status === 402) {
    throw new Error('Insufficient credits on OpenRouter account');
  }
  if (res.status === 429) {
    throw new Error('OpenRouter rate limit during key check — retry in a minute');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body.slice(0, 200) || `OpenRouter HTTP ${res.status}`);
  }

  const payload = await res.json().catch(() => null);
  if (!payload?.data?.label) {
    throw new Error('Unexpected OpenRouter key response');
  }
  return true;
}

module.exports = {
  id: 'openrouter',
  label: 'OpenRouter',
  tierLabel: 'есть бесплатные модели',
  tier: 'free',
  secretFields: [{ key: 'apiKey', label: 'ключ API', placeholder: 'sk-or-...' }],
  defaultModel: DEFAULT_MODEL,
  modelPresets: [
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free'
  ],

  isConfigured(secrets) {
    return Boolean(secrets?.apiKey?.trim());
  },

  async validateConfig(secrets, model) {
    const apiKey = secrets?.apiKey?.trim();
    if (!apiKey) throw new Error('API key required');
    return validateOpenRouterKey(apiKey);
  },

  async summarize(text, { model, secrets }) {
    const { summarizeWithOpenAICompatible } = require('../openaiCompatible');
    return summarizeWithOpenAICompatible({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: secrets.apiKey,
      model: resolveModel(model),
      text,
      extraHeaders: OPENROUTER_HEADERS
    });
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { generateWithOpenAICompatible } = require('../openaiCompatible');
    return generateWithOpenAICompatible({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: secrets.apiKey,
      model: resolveModel(model),
      userPrompt,
      systemPrompt,
      extraHeaders: OPENROUTER_HEADERS
    });
  }
};

module.exports.validateOpenRouterKey = validateOpenRouterKey;
module.exports.OPENROUTER_HEADERS = OPENROUTER_HEADERS;
module.exports.resolveModel = resolveModel;
