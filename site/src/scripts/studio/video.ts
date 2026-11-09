// Videoopslag direkte fra webcam: optag, klip og eksportér vandret eller lodret.
import {
  $,
  maybe,
  download,
  fmtBytes,
  fmtTime,
  readMeta,
  setBusy,
  setStatus,
  setupPublishPanel,
  toast,
  updateCaptionFields,
} from './shared';

const permission = $('#video-permission') as HTMLElement;
const stage = $('#video-stage') as HTMLElement;
const result = $('#video-result') as HTMLElement;
const cam = $('#video-cam') as HTMLVideoElement;
const frame = $('#video-frame') as HTMLElement;
const timer = $('#video-timer') as HTMLElement;
const mimeNote = $('#video-mime-note') as HTMLElement;
const errorBox = $('#video-error') as HTMLElement;
const startButton = $('#video-start') as HTMLButtonElement;
const recordButton = $('#video-record') as HTMLButtonElement;
const pauseButton = $('#video-pause') as HTMLButtonElement;
const stopButton = $('#video-stop') as HTMLButtonElement;
const mirror = $('#video-mirror') as HTMLInputElement;
const cameraSelect = $('#video-camera') as HTMLSelectElement;
const micSelect = $('#video-mic') as HTMLSelectElement;
const playback = $('#video-playback') as HTMLVideoElement;
const trimStart = $('#video-trim-start') as HTMLInputElement;
const trimEnd = $('#video-trim-end') as HTMLInputElement;
const trimStartLabel = $('#video-trim-start-label') as HTMLElement;
const trimEndLabel = $('#video-trim-end-label') as HTMLElement;
const setStart = $('#video-set-start') as HTMLButtonElement;
const setEnd = $('#video-set-end') as HTMLButtonElement;
const exportButton = $('#video-export') as HTMLButtonElement;
const downloadButton = $('#video-download') as HTMLButtonElement;
const retakeButton = $('#video-retake') as HTMLButtonElement;
const exportStatus = $('#video-export-status') as HTMLElement;
const progress = $('#video-progress') as HTMLElement;
const progressBar = progress.querySelector('span') as HTMLElement;

type Ratio = '9x16' | '16x9';

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let recorded: Blob | null = null;
let recordedUrl = '';
let recordedDuration = 0;
let timerId = 0;
let recordingStarted = 0;
let pausedAt = 0;
let pausedTotal = 0;
const exports = new Map<Ratio, Blob>();

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'mp4';
  return 'webm';
}

function currentRatio(): Ratio {
  const checked = document.querySelector<HTMLInputElement>('input[name="video-format"]:checked');
  return checked?.value === '16x9' ? '16x9' : '9x16';
}

function ratioSize(ratio: Ratio): [number, number] {
  return ratio === '9x16' ? [1080, 1920] : [1920, 1080];
}

function updateTrimLabels() {
  trimStartLabel.textContent = fmtTime(Number(trimStart.value));
  trimEndLabel.textContent = fmtTime(Number(trimEnd.value));
}

function fillSelect(select: HTMLSelectElement, devices: MediaDeviceInfo[], label: string) {
  const previous = select.value;
  select.replaceChildren(new Option('Standard', ''));
  devices.forEach((device, index) => select.append(new Option(device.label || `${label} ${index + 1}`, device.deviceId)));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    fillSelect(cameraSelect, devices.filter((device) => device.kind === 'videoinput'), 'Kamera');
    fillSelect(micSelect, devices.filter((device) => device.kind === 'audioinput'), 'Mikrofon');
  } catch {
    /* enhedsnavne er ikke altid tilgængelige */
  }
}

function stopStream() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  cam.srcObject = null;
}

function tick() {
  const elapsed = (Date.now() - recordingStarted - pausedTotal) / 1000;
  timer.textContent = fmtTime(elapsed);
  if (elapsed >= 180 && recorder?.state === 'recording') {
    stopRecording();
    toast('Optagelsen stoppede efter 3 minutter. Klip den gerne ned til under 90 sekunder til Reels.');
  }
}

