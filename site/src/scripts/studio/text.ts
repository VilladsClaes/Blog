// Tekststudiet: formgivning, live-forhåndsvisning, stemmeprøve og udgivelse.
// Forhåndsvisningen bruger præcis samme renderer som /admin/ og den offentlige side.
import { renderPostBody } from '../admin/render';
import {
  $,
  maybe,
  copyText,
  download,
  fmtTime,
  setStatus,
  setupAutosave,
  setupPublishPanel,
  toast,
} from './shared';

const editor = $('#txt-editor') as HTMLTextAreaElement;
const preview = $('#txt-preview') as HTMLElement;
const count = $('#txt-count') as HTMLElement;
const fontSelect = maybe<HTMLSelectElement>('#pub-font');

function render() {
  preview.innerHTML = editor.value.trim()
    ? renderPostBody(editor.value)
    : '<p class="studio-empty">Forhåndsvisningen dukker op her, mens du skriver.</p>';
  const words = editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0;
  count.textContent = `${words} ord · ca. ${Math.max(1, Math.round(words / 200))} min.`;
}

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
  const inner = Array.from({ length: amount }, (_, i) =>
    `:::kolonne\n${i === 0 ? selection || 'Første spalte …' : `Spalte ${i + 1} …`}\n:::`).join('\n');
  insertBlock(`::::kolonner{antal="${amount}"}\n${inner}\n::::`);
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
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('Browseren understøtter ikke mikrofonoptagelse.');
    }
    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!voiceStream.getAudioTracks().length) throw new Error('Mikrofonen gav intet lydspor.');
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
      clearInterval(voiceTimer);
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
    voiceStatusText('Optager … 00:00', 'busy');
    voiceTimer = window.setInterval(() => {
      voiceSeconds += 1;
      voiceStatusText(`Optager … ${fmtTime(voiceSeconds)}`, 'busy');
      if (voiceSeconds >= 90 && voiceRecorder?.state === 'recording') voiceRecorder.stop();
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

maybe<HTMLButtonElement>('#voice-copy-command')?.addEventListener('click', () => {
  copyText('ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=… npm run voice -- <slug>', 'Kommandoen er kopieret');
});

/* ---------- Udgivelse og automatisk gendannelse ---------- */

setupPublishPanel({
  buildBody: () => editor.value,
  load: (post) => {
    editor.value = post.bodyMarkdown ?? '';
    if (fontSelect) {
      fontSelect.value = post.font || 'serif';
      preview.setAttribute('data-font', fontSelect.value);
    }
    render();
  },
  validate: () => (editor.value.trim() ? null : 'Skriv noget i teksten, før du udgiver.'),
});

const autosave = setupAutosave('tekst', () => editor.value, (value) => {
  editor.value = value;
  render();
});

if (fontSelect) {
  fontSelect.addEventListener('change', () => preview.setAttribute('data-font', fontSelect.value));
  preview.setAttribute('data-font', fontSelect.value);
}

let debounce = 0;
editor.addEventListener('input', () => {
  autosave?.schedule();
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