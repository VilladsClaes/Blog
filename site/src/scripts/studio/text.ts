// Tekststudiet: formgivning, live-forhåndsvisning, stemmeprøve og udgivelse.
import { marked } from 'marked';
import {
  $,
  maybe,
  copyText,
  download,
  fmtTime,
  setStatus,
  setupPublishPanel,
  toast,
} from './shared';

const editor = $('#txt-editor') as HTMLTextAreaElement;
const preview = $('#txt-preview') as HTMLElement;
const count = $('#txt-count') as HTMLElement;
const fontSelect = maybe<HTMLSelectElement>('#pub-font');

marked.setOptions({ gfm: true, breaks: false });

/* ---------- Små HTML-hjælpere ---------- */

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
  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (attribute.name === 'style') element.removeAttribute(attribute.name);
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

/* ---------- Forhåndsvisning af både Markdown og bloggens blokke ---------- */

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

function renderContainer(name: string, attrs: Attrs, inner: string): string {
  const title = (value: unknown, fallback: string) => (value && value !== true ? String(value) : fallback);
  switch (name) {
    case 'tldr':
    case 'summary':
    case 'resume':
      return `<aside class="x-tldr"><p class="x-tldr-title">${esc(title(attrs.titel ?? attrs.title, 'TLDR'))}</p>${inner}</aside>`;
    case 'detaljer':
    case 'details':
      return `<details class="x-details" open><summary>${esc(title(attrs.titel ?? attrs.title ?? attrs.summary, 'Læs mere'))}</summary>${inner}</details>`;
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
      return `<div class="studio-unknown-block"><strong>::${esc(name)}</strong>${inner}</div>`;
  }
}

