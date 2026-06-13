const { OLLAMA_BASE_URL, OLLAMA_MODEL } = require('../config');

class OllamaBootstrap {
  static _baseUrl() {
    return (OLLAMA_BASE_URL || '').trim().replace(/\/$/, '');
  }

  static async checkOnStartup() {
    const baseUrl = this._baseUrl();
    if (!baseUrl) return null;

    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const names = (data?.models || []).map((m) => m.name || m.model).filter(Boolean);
      console.log(`[Ollama] OK ${baseUrl} — models: ${names.length || 0}`);
      if (names.length) {
        console.log(`[Ollama] installed: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`);
      }

      const wanted = OLLAMA_MODEL?.trim();
      if (wanted && names.length && !names.some((n) => n === wanted || n.startsWith(`${wanted}:`))) {
        console.warn(
          `[Ollama] model "${wanted}" not found. In ollama service shell run: ollama pull ${wanted}`
        );
      }
      if (!names.length) {
        console.warn(`[Ollama] no models yet. In ollama service shell run: ollama pull ${wanted || 'llama3.2'}`);
      }

      return { ok: true, baseUrl, models: names };
    } catch (err) {
      console.error(`[Ollama] unreachable at ${baseUrl}: ${err.message}`);
      console.error('[Ollama] Add ollama service in the same Northflank project and set OLLAMA_BASE_URL=http://ollama:11434');
      return { ok: false, baseUrl, error: err.message };
    }
  }

  static async healthStatus() {
    const baseUrl = this._baseUrl();
    if (!baseUrl) return null;

    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      const count = data?.models?.length || 0;
      return { ok: true, models: count };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = OllamaBootstrap;
