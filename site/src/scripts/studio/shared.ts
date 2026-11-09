// Fælles hjælpere og udgivelsesflow for alle opslagstyper i /studie/.
import {
  getSettings,
  publishMarkdown,
  uploadMedia,
  type CommitResult,
} from './github';

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
      throw new Error(`“${file.name}” er ${fmtBytes(file.bytes.length)}. GitHub kan ikke tage filer over ca. 45 MB – upload den store fil til YouTube/podcastværten i stedet.`);
    }
    const name = safeFileName(file.name);
    const path = `site/public/media/uploads/${slug}/${name}`;
    onProgress?.(`Uploader ${index + 1}/${files.length}: ${name} (${fmtBytes(file.bytes.length)}) …`, 0.08 + (index / Math.max(files.length, 1)) * 0.7);
    await uploadMedia(path, file.bytes, `Upload ${name} til ${slug}`);
    uploaded.push({ ...file, name, path, url: `/media/uploads/${slug}/${name}` });
  }
  return uploaded;
}

export interface PublishOptions {
  meta: PostMeta;
  files: MediaFile[];
  body: (uploaded: UploadedMedia[]) => string;
  extra?: (uploaded: UploadedMedia[]) => Record<string, unknown>;
  onStatus?: (message: string, progress: number) => void;
}

export async function publish(options: PublishOptions): Promise<{ commit: CommitResult; media: UploadedMedia[] }> {
  const error = validateMeta(options.meta);
  if (error) throw new Error(error);
  if (!getSettings().token) {
    throw new Error('Sæt GitHub-token op øverst på siden (under GitHub-forbindelse), før du udgiver.');
  }
  options.onStatus?.('Uploader medier …', 0.05);
  const media = await uploadAll(options.files, options.meta.slug, options.onStatus);
  const markdown = buildMarkdown(options.meta, options.body(media), options.extra?.(media) ?? {});
  options.onStatus?.('Opretter indlægget i GitHub …', 0.88);
  const commit = await publishMarkdown(options.meta.slug, markdown, `Nyt opslag: ${options.meta.title}`);
  options.onStatus?.('Indlægget er gemt. GitHub Actions bygger bloggen om et par minutter.', 1);
  return { commit, media };
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
  afterPublish?: (result: { commit: CommitResult; media: UploadedMedia[] }) => void;
}

export function setupPublishPanel(handlers: PublishPanelHandlers) {
  const date = maybe<HTMLInputElement>('#pub-date');
  if (date && !date.value) date.value = toLocalInput(new Date());
  setupSlugField();

  const status = maybe<HTMLElement>('#pub-status');
  const go = maybe<HTMLButtonElement>('#pub-go');
  const copy = maybe<HTMLButtonElement>('#pub-copy');
  if (!go || !copy || !status) return;

  copy.addEventListener('click', async () => {
    const meta = readMeta();
    const error = validateMeta(meta) ?? handlers.validate?.();
    if (error) {
      setStatus(status, error, 'error');
      return;
    }
    const markdown = buildMarkdown(meta, handlers.buildBody([]), handlers.getExtra?.([]) ?? {});
    await copyText(markdown, 'Markdown kopieret');
    setStatus(status, 'Markdown ligger i udklipsholderen. Filnavne er pladsholdere, indtil du udgiver herfra.', 'ok');
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
        onStatus: (message, progress) => {
          setStatus(status, `${message} ${progress > 0 && progress < 1 ? `(${Math.round(progress * 100)} %)` : ''}`.trim(), 'busy');
        },
      });
      status.replaceChildren();
      status.dataset.kind = 'ok';
      status.append('Udgivet. GitHub bygger bloggen om et par minutter. ');
      if (result.commit.commitUrl) {
        const link = document.createElement('a');
        link.href = result.commit.commitUrl;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Se ændringen på GitHub';
        status.append(link);
      }
      toast('Opslaget er udgivet');
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
