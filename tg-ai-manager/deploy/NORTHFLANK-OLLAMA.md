# Ollama на Northflank (prod, без ngrok)

Бот и Ollama — **два сервиса в одном проекте**. Связь по внутренней сети `http://ollama:11434`.

## 1. Сервис `ollama` (новый)

Northflank → Project → **Add service** → **Combined** / **Deployment**:

| Поле | Значение |
|------|----------|
| Service name | `ollama` (важно — именно так) |
| Image | `ollama/ollama:latest` |
| Port | `11434` |
| Public access | **выключить** |
| Persistent volume | mount `/root/.ollama` (чтобы модели не слетали) |
| CPU / RAM | минимум 2 CPU, 4 GB (llama3.2 на CPU) |

Deploy и дождись Running.

### Скачать модель (один раз)

Сервис `ollama` → **Shell / Exec**:

```bash
ollama pull llama3.2
ollama list
```

## 2. Сервис `manager` (бот) — переменные

К существующим переменным **добавь**:

```env
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_AUTO_ACTIVATE=true
OLLAMA_MODEL=llama3.2
AI_ACTIVE_PROVIDER=ollama
```

Redeploy бота.

При старте бот сам:
- запишет URL Ollama в Supabase (`app_secrets`);
- сделает Ollama активным провайдером;
- проверит `/api/tags` в логах.

## 3. Проверка

**Логи бота** — должно быть:

```
OLLAMA_BASE_URL: http://ollama:11434
[SecretsService] Ollama set as active AI provider
[Ollama] OK http://ollama:11434 — models: 1
```

**Shell бота:**

```bash
curl -s http://ollama:11434/api/tags
curl -s http://127.0.0.1:8080/health
```

`/health` → `"ollama":{"ok":true,"models":1}`

**Telegram:** Настройки → ИИ — активна Ollama, модель llama3.2.

## 4. Если не работает

| Симптом | Решение |
|---------|---------|
| `Could not resolve host ollama` | Сервис не назван `ollama` или не в том же project |
| `Connection refused` | Сервис ollama не Running |
| `models: 0` | В shell ollama: `ollama pull llama3.2` |
| Медленно | CPU-only; для скорости — Groq/OpenRouter |

## 5. Не используй

- Mac + ngrok (нужен VPN в РБ, Mac всегда включён)
- `127.0.0.1:11434` в `OLLAMA_BASE_URL` на Northflank — это localhost **контейнера бота**, не Ollama
