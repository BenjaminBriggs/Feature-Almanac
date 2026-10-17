const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] as string)
}

/** JSON safe to embed in a `<script type="application/json">` element. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * The Markdown subset descriptions use: paragraphs, `-`/`*` and numbered lists, `code`,
 * **bold**, *emphasis* and [links](url). Everything is escaped first, so no HTML passes through.
 */
export function renderMarkdown(text: string): string {
  const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)
  return blocks
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim())
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
      }
      if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`
      }
      return `<p>${inline(lines.join(' '))}</p>`
    })
    .join('')
}

function inline(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      return escapeHtml(part)
        .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|\.{1,2}\/|#)[^)\s]*)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    })
    .join('')
}

/** Markdown reduced to plain text, for search snippets. */
export function plainText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