function renderLeaf(name: string, label: string, attrs: Attrs): string {
  const title = (value: unknown, fallback: string) => (value && value !== true ? String(value) : fallback);
  switch (name) {
    case 'tldr':
    case 'summary':
    case 'resume':
      return `<aside class="x-tldr"><p class="x-tldr-title">${esc(title(attrs.titel ?? attrs.title, 'TLDR'))}</p><p>${esc(label)}</p></aside>`;
    case 'detaljer':
    case 'details':
      return `<details class="x-details" open><summary>${esc(title(attrs.titel ?? attrs.title ?? attrs.summary, 'Læs mere'))}</summary><p>${esc(label)}</p></details>`;
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
        src ? `<img src="${esc(src)}" alt="${esc(alt)}" />` : '<div class="studio-empty">Billede – indsæt src</div>'
      }${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`;
    }
    case 'video': {
      const src = typeof attrs.src === 'string' ? attrs.src : '';
      const vertical = /^(lodret|vertical|9:16|9x16)$/i.test(String(attrs.format ?? ''));
      return `<figure class="x-video${vertical ? ' is-vertical' : ''}"><div class="x-video-frame"><div class="studio-video-placeholder">Video: ${esc(src || 'indsæt src')}</div></div>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`;
    }
    case 'afstemning':
    case 'poll': {
      const options = String(attrs.valg ?? attrs.options ?? 'Ja|Nej').split('|').map((option) => option.trim()).filter(Boolean);
      return `<div class="x-poll"><p class="x-poll-q">${esc(label)}</p><ul class="x-poll-fallback">${options.map((option) => `<li>${esc(option)}</li>`).join('')}</ul></div>`;
    }
    case 'holdning':
    case 'stance':
      return `<div class="x-stance"><p class="x-stance-q">${esc(label)}</p></div>`;
    default:
      return `<p class="studio-directive">::${esc(name)}[${esc(label)}]</p>`;
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

function render() {
  preview.innerHTML = editor.value.trim()
    ? renderBlocks(editor.value.split(/\r?\n/))
    : '<p class="studio-empty">Forhåndsvisningen dukker op her, mens du skriver.</p>';
  const words = editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0;
  count.textContent = `${words} ord · ca. ${Math.max(1, Math.round(words / 200))} min.`;
}

/* ---------- Værktøjslinjen ---------- */

function selected(fallback: string) {
  return editor.value.slice(editor.selectionStart, editor.selectionEnd) || fallback;
}

function wrap(before: string, after: string, fallback: string) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = selected(fallback);
  editor.setRangeText(`${before}${text}${after}`, start, end, 'end');
  editor.focus();
  render();
}

function insertBlock(block: string) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const trail = after.startsWith('\n') ? '\n' : '\n\n';
  editor.value = `${before}${lead}${block}${trail}${after}`;
  const caret = before.length + lead.length + block.length;
  editor.selectionStart = editor.selectionEnd = caret;
  editor.focus();
  render();
}

function blockWrap(open: string, close: string, fallback: string) {
  insertBlock(`${open}\n${selected(fallback)}\n${close}`);
}

function prefixLines(prefix: string) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
  const chunk = editor.value.slice(lineStart, end) || 'Tekst';
  editor.setRangeText(chunk.split('\n').map((line) => `${prefix}${line}`).join('\n'), lineStart, end, 'end');
  editor.focus();
  render();
}

function columns(amount: number) {
  const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  const columns = Array.from({ length: amount }, (_, i) =>
    `:::kolonne\n${i === 0 ? selection || 'Første spalte …' : `Spalte ${i + 1} …`}\n:::`).join('\n');
  insertBlock(`::::kolonner{antal="${amount}"}\n${columns}\n::::`);
}

const actions: Record<string, () => void> = {
  bold: () => wrap('**', '**', 'fed tekst'),
  italic: () => wrap('*', '*', 'kursiv'),
  h2: () => prefixLines('## '),
  h3: () => prefixLines('### '),
  ul: () => prefixLines('- '),
  ol: () => prefixLines('1. '),
  quote: () => prefixLines('> '),
  link: () => wrap('[', '](https://)', 'linktekst'),
  tldr: () => blockWrap('::tldr{titel="Kort fortalt"}', '::', 'Det vigtigste i to-tre linjer …'),
  details: () => blockWrap('::detaljer{titel="De udvidede detaljer"}', '::', 'Alt det lange, som ikke skal fylde i det korte overblik …'),
  columns2: () => columns(2),
  columns3: () => columns(3),
  pullquote: () => blockWrap('::citat{kilde="Navn"}', '::', 'En sætning, der skal stå tydeligt …'),
  callout: () => blockWrap('::faktaboks{titel="Godt at vide"}', '::', 'En kort faktaboks …'),
  fontSans: () => blockWrap('::skrift{font="sans"}', '::', 'Afsnit i sans …'),
  fontMono: () => blockWrap('::skrift{font="mono"}', '::', 'Afsnit i mono …'),
  image: () => insertBlock('::billede[Billedtekst]{src="/media/uploads/…" alt="Beskrivelse" bred}'),
  video: () => insertBlock('::video[Billedtekst]{src="https://youtu.be/…" format="lodret"}'),
};

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
  button.addEventListener('click', () => actions[button.dataset.action ?? '']?.());
});

/* ---------- Oplæsning og stemmeprøve ---------- */

let speaking = false;
const speakButton = maybe<HTMLButtonElement>('#txt-speak');
speakButton?.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) {
    toast('Browseren kan ikke læse op.');
    return;
  }
  if (speaking) {
    speechSynthesis.cancel();
    speaking = false;
    speakButton.textContent = 'Hør teksten';
    return;
  }
  const text = preview.innerText.replace(/\s+/g, ' ').trim();
  if (!text) {
    toast('Skriv noget først.');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'da-DK';
  const voice = speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith('da'));
  if (voice) utterance.voice = voice;
  utterance.onend = () => {
    speaking = false;
    speakButton.textContent = 'Hør teksten';
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  speaking = true;
  speakButton.textContent = 'Stop oplæsning';
  toast('Læser med browserens stemme. Den indlæste version laves med npm run voice.');
});

let voiceRecorder: MediaRecorder | null = null;
let voiceChunks: Blob[] = [];
let voiceStream: MediaStream | null = null;
let voiceTimer = 0;
let voiceSeconds = 0;
let voiceBlob: Blob | null = null;

const voiceRecord = maybe<HTMLButtonElement>('#voice-record');
const voiceStop = maybe<HTMLButtonElement>('#voice-stop');
const voiceDownload = maybe<HTMLButtonElement>('#voice-download');
const voiceStatus = maybe<HTMLElement>('#voice-status');
const voicePlayback = maybe<HTMLAudioElement>('#voice-playback');

function voiceStatusText(text: string, kind: 'info' | 'busy' | 'ok' | 'error' = 'info') {
  if (voiceStatus) setStatus(voiceStatus, text, kind);
}

voiceRecord?.addEventListener('click', async () => {
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    voiceChunks = [];
    voiceBlob = null;
    voiceSeconds = 0;
    if (voicePlayback) {
      voicePlayback.hidden = true;
      voicePlayback.removeAttribute('src');
    }
    if (voiceDownload) voiceDownload.disabled = true;
    voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) voiceChunks.push(event.data);
    });
    voiceRecorder.addEventListener('stop', () => {
      voiceBlob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || 'audio/webm' });
      voiceStream?.getTracks().forEach((track) => track.stop());
      voiceStream = null;
      if (voicePlayback) {
        voicePlayback.src = URL.createObjectURL(voiceBlob);
        voicePlayback.hidden = false;
      }
      if (voiceDownload) voiceDownload.disabled = false;
      if (voiceRecord) voiceRecord.disabled = false;
      if (voiceStop) voiceStop.disabled = true;
      voiceStatusText('Stemmeprøven er klar. Hent den og brug den til at lave en stemmeklon.', 'ok');
    });
    voiceRecorder.start(500);
    voiceRecord.disabled = true;
    if (voiceStop) voiceStop.disabled = false;
    voiceStatusText(`Optager … 00:00`, 'busy');
    voiceTimer = window.setInterval(() => {
      voiceSeconds += 1;
      voiceStatusText(`Optager … ${fmtTime(voiceSeconds)}`, 'busy');
      if (voiceSeconds >= 90) voiceRecorder?.state === 'recording' && voiceRecorder.stop();
    }, 1000);
  } catch (error) {
    voiceStatusText(`Kunne ikke åbne mikrofonen: ${(error as Error).message}`, 'error');
  }
});

voiceStop?.addEventListener('click', () => {
  clearInterval(voiceTimer);
  if (voiceRecorder?.state === 'recording') voiceRecorder.stop();
});

voiceDownload?.addEventListener('click', () => {
  if (voiceBlob) download(voiceBlob, 'stemmeproev.webm');
});

const copyCommand = maybe<HTMLButtonElement>('#voice-copy-command');
copyCommand?.addEventListener('click', () => {
  copyText('ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=… npm run voice -- <slug>', 'Kommandoen er kopieret');
});

/* ---------- Udgivelse ---------- */

setupPublishPanel({
  buildBody: () => editor.value,
  validate: () => (editor.value.trim() ? null : 'Skriv noget i teksten, før du udgiver.'),
});

if (fontSelect) {
  fontSelect.addEventListener('change', () => preview.setAttribute('data-font', fontSelect.value));
  preview.setAttribute('data-font', fontSelect.value);
}

let debounce = 0;
editor.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = window.setTimeout(render, 140);
});
editor.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('#pub-go')?.click();
  }
});

render();
