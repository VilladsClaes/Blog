// Markdown-renderer til /admin/. Den laver samme HTML, som bloggens
// Astro-direktiver gør, så et databaseindlæg kan bruge de samme blokke.
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

const esc = (value: unknown) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

type Attrs = Record<string, string | true>;

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = {};
  const re = /([\w-]+)(?:="([^"]*)")?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) attrs[match[1]] = match[2] === undefined ? true : match[2];
  return attrs;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const FONT_CLASS: Record<string, string> = {
  serif: 'x-font-serif',
  sans: 'x-font-sans',
  mono: 'x-font-mono',
  haandskrift: 'x-font-haandskrift',
};

function fontClass(value: unknown) {
  return FONT_CLASS[String(value).toLowerCase()] ?? 'x-font-serif';
}

function sanitize(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, style, object, embed, link, meta, form').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if ((attribute.name === 'href' || attribute.name === 'src') && /^\s*javascript:/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML;
}

function renderMarkdown(markdown: string) {
  const withHighlights = markdown
    .replace(/:vigtigt\[([^\]]+)\]/g, '<strong class="x-key">$1</strong>')
    .replace(/:key\[([^\]]+)\]/g, '<strong class="x-key">$1</strong>');
  return sanitize(marked.parse(withHighlights) as string);
}

function videoEmbed(src: string) {
  const encoded = esc(src);
  const yt = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/);
  if (yt) {
    return `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="Video" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  }
  const vimeo = src.match(/vimeo\.com\/(\d+)/);
  if (vimeo) {
    return `<iframe src="https://player.vimeo.com/video/${vimeo[1]}?dnt=1" title="Video" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)) {
    return `<video src="${encoded}" controls preload="metadata" playsinline></video>`;
  }
  return `<iframe src="${encoded}" title="Indlejret indhold" loading="lazy" allowfullscreen></iframe>`;
}

/* ---------- Bloggens blokke ---------- */

interface Fence {
  fence: string;
  name: string;
  label: string;
  attrs: Attrs;
}

function parseFence(line: string): Fence | null {
  const match = line.match(/^(:{2,})([a-zA-Z][\w-]*)(?:\[(.*?)\])?(?:\{([^}]*)\})?\s*$/);
  if (!match) return null;
  return { fence: match[1], name: match[2], label: match[3] ?? '', attrs: parseAttrs(match[4] ?? '') };
}

function findClose(lines: string[], from: number, length: number) {
  for (let i = from; i < lines.length; i++) {
    const match = lines[i].match(/^(:{2,})\s*$/);
    if (match && match[1].length === length) return i;
  }
  return -1;
}

function title(value: unknown, fallback: string) {
  return value && value !== true ? String(value) : fallback;
}

function renderContainer(name: string, attrs: Attrs, inner: string): string {
  switch (name) {
    case 'tldr':
    case 'summary':
    case 'resume':
      return `<aside class="x-tldr"><p class="x-tldr-title">${esc(title(attrs.titel ?? attrs.title, 'TLDR'))}</p>${inner}</aside>`;
    case 'detaljer':
    case 'details':
      return `<details class="x-details"><summary>${esc(title(attrs.titel ?? attrs.title ?? attrs.summary, 'Læs mere'))}</summary>${inner}</details>`;
    case 'kolonner':
    case 'columns': {
      const cols = Number(attrs.antal ?? attrs.kolonner ?? attrs.columns ?? 2);
      return `<div class="x-columns" style="--cols:${cols >= 2 && cols <= 4 ? cols : 2}">${inner}</div>`;
    }
    case 'kolonne':
    case 'column':
      return `<div class="x-column">${inner}</div>`;
    case 'citat':
    case 'quote':
    case 'pullquote': {
      const source = title(attrs.kilde ?? attrs.forfatter ?? attrs.author ?? attrs.source, '');
      return `<figure class="x-pullquote">${inner}${source ? `<figcaption>— ${esc(source)}</figcaption>` : ''}</figure>`;
    }
    case 'skrift':
    case 'font':
      return `<div class="x-font-block ${fontClass(attrs.font ?? attrs.skrift)}">${inner}</div>`;
    case 'faktaboks':
    case 'callout':
    case 'factbox':
      return `<aside class="x-callout"><p class="x-callout-title">${esc(title(attrs.titel ?? attrs.title, 'Godt at vide'))}</p>${inner}</aside>`;
    case 'galleri':
    case 'gallery':
      return `<div class="x-gallery">${inner}</div>`;
    default:
      return `<div class="admin-unknown-block"><strong>::${esc(name)}</strong>${inner}</div>`;
  }
}

