const { pingOpenAICompatible, summarizeWithOpenAICompatible, generateWithOpenAICompatible } = require('../openaiCompatible');

function normalizeBaseUrl(url) {
  let base = String(url || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('baseUrl required');
  if (!base.endsWith('/v1')) base = `${base}/v1`;
  return base;
}

function buildCustomProvider(config) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const defaultModel = config.defaultModel || 'gpt-4o-mini';
  const requiresKey = config.requiresKey !== false;

  return {
    id: config.id,
    label: config.label,
    tierLabel: 'custom',
    tier: 'custom',
    isCustom: true,
    secretFields: [{ key: 'apiKey', label: 'API key', placeholder: 'sk-...' }],
    defaultModel,
    modelPresets: config.modelPresets?.length ? config.modelPresets : [defaultModel],
    baseUrl,

    isConfigured(secrets) {
      if (!requiresKey) return true;
      return Boolean(secrets?.apiKey?.trim());
    },

    _apiKey(secrets) {
      const key = secrets?.apiKey?.trim();
      if (key) return key;
      if (!requiresKey) return 'no-key';
      return '';
    },

    async validateConfig(secrets, model) {
      return pingOpenAICompatible({
        baseURL: baseUrl,
        apiKey: this._apiKey(secrets),
        model: model || defaultModel
      });
    },

    async summarize(text, { model, secrets }) {
      return summarizeWithOpenAICompatible({
        baseURL: baseUrl,
        apiKey: this._apiKey(secrets),
        model: model || defaultModel,
        text
      });
    },

    async generate(userPrompt, { model, secrets, systemPrompt }) {
      return generateWithOpenAICompatible({
        baseURL: baseUrl,
        apiKey: this._apiKey(secrets),
        model: model || defaultModel,
        userPrompt,
        systemPrompt
      });
    }
  };
}

module.exports = { buildCustomProvider, normalizeBaseUrl };
