const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote']);

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeTelegramHtml(html) {
  if (!html?.trim()) return '';

  let out = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|span)[^>]*>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n');

  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    if (match.startsWith('</')) return `</${lower}>`;
    if (lower === 'a') {
      const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) return '';
      const href = hrefMatch[1].replace(/"/g, '&quot;');
      return `<a href="${href}">`;
    }
    return `<${lower}>`;
  });

  return out.trim();
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, '').trim();
}

const CAPTION_MAX = 1024;

function truncateCaption(html, max = CAPTION_MAX) {
  const plain = stripHtml(html);
  if (plain.length <= max) return sanitizeTelegramHtml(html);
  const truncated = `${plain.slice(0, max - 1)}…`;
  return escapeHtml(truncated);
}

function captionTooLong(html) {
  return stripHtml(html).length > CAPTION_MAX;
}

module.exports = {
  escapeHtml,
  sanitizeTelegramHtml,
  stripHtml,
  truncateCaption,
  captionTooLong,
  CAPTION_MAX
};