function renderLeaf(name: string, label: string, attrs: Attrs): string {
  const options = () => String(attrs.valg ?? attrs.options ?? 'Ja|Nej').split('|').map((option) => option.trim()).filter(Boolean);

  switch (name) {
    case 'tldr':
    case 'summary':
    case 'resume':
      return `<aside class="x-tldr"><p class="x-tldr-title">${esc(title(attrs.titel ?? attrs.title, 'TLDR'))}</p><p>${esc(label)}</p></aside>`;
    case 'detaljer':
    case 'details':
      return `<details class="x-details"><summary>${esc(title(attrs.titel ?? attrs.title ?? attrs.summary, 'Læs mere'))}</summary><p>${esc(label)}</p></details>`;
    case 'citat':
    case 'quote':
    case 'pullquote': {
      const source = title(attrs.kilde ?? attrs.forfatter ?? attrs.author ?? attrs.source, '');
      return `<figure class="x-pullquote"><blockquote><p>${esc(label)}</p></blockquote>${source ? `<figcaption>— ${esc(source)}</figcaption>` : ''}</figure>`;
    }
    case 'skrift':
    case 'font':
      return `<span class="${fontClass(attrs.font ?? attrs.skrift)}">${esc(label)}</span>`;
    case 'faktaboks':
    case 'callout':
    case 'factbox':
      return `<aside class="x-callout"><p class="x-callout-title">${esc(title(attrs.titel ?? attrs.title, 'Godt at vide'))}</p><p>${esc(label)}</p></aside>`;
    case 'billede':
    case 'image':
    case 'photo': {
      const src = typeof attrs.src === 'string' ? attrs.src : '';
      const alt = title(attrs.alt, label);
      const wide = 'bred' in attrs || 'wide' in attrs;
      return `<figure class="x-figure${wide ? ' x-wide' : ''}">${
        src
          ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" />`
          : '<div class="admin-empty">Billede – indsæt src</div>'
      }${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`;
    }
    case 'video': {
      const src = typeof attrs.src === 'string' ? attrs.src : '';
      const vertical = /^(lodret|vertical|9:16|9x16)$/i.test(String(attrs.format ?? ''));
      return `<figure class="x-video${vertical ? ' is-vertical' : ''}"><div class="x-video-frame">${
        src ? videoEmbed(src) : '<div class="admin-empty">Video – indsæt src</div>'
      }</div>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`;
    }
    case 'afstemning':
    case 'poll': {
      const choices = options();
      const id = attrs.id && attrs.id !== true ? String(attrs.id) : slugify(label) || 'afstemning';
      return `<div class="x-poll" data-poll="${esc(id)}" data-options="${esc(JSON.stringify(choices))}"><p class="x-poll-q">${esc(label)}</p><ul class="x-poll-fallback">${choices.map((option) => `<li>${esc(option)}</li>`).join('')}</ul></div>`;
    }
    case 'spoergsmaal':
    case 'question':
    case 'opinion': {
      const choices = options();
      const id = attrs.id && attrs.id !== true ? String(attrs.id) : slugify(label) || 'spoergsmaal';
      return `<div class="x-poll x-opinion" data-poll="${esc(id)}" data-options="${esc(JSON.stringify(choices))}"><p class="x-opinion-kicker">Hvad tænker du?</p><p class="x-poll-q">${esc(label)}</p><ul class="x-poll-fallback">${choices.map((option) => `<li>${esc(option)}</li>`).join('')}</ul></div>`;
    }
    case 'holdning':
    case 'stance': {
      const id = attrs.id && attrs.id !== true ? String(attrs.id) : slugify(label) || 'holdning';
      return `<div class="x-stance" data-stance="${esc(id)}"><p class="x-stance-q">${esc(label)}</p></div>`;
    }
    default:
      return `<p class="admin-directive">::${esc(name)}[${esc(label)}]</p>`;
  }
}

function renderBlocks(lines: string[]): string {
  let html = '';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) html += renderMarkdown(text);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const fence = parseFence(lines[i]);
    if (!fence) {
      buffer.push(lines[i]);
      continue;
    }
    const close = findClose(lines, i + 1, fence.fence.length);
    flush();
    if (close < 0) {
      html += renderLeaf(fence.name, fence.label, fence.attrs);
      continue;
    }
    html += renderContainer(fence.name, fence.attrs, renderBlocks(lines.slice(i + 1, close)));
    i = close;
  }
  flush();
  return html;
}

export function renderPostBody(markdown: string): string {
  return markdown.trim() ? renderBlocks(markdown.split(/\r?\n/)) : '';
}

export function countWords(markdown: string): number {
  return markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
}
