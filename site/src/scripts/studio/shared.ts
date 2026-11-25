// Fælles hjælpere og udgivelsesflow for alle opslagstyper i /studie/.
import { renderPostBody } from '../admin/render';
import { getAdminKey, getPost, postExists, previewLink, savePost, uploadMedia, type PostDetail, type StudioPostPayload } from './api';

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Mangler element: ${selector}`);
  return element;
};

export const maybe = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

export interface MediaFile {
  name: string;
  bytes: Uint8Array;
  type: string;
}

export interface UploadedMedia extends MediaFile {
  url: string;
  path: string;
}

export interface PostMeta {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  sites: string[];
  draft: boolean;
  publishDate: string;
  tldr: string;
  font: string;
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

export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'fil';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  return ext ? `${base}.${ext}` : base;
}

export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

export async function copyText(text: string, message = 'Kopieret') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast(message);
}

export function toast(message: string) {
  const element = document.createElement('div');
  element.className = 'studio-toast';
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 3800);
}

export function setStatus(
  target: string | HTMLElement,
  text: string,
  kind: 'info' | 'busy' | 'ok' | 'error' = 'info',
) {
  const element = typeof target === 'string' ? maybe<HTMLElement>(target) : target;
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
}

export function setBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
  button.dataset.busy = busy ? 'true' : '';
}

export function readMeta(): PostMeta {
  const value = (selector: string) => (maybe<HTMLInputElement | HTMLTextAreaElement>(selector)?.value ?? '').trim();
  const slugInput = maybe<HTMLInputElement>('#pub-slug');
  const fontSelect = maybe<HTMLSelectElement>('#pub-font');
  return {
    title: value('#pub-title'),
    description: value('#pub-desc'),
    slug: slugify(value('#pub-slug') || value('#pub-title')),
    tags: splitList(value('#pub-tags')),
    sites: splitList(value('#pub-sites')),
    draft: maybe<HTMLInputElement>('#pub-draft')?.checked ?? false,
    publishDate: value('#pub-date') || toLocalInput(new Date()),
    tldr: value('#pub-tldr'),
    font: fontSelect?.value || 'serif',
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function buildMarkdown(meta: PostMeta, body: string, extra: Record<string, unknown> = {}): string {
  const publishDate = new Date(meta.publishDate);
  const lines = [
    `title: ${yamlString(meta.title)}`,
    meta.description ? `description: ${yamlString(meta.description)}` : '',
    `publishDate: ${yamlString(Number.isNaN(publishDate.valueOf()) ? new Date().toISOString() : publishDate.toISOString())}`,
    `draft: ${meta.draft}`,
    `tags: [${meta.tags.map(yamlString).join(', ')}]`,
    `sites: [${meta.sites.map(yamlString).join(', ')}]`,
    `font: ${yamlString(meta.font)}`,
    meta.tldr ? `tldr: ${yamlString(meta.tldr)}` : '',
    ...Object.entries(extra)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}: ${
        typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : typeof value === 'object'
            ? JSON.stringify(value)
            : yamlString(String(value))
      }`),
  ].filter(Boolean);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

function validateMeta(meta: PostMeta): string | null {
  if (!meta.title) return 'Indlægget mangler en titel.';
  if (!meta.slug || !/^[a-z0-9-]{1,80}$/.test(meta.slug)) return 'Adressen må kun indeholde a-z, 0-9 og bindestreg.';
  if (Number.isNaN(new Date(meta.publishDate).valueOf())) return 'Udgivelsesdatoen er ugyldig.';
  return null;
}

async function uploadAll(
  files: MediaFile[],
  slug: string,
  onProgress?: (message: string, progress: number) => void,
): Promise<UploadedMedia[]> {
  const uploaded: UploadedMedia[] = [];
  for (const [index, file] of files.entries()) {
    if (file.bytes.length > 45_000_000) {
      throw new Error(`“${file.name}” er ${fmtBytes(file.bytes.length)}. API'et kan ikke tage filer over ca. 45 MB – upload den store fil til YouTube/podcastværten i stedet.`);
    }
    const name = safeFileName(file.name);
    const path = `/media/uploads/${slug}/${name}`;
    onProgress?.(`Uploader ${index + 1}/${files.length}: ${name} (${fmtBytes(file.bytes.length)}) …`, 0.08 + (index / Math.max(files.length, 1)) * 0.7);
    await uploadMedia(file, slug, path, (fraction) => {
      onProgress?.(`Uploader ${index + 1}/${files.length}: ${name} (${fmtBytes(file.bytes.length)}) …`, 0.08 + ((index + fraction) / Math.max(files.length, 1)) * 0.7);
    });
    uploaded.push({ ...file, name, path, url: path });
  }
  return uploaded;
}