async function startCamera() {
  errorBox.textContent = '';
  startButton.disabled = true;
  try {
    stopStream();
    const cameraId = cameraSelect.value;
    const micId = micSelect.value;
    const constraints: MediaStreamConstraints = {
      video: {
        ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'user' }),
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: {
        ...(micId ? { deviceId: { exact: micId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    cam.srcObject = stream;
    await cam.play();
    permission.hidden = true;
    stage.hidden = false;
    result.hidden = true;
    const mime = pickMime();
    mimeNote.textContent = mime.includes('mp4') ? 'MP4' : mime ? 'WebM' : '';
    await refreshDevices();
  } catch (error) {
    const message = (error as Error).name === 'NotAllowedError'
      ? 'Du sagde nej til kameraet. Tillad adgang i browserens indstillinger og prøv igen.'
      : (error as Error).name === 'NotFoundError'
        ? 'Der blev ikke fundet et kamera eller en mikrofon.'
        : `Kameraet kunne ikke åbnes: ${(error as Error).message}`;
    errorBox.textContent = message;
  } finally {
    startButton.disabled = false;
  }
}

function stopRecording() {
  clearInterval(timerId);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recordButton.disabled = true;
  pauseButton.disabled = true;
  stopButton.disabled = true;
}

function startRecording() {
  if (!stream) return;
  chunks = [];
  exports.clear();
  downloadButton.disabled = true;
  const mime = pickMime();
  recorder = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 4_500_000,
    audioBitsPerSecond: 128_000,
  });
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener('stop', () => {
    clearInterval(timerId);
    const type = recorder?.mimeType?.split(';')[0] || 'video/webm';
    recorded = new Blob(chunks, { type });
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    recordedUrl = URL.createObjectURL(recorded);
    playback.src = recordedUrl;
    stage.hidden = true;
    result.hidden = false;
    stopStream();
    recordButton.disabled = false;
    pauseButton.disabled = true;
    stopButton.disabled = true;
    timer.textContent = '00:00';
    setStatus(exportStatus, 'Klar til at klippe. Sæt start og slut, og vælg format.', 'info');
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  recorder.start(1000);
  recordingStarted = Date.now();
  pausedTotal = 0;
  pausedAt = 0;
  timer.textContent = '00:00';
  timerId = window.setInterval(tick, 250);
  recordButton.disabled = true;
  pauseButton.disabled = false;
  pauseButton.textContent = '❚❚ Pause';
  stopButton.disabled = false;
}

startButton.addEventListener('click', startCamera);
retakeButton.addEventListener('click', startCamera);
cameraSelect.addEventListener('change', () => {
  if (!stage.hidden) void startCamera();
});
micSelect.addEventListener('change', () => {
  if (!stage.hidden) void startCamera();
});
mirror.addEventListener('change', () => frame.classList.toggle('is-mirrored', mirror.checked));

recordButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
pauseButton.addEventListener('click', () => {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    pausedAt = Date.now();
    pauseButton.textContent = '▶ Fortsæt';
    timer.textContent = fmtTime((pausedAt - recordingStarted - pausedTotal) / 1000);
  } else if (recorder.state === 'paused') {
    pausedTotal += Date.now() - pausedAt;
    recorder.resume();
    pauseButton.textContent = '❚❚ Pause';
  }
});

playback.addEventListener('loadedmetadata', () => {
  recordedDuration = Number.isFinite(playback.duration) ? playback.duration : 0;
  trimStart.max = String(recordedDuration);
  trimEnd.max = String(recordedDuration);
  trimStart.value = '0';
  trimEnd.value = String(recordedDuration);
  updateTrimLabels();
});

trimStart.addEventListener('input', () => {
  if (Number(trimStart.value) > Number(trimEnd.value) - 1) trimStart.value = String(Math.max(0, Number(trimEnd.value) - 1));
  updateTrimLabels();
});
trimEnd.addEventListener('input', () => {
  if (Number(trimEnd.value) < Number(trimStart.value) + 1) trimEnd.value = String(Number(trimStart.value) + 1);
  updateTrimLabels();
});
setStart.addEventListener('click', () => {
  trimStart.value = String(Math.min(playback.currentTime, Number(trimEnd.value) - 1));
  updateTrimLabels();
});
setEnd.addEventListener('click', () => {
  trimEnd.value = String(Math.max(playback.currentTime, Number(trimStart.value) + 1));
  updateTrimLabels();
});

async function exportClip(start: number, end: number, ratio: Ratio, onProgress: (progress: number) => void): Promise<Blob> {
  if (!recordedUrl) throw new Error('Der er ingen optagelse at klippe i.');
  if (end - start < 1) throw new Error('Klippet skal være mindst ét sekund.');
  const source = document.createElement('video');
  source.src = recordedUrl;
  source.preload = 'auto';
  source.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    source.addEventListener('loadedmetadata', () => resolve(), { once: true });
    source.addEventListener('error', () => reject(new Error('Videoen kunne ikke indlæses til klipning.')), { once: true });
    source.load();
  });

  const [width, height] = ratioSize(ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browseren kunne ikke lave lærredet til klippet.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);

  const canvasStream = canvas.captureStream(30);
  const sourceWithCapture = source as HTMLVideoElement & { captureStream?: () => MediaStream };
  const sourceStream = sourceWithCapture.captureStream?.();
  const audioTracks = sourceStream?.getAudioTracks() ?? [];
  const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  const mime = pickMime();
  const clipRecorder = new MediaRecorder(mixed, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: ratio === '9x16' ? 5_000_000 : 8_000_000,
    audioBitsPerSecond: 128_000,
  });
  const clipChunks: BlobPart[] = [];
  clipRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) clipChunks.push(event.data);
  });
  const finished = new Promise<Blob>((resolve) => {
    clipRecorder.addEventListener('stop', () => {
      resolve(new Blob(clipChunks, { type: clipRecorder.mimeType.split(';')[0] || 'video/webm' }));
    }, { once: true });
  });

  if (Math.abs(source.currentTime - start) > 0.05) {
    await new Promise<void>((resolve) => {
      source.addEventListener('seeked', () => resolve(), { once: true });
      source.currentTime = start;
    });
  }

  // Lyden afspilles, mens klippet dannes – det er den eneste måde at få den med uden en server.
  source.volume = 0.6;
  await source.play();
  clipRecorder.start(250);

  await new Promise<void>((resolve) => {
    const draw = () => {
      if (source.ended || source.currentTime >= end) {
        resolve();
        return;
      }
      const sourceWidth = source.videoWidth || width;
      const sourceHeight = source.videoHeight || height;
      const scale = Math.max(width / sourceWidth, height / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      onProgress(Math.min(1, (source.currentTime - start) / (end - start)));
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });

  source.pause();
  clipRecorder.stop();
  const blob = await finished;
  mixed.getTracks().forEach((track) => track.stop());
  source.removeAttribute('src');
  source.load();
  if (!audioTracks.length) {
    toast('Bemærk: browseren kunne ikke få lyden med i klippet.');
  }
  return blob;
}

exportButton.addEventListener('click', async () => {
  const ratio = currentRatio();
  const start = Number(trimStart.value);
  const end = Number(trimEnd.value);
  setBusy(exportButton, true);
  progress.hidden = false;
  progressBar.style.setProperty('--p', '0%');
  setStatus(exportStatus, `Danner klippet i ${ratio === '9x16' ? 'lodret 9:16' : 'vandret 16:9'} … det tager ca. ${fmtTime(end - start)}.`, 'busy');
  try {
    const blob = await exportClip(start, end, ratio, (value) => {
      progressBar.style.setProperty('--p', `${Math.round(value * 100)}%`);
    });
    exports.set(ratio, blob);
    downloadButton.disabled = false;
    const extension = extensionFor(blob.type);
    const warning = extension === 'webm'
      ? ' Instagram kræver MP4 – optag i Safari på iPhone, eller konvertér filen, hvis du vil poste den direkte.'
      : ' Klippet er klar til Instagram og YouTube.';
    setStatus(exportStatus, `Klippet er klar (${fmtBytes(blob.size)}).${warning}`, extension === 'webm' ? 'info' : 'ok');
    downloadButton.textContent = `Hent klippet (.${extension})`;
  } catch (error) {
    setStatus(exportStatus, (error as Error).message, 'error');
  } finally {
    setBusy(exportButton, false);
    progress.hidden = true;
  }
});

downloadButton.addEventListener('click', () => {
  const ratio = currentRatio();
  const clip = exports.get(ratio);
  if (!clip) return;
  download(clip, `klip-${ratio}.${extensionFor(clip.type)}`);
});

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="video-format"]')) {
  input.addEventListener('change', () => {
    const clip = exports.get(currentRatio());
    downloadButton.disabled = !clip;
    if (clip) downloadButton.textContent = `Hent klippet (.${extensionFor(clip.type)})`;
  });
}

