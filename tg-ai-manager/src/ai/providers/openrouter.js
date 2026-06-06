const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/tg-ai-manager',
  'X-Title': 'TG AI Manager'
};

const DEPRECATED_MODELS = new Set(['google/gemma-2-9b-it:free']);

const DEFAULT_MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

function resolveModel(model) {
  if (!model || DEPRECATED_MODELS.has(model)) return DEFAULT_MODEL;
  return model;
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
    const { pingOpenAICompatible } = require('../openaiCompatible');
    return pingOpenAICompatible({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: secrets.apiKey,
      model: resolveModel(model),
      extraHeaders: OPENROUTER_HEADERS
    });
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