export interface PublishOptions {
  meta: PostMeta;
  files: MediaFile[];
  body: (uploaded: UploadedMedia[]) => string;
  extra?: (uploaded: UploadedMedia[]) => Record<string, unknown>;
  onStatus?: (message: string, progress: number) => void;
  editSlug?: string;
}

export interface PublishedPost {
  slug: string;
  title: string;
  draft: boolean;
}

export interface PublishResult {
  post: PublishedPost;
  media: UploadedMedia[];
}

export async function publish(options: PublishOptions): Promise<PublishResult> {
  const error = validateMeta(options.meta);
  if (error) throw new Error(error);
  if (!getAdminKey()) {
    throw new Error('Indsæt admin-nøglen under Admin-adgang, før du gemmer.');
  }
  if (!options.editSlug && await postExists(options.meta.slug)) {
    throw new Error(`Der findes allerede et indlæg på adressen “${options.meta.slug}”. Vælg en anden adresse.`);
  }

  options.onStatus?.('Uploader medier …', 0.05);
  const media = await uploadAll(options.files, options.meta.slug, options.onStatus);
  const bodyMarkdown = options.body(media);
  const extra = options.extra?.(media) ?? {};
  const publishDate = new Date(options.meta.publishDate);
  const videoFormat = extra.videoFormat === 'lodret' || extra.videoFormat === 'vandret'
    ? (extra.videoFormat as 'lodret' | 'vandret')
    : null;
  const payload: StudioPostPayload = {
    title: options.meta.title,
    description: options.meta.description,
    bodyMarkdown,
    bodyHtml: renderPostBody(bodyMarkdown),
    tldr: options.meta.tldr,
    publishDate: publishDate.toISOString(),
    draft: options.meta.draft,
    tags: options.meta.tags,
    sites: options.meta.sites,
    cover: typeof extra.cover === 'string' ? extra.cover : null,
    video: typeof extra.video === 'string' ? extra.video : null,
    videoFormat,
    font: options.meta.font,
    voice: typeof extra.voice === 'string' ? extra.voice : null,
    captions: typeof extra.captions === 'string' ? extra.captions : null,
    archived: extra.archived === true,
    readingMinutes: Math.max(1, Math.round(bodyMarkdown.trim().split(/\s+/).length / 200)),
    interactive: { comments: true, highlights: true, graffiti: true, readAloud: true },
  };

  options.onStatus?.('Gemmer indlægget i databasen …', 0.9);
  const post = await savePost(options.editSlug ?? options.meta.slug, payload);
  options.onStatus?.(options.editSlug ? 'Ændringerne er gemt.' : 'Indlægget ligger i databasen og er live med det samme.', 1);
  return { post, media };
}

export function placeholderMediaUrl(slug: string, name: string): string {
  return `/media/uploads/${slug}/${safeFileName(name)}`;
}

export function setupSlugField() {
  const title = maybe<HTMLInputElement>('#pub-title');
  const slug = maybe<HTMLInputElement>('#pub-slug');
  if (!title || !slug) return;
  let touched = false;
  slug.addEventListener('input', () => {
    touched = true;
  });
  title.addEventListener('input', () => {
    if (!touched) slug.value = slugify(title.value);
  });
}

export interface PublishPanelHandlers {
  buildBody: (uploaded: UploadedMedia[]) => string;
  getFiles?: () => MediaFile[] | Promise<MediaFile[]>;
  getExtra?: (uploaded: UploadedMedia[]) => Record<string, unknown>;
  validate?: () => string | null;
  afterPublish?: (result: PublishResult) => void;
  load?: (post: PostDetail) => void;
}

