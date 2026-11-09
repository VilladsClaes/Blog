// Billedopslag: kamera på telefonen, billedvælger/Google Fotos, beskæring og udgivelse.
import {
  $,
  maybe,
  fmtBytes,
  readMeta,
  setBusy,
  setStatus,
  setupPublishPanel,
  toast,
} from './shared';

interface Item {
  id: string;
  blob: Blob;
  url: string;
  name: string;
  caption: string;
}

const cameraStage = $('#image-camera-stage') as HTMLElement;
const cameraEmpty = $('#image-camera-empty') as HTMLElement;
const camera = $('#image-cam') as HTMLVideoElement;
const startButton = $('#image-start') as HTMLButtonElement;
const snapButton = $('#image-snap') as HTMLButtonElement;
const switchButton = $('#image-switch') as HTMLButtonElement;
const stopButton = $('#image-stop') as HTMLButtonElement;
const fileInput = $('#image-files') as HTMLInputElement;
const pickButton = $('#image-pick') as HTMLButtonElement;
const googleButton = $('#image-google') as HTMLButtonElement;
const googleConfig = $('#image-google-config') as HTMLElement;
const drop = $('#image-drop') as HTMLElement;
const gallery = $('#image-gallery') as HTMLElement;
const status = $('#image-status') as HTMLElement;

const items: Item[] = [];
let coverId = '';
let cameraStream: MediaStream | null = null;
let facing: 'environment' | 'user' = 'environment';
let busy = false;

const googleClientId = googleConfig.dataset.clientId?.trim() ?? '';
if (googleClientId) googleButton.hidden = false;

function uid() {
  return crypto.randomUUID();
}

function setImageStatus(text: string, kind: 'info' | 'busy' | 'ok' | 'error' = 'info') {
  setStatus(status, text, kind);
}

function maxSizeFor(file: Blob, max = 2000): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      resolve({ width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) });
    };
    image.onerror = () => resolve({ width: max, height: max });
    image.src = URL.createObjectURL(file);
  });
}

async function toJpegBlob(blob: Blob, max = 2000): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Billedet kunne ikke læses.'));
      image.src = URL.createObjectURL(blob);
    });
  }
  const width = 'width' in source ? source.width : source.naturalWidth;
  const height = 'height' in source ? source.height : source.naturalHeight;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Browseren kunne ikke behandle billedet.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Billedet kunne ikke gemmes.'))), 'image/jpeg', 0.86);
  });
}

async function addBlob(blob: Blob, name: string, caption = '') {
  setImageStatus('Behandler billedet …', 'busy');
  const jpeg = await toJpegBlob(blob);
  const item: Item = { id: uid(), blob: jpeg, url: URL.createObjectURL(jpeg), name, caption };
  items.push(item);
  if (!coverId) coverId = item.id;
  renderGallery();
  setImageStatus(`${items.length} billede${items.length === 1 ? '' : 'r'} klar · ${fmtBytes(jpeg.size)}`, 'ok');
}

async function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;
    try {
      await addBlob(file, file.name);
    } catch (error) {
      setImageStatus((error as Error).message, 'error');
    }
  }
}

function renderGallery() {
  gallery.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'studio-empty';
    empty.textContent = 'Ingen billeder endnu. Tag et med kameraet, eller vælg fra telefonen.';
    gallery.append(empty);
    return;
  }

  for (const item of items) {
    const figure = document.createElement('figure');
    const imageWrap = document.createElement('div');
    imageWrap.className = 'studio-gallery-image';
    const image = document.createElement('img');
    image.src = item.url;
    image.alt = item.caption || 'Billede';
    imageWrap.append(image);
    if (item.id === coverId) {
      const badge = document.createElement('span');
      badge.className = 'studio-cover-badge';
      badge.textContent = 'Forside';
      imageWrap.append(badge);
    }

    const caption = document.createElement('div');
    caption.className = 'studio-gallery-caption';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 240;
    input.placeholder = 'Billedtekst';
    input.value = item.caption;
    input.addEventListener('input', () => {
      item.caption = input.value;
      image.alt = input.value || 'Billede';
    });

    const actions = document.createElement('div');
    actions.className = 'studio-gallery-actions';

    const rotate = document.createElement('button');
    rotate.type = 'button';
    rotate.textContent = '↻ Drej';
    rotate.className = 'is-secondary';
    rotate.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      try {
        const bitmap = await createImageBitmap(item.blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.height;
        canvas.height = bitmap.width;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Billedet kunne ikke drejes.');
        context.translate(canvas.width, 0);
        context.rotate(Math.PI / 2);
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Billedet kunne ikke gemmes.'))), 'image/jpeg', 0.86));
        URL.revokeObjectURL(item.url);
        item.blob = blob;
        item.url = URL.createObjectURL(blob);
        renderGallery();
      } catch (error) {
        setImageStatus((error as Error).message, 'error');
      } finally {
        busy = false;
      }
    });

    const useAsCover = document.createElement('button');
    useAsCover.type = 'button';
    useAsCover.textContent = 'Forside';
    useAsCover.className = 'is-secondary';
    useAsCover.disabled = item.id === coverId;
    useAsCover.addEventListener('click', () => {
      coverId = item.id;
      renderGallery();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Fjern';
    remove.className = 'is-link';
    remove.addEventListener('click', () => {
      URL.revokeObjectURL(item.url);
      const index = items.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) items.splice(index, 1);
      if (coverId === item.id) coverId = items[0]?.id ?? '';
      renderGallery();
      setImageStatus(items.length ? `${items.length} billede${items.length === 1 ? '' : 'r'} klar` : 'Ingen billeder endnu.', items.length ? 'ok' : 'info');
    });

    actions.append(rotate, useAsCover, remove);
    caption.append(input, actions);
    figure.append(imageWrap, caption);
    gallery.append(figure);
  }
}

