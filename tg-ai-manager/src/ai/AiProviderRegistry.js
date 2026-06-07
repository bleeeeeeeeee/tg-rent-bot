const openai = require('./providers/openai');
const gemini = require('./providers/gemini');
const groq = require('./providers/groq');
const ollama = require('./providers/ollama');
const openrouter = require('./providers/openrouter');
const deepseek = require('./providers/deepseek');
const mistral = require('./providers/mistral');
const { buildCustomProvider } = require('./providers/customOpenAI');

const BUILTIN = [gemini, groq, ollama, openrouter, deepseek, openai, mistral];
const BUILTIN_BY_ID = Object.fromEntries(BUILTIN.map((p) => [p.id, p]));

class AiProviderRegistry {
  static _custom = [];

  static async refreshCustom() {
    const SettingsService = require('../services/SettingsService');
    const configs = await SettingsService.getCustomProviders();
    this._custom = configs.map((c) => buildCustomProvider(c));
  }

  static listAll() {
    return [...BUILTIN, ...this._custom];
  }

  static listBuiltin() {
    return BUILTIN;
  }

  static get(id) {
    return BUILTIN_BY_ID[id] || this._custom.find((p) => p.id === id) || null;
  }

  static getLabel(id, options = {}) {
    const { withTier = true } = options;
    const p = this.get(id);
    if (!p) return id;
    if (!withTier || !p.tierLabel) return p.label;
    return `${p.label} (${p.tierLabel})`;
  }

  static isConfigured(id, secrets) {
    const provider = this.get(id);
    if (!provider || !secrets) return false;
    return provider.isConfigured(secrets);
  }

  static isCustom(id) {
    return String(id || '').startsWith('custom_');
  }

  static async summarize(providerId, text, { model, secrets }) {
    const provider = this.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    if (!provider.isConfigured(secrets)) throw new Error(`Provider ${providerId} not configured`);
    return provider.summarize(text, { model, secrets });
  }

  static async generate(providerId, userPrompt, { model, secrets, systemPrompt }) {
    const provider = this.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    if (!provider.isConfigured(secrets)) throw new Error(`Provider ${providerId} not configured`);
    if (typeof provider.generate !== 'function') {
      throw new Error(`Provider ${providerId} does not support generation`);
    }
    return provider.generate(userPrompt, { model, secrets, systemPrompt });
  }

  static async validateConfig(providerId, secrets, model) {
    const provider = this.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.validateConfig(secrets, model);
  }
}

module.exports = AiProviderRegistry;