function fillMeta(post: PostDetail) {
  const set = (selector: string, value: string) => {
    const field = maybe<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
    if (field) field.value = value;
  };
  set('#pub-title', post.title ?? '');
  set('#pub-desc', post.description ?? '');
  set('#pub-slug', post.slug);
  set('#pub-tags', (post.tags ?? []).join(', '));
  set('#pub-sites', (post.sites ?? []).join(', '));
  set('#pub-tldr', post.tldr ?? '');
  set('#pub-font', post.font || 'serif');
  set('#pub-date', post.publishDate ? toLocalInput(new Date(post.publishDate)) : toLocalInput(new Date()));
  const draft = maybe<HTMLInputElement>('#pub-draft');
  if (draft) draft.checked = post.draft;
  const slug = maybe<HTMLInputElement>('#pub-slug');
  if (slug) slug.readOnly = true;
}

export function setupAutosave(
  name: string,
  getValue: () => string,
  setValue: (value: string) => void,
) {
  try {
    if (!window.localStorage) return;
  } catch {
    return;
  }
  const slug = new URLSearchParams(window.location.search).get('slug') ?? 'ny';
  const storageKey = `blog-autosave:${name}:${slug}`;
  let timer = 0;
  let dirty = false;
  const save = () => {
    try {
      const value = getValue();
      if (!value.trim()) return;
      localStorage.setItem(storageKey, JSON.stringify({ value, savedAt: new Date().toISOString() }));
    } catch { /* privat vindue */ }
  };
  const schedule = () => {
    dirty = true;
    clearTimeout(timer);
    timer = window.setTimeout(save, 1200);
  };
  window.addEventListener('pagehide', () => {
    if (dirty) save();
  });

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { schedule };
    const saved = JSON.parse(raw) as { value?: string; savedAt?: string };
    if (!saved.value?.trim() || saved.value === getValue()) return { schedule };
    const bar = document.createElement('div');
    bar.className = 'studio-recovery';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = `Der ligger en automatisk gemt kladde fra ${new Date(saved.savedAt ?? Date.now()).toLocaleString('da-DK')}.`;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'is-secondary';
    restore.textContent = 'Gendan';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'is-secondary';
    discard.textContent = 'Smid væk';
    restore.addEventListener('click', () => {
      setValue(saved.value!);
      localStorage.removeItem(storageKey);
      bar.remove();
      toast('Kladden er gendannet.');
    });
    discard.addEventListener('click', () => {
      localStorage.removeItem(storageKey);
      bar.remove();
    });
    bar.append(text, restore, discard);
    maybe('#pub-status')?.before(bar);
  } catch { /* ugyldig gammel kladde */ }
  return { schedule };
}