/* ---------- Tekster til Instagram og YouTube ---------- */

updateCaptionFields();
for (const id of ['#caption-copy-instagram', '#caption-copy-youtube']) {
  maybe<HTMLButtonElement>(id)?.addEventListener('click', async () => {
    const isInstagram = id.includes('instagram');
    const instagram = maybe<HTMLTextAreaElement>('#caption-instagram');
    const youtubeTitle = maybe<HTMLInputElement>('#caption-youtube-title');
    const youtubeDesc = maybe<HTMLTextAreaElement>('#caption-youtube-desc');
    const text = isInstagram
      ? instagram?.value ?? ''
      : `${youtubeTitle?.value ?? ''}\n\n${youtubeDesc?.value ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
      toast(isInstagram ? 'Instagram-teksten er kopieret' : 'YouTube-teksten er kopieret');
    } catch {
      toast('Kunne ikke kopiere – markér teksten i feltet i stedet.');
    }
  });
}

/* ---------- Udgivelse ---------- */

setupPublishPanel({
  validate: () => (recorded ? null : 'Optag først en video med kameraet.'),
  buildBody: (uploaded) => {
    const ratio = currentRatio();
    const extension = extensionFor(exports.get(ratio)?.type ?? 'video/webm');
    const name = `klip-${ratio}.${extension}`;
    const url = uploaded.find((media) => media.name === name)?.url
      ?? `/media/uploads/${readMeta().slug}/${name}`;
    const caption = (maybe<HTMLTextAreaElement>('#pub-desc')?.value ?? '').split('\n')[0].trim();
    return `::video[${caption}]{src="${url}" format="${ratio === '9x16' ? 'lodret' : 'vandret'}"}`;
  },
  getFiles: async () => {
    const ratio = currentRatio();
    const clip = exports.get(ratio);
    if (!clip) throw new Error('Lav først et klip med »Lav klip«, så det kan uploades.');
    const name = `klip-${ratio}.${extensionFor(clip.type)}`;
    return [{ name, bytes: new Uint8Array(await clip.arrayBuffer()), type: clip.type }];
  },
});

window.addEventListener('pagehide', () => {
  stopStream();
  if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  speechSynthesis?.cancel();
});
