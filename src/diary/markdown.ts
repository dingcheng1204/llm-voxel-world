// Tiny, safe Markdown renderer for diary entries (title, ## headings, paragraphs, - lists).
// Everything is HTML-escaped first; no links, no raw HTML — diaries are model output.

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function renderDiary(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`);
    para = [];
    list = [];
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1]!.length === 1 ? 'h2' : 'h3';
      out.push(`<${level}>${escapeHtml(h[2]!)}</${level}>`);
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (para.length) flush();
      list.push(escapeHtml(li[1]!));
      continue;
    }
    if (list.length) flush();
    para.push(escapeHtml(line));
  }
  flush();
  return out.join('\n');
}