export function setupPublishPanel(handlers: PublishPanelHandlers) {
  const date = maybe<HTMLInputElement>('#pub-date');
  if (date && !date.value) date.value = toLocalInput(new Date());
  setupSlugField();

  const metaFields = ['#pub-title', '#pub-desc', '#pub-slug', '#pub-tags', '#pub-sites', '#pub-tldr', '#pub-font', '#pub-date'];
  const metaAutosave = setupAutosave('metadata', () => JSON.stringify(
    Object.fromEntries(metaFields.map((selector) => [selector, (maybe<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? '')])),
  ), (value) => {
    try {
      const saved = JSON.parse(value) as Record<string, string>;
      for (const selector of metaFields) {
        const field = maybe<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
        if (field && typeof saved[selector] === 'string') field.value = saved[selector];
      }
      if (maybe<HTMLInputElement>('#pub-draft')) maybe<HTMLInputElement>('#pub-draft')!.checked = false;
    } catch { /* ugyldig gammel metadata */ }
  });
  for (const selector of metaFields) {
    maybe(selector)?.addEventListener('input', () => metaAutosave?.schedule());
  }

  const status = maybe<HTMLElement>('#pub-status');
  const go = maybe<HTMLButtonElement>('#pub-go');
  const copy = maybe<HTMLButtonElement>('#pub-copy');
  if (!go || !copy || !status) return;
  let currentSlug: string | null = new URLSearchParams(window.location.search).get('slug');
  const previewButton = maybe<HTMLButtonElement>('#pub-preview');
  const heading = maybe<HTMLElement>('#pub-heading');

  const refreshPreview = async () => {
    if (!previewButton || !currentSlug) return;
    previewButton.hidden = false;
    previewButton.onclick = async () => {
      try {
        setStatus(status, 'Laver et midlertidigt preview-link …', 'busy');
        const link = await previewLink(currentSlug!);
        await copyText(`${window.location.origin}${link.url}`, 'Preview-linket er kopieret. Det virker i syv dage.');
        setStatus(status, 'Preview-linket er kopieret. Det virker i syv dage.', 'ok');
      } catch (error) {
        setStatus(status, (error as Error).message, 'error');
      }
    };
  };

  if (currentSlug) {
    setStatus(status, 'Henter det gemte indlæg …', 'busy');
    void getPost(currentSlug).then((post) => {
      fillMeta(post);
      if (heading) heading.textContent = 'Redigér opslaget';
      go.textContent = 'Gem ændringer';
      handlers.load?.(post);
      void refreshPreview();
      setStatus(status, `Redigerer “${post.title}”. Ændringer gemmes på samme adresse.`, 'ok');
    }).catch((error) => setStatus(status, (error as Error).message, 'error'));
  }

  copy.addEventListener('click', async () => {
    const meta = readMeta();
    const error = validateMeta(meta) ?? handlers.validate?.();
    if (error) {
      setStatus(status, error, 'error');
      return;
    }
    const markdown = buildMarkdown(meta, handlers.buildBody([]), handlers.getExtra?.([]) ?? {});
    await copyText(markdown, 'Markdown kopieret');
    setStatus(status, 'Markdown ligger i udklipsholderen. Billedstier er pladsholdere, indtil du gemmer herfra.', 'ok');
  });

  go.addEventListener('click', async () => {
    const meta = readMeta();
    const error = validateMeta(meta) ?? handlers.validate?.();
    if (error) {
      setStatus(status, error, 'error');
      return;
    }
    setBusy(go, true);
    setStatus(status, 'Forbereder …', 'busy');
    try {
      const files = (await handlers.getFiles?.()) ?? [];
      const result = await publish({
        meta,
        files,
        body: handlers.buildBody,
        extra: handlers.getExtra,
        editSlug: currentSlug ?? undefined,
        onStatus: (message, progress) => {
          setStatus(status, `${message} ${progress > 0 && progress < 1 ? `(${Math.round(progress * 100)} %)` : ''}`.trim(), 'busy');
        },
      });
      currentSlug = result.post.slug;
      const slugField = maybe<HTMLInputElement>('#pub-slug');
      if (slugField) slugField.readOnly = true;
      if (heading) heading.textContent = 'Redigér opslaget';
      go.textContent = 'Gem ændringer';
      history.replaceState(null, '', `?slug=${encodeURIComponent(result.post.slug)}`);
      void refreshPreview();
      status.replaceChildren();
      status.dataset.kind = 'ok';
      status.append('Indlægget er gemt i databasen. ');
      const link = document.createElement('a');
      link.href = `/admin/?slug=${encodeURIComponent(result.post.slug)}`;
      link.textContent = 'Fortsæt i skriveværktøjet';
      status.append(link);
      toast(result.post.draft ? 'Kladden er gemt' : 'Opslaget er gemt');
      handlers.afterPublish?.(result);
    } catch (error) {
      setStatus(status, (error as Error).message, 'error');
    } finally {
      setBusy(go, false);
    }
  });
}

export function updateCaptionFields() {
  const titleInput = maybe<HTMLInputElement>('#pub-title');
  const descInput = maybe<HTMLTextAreaElement>('#pub-desc');
  const tagsInput = maybe<HTMLInputElement>('#pub-tags');
  const instagram = maybe<HTMLTextAreaElement>('#caption-instagram');
  const youtubeTitle = maybe<HTMLInputElement>('#caption-youtube-title');
  const youtubeDesc = maybe<HTMLTextAreaElement>('#caption-youtube-desc');
  if (!instagram || !youtubeTitle || !youtubeDesc) return;

  const update = () => {
    const title = titleInput?.value.trim() || 'Mit klip';
    const description = descInput?.value.trim() || '';
    const hashtags = splitList(tagsInput?.value ?? '')
      .map((tag) => `#${tag.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, '')}`)
      .filter((tag) => tag.length > 1)
      .join(' ');
    instagram.value = [title, description, hashtags].filter(Boolean).join('\n\n');
    youtubeTitle.value = title.slice(0, 100);
    youtubeDesc.value = [description, hashtags].filter(Boolean).join('\n\n');
  };
  for (const input of [titleInput, descInput, tagsInput]) input?.addEventListener('input', update);
  update();
}