/* ---------- Kamera ---------- */

async function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  camera.srcObject = null;
  cameraStage.hidden = true;
  cameraEmpty.hidden = false;
}

async function startCamera() {
  try {
    await stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    camera.srcObject = cameraStream;
    await camera.play();
    cameraEmpty.hidden = true;
    cameraStage.hidden = false;
    setImageStatus('Kameraet er åbent. Tryk »Tag billede«.', 'ok');
  } catch (error) {
    const message = (error as Error).name === 'NotAllowedError'
      ? 'Du sagde nej til kameraet. Tillad adgang i browserens indstillinger, eller vælg et billede i stedet.'
      : `Kameraet kunne ikke åbnes: ${(error as Error).message}`;
    setImageStatus(message, 'error');
  }
}

function snap() {
  if (!camera.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = camera.videoWidth;
  canvas.height = camera.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.drawImage(camera, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(async (blob) => {
    if (blob) await addBlob(blob, `kamera-${Date.now()}.jpg`);
  }, 'image/jpeg', 0.9);
}

startButton.addEventListener('click', startCamera);
snapButton.addEventListener('click', snap);
switchButton.addEventListener('click', () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  void startCamera();
});
stopButton.addEventListener('click', () => void stopCamera());

pickButton.addEventListener('click', () => fileInput.click());
maybe<HTMLButtonElement>('#image-pick-stage')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files) void addFiles(fileInput.files);
  fileInput.value = '';
});

for (const eventName of ['dragenter', 'dragover']) {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
  });
}
drop.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files) void addFiles(event.dataTransfer.files);
});
document.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
  if (files.length) void addFiles(files);
});

googleButton.addEventListener('click', async () => {
  setBusy(googleButton, true);
  setImageStatus('Åbner Google Fotos …', 'busy');
  try {
    const { pickGooglePhotos } = await import('./google-photos');
    const files = await pickGooglePhotos(googleClientId);
    await addFiles(files);
  } catch (error) {
    setImageStatus((error as Error).message, 'error');
  } finally {
    setBusy(googleButton, false);
  }
});

/* ---------- Udgivelse ---------- */

function fileNameFor(index: number) {
  return `billede-${index + 1}.jpg`;
}

setupPublishPanel({
  validate: () => (items.length ? null : 'Tag eller vælg mindst ét billede først.'),
  getFiles: async () =>
    Promise.all(items.map(async (item, index) => ({
      name: fileNameFor(index),
      bytes: new Uint8Array(await item.blob.arrayBuffer()),
      type: 'image/jpeg',
    }))),
  buildBody: (uploaded) => {
    const slug = readMeta().slug;
    return items.map((item, index) => {
      const name = fileNameFor(index);
      const url = uploaded.find((media) => media.name === name)?.url ?? `/media/uploads/${slug}/${name}`;
      const caption = (item.caption || '').replace(/]/g, '');
      const alt = (caption || 'Billede').replace(/"/g, '');
      const wide = items.length === 1 ? ' bred' : '';
      return `::billede[${caption}]{src="${url}" alt="${alt}"${wide}}`;
    }).join('\n\n');
  },
  getExtra: (uploaded) => {
    const index = Math.max(0, items.findIndex((item) => item.id === coverId));
    const name = fileNameFor(index);
    const url = uploaded.find((media) => media.name === name)?.url
      ?? `/media/uploads/${readMeta().slug}/${name}`;
    return { cover: url };
  },
});

renderGallery();
window.addEventListener('pagehide', () => {
  void stopCamera();
  items.forEach((item) => URL.revokeObjectURL(item.url));
});
