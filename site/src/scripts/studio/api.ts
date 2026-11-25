// Database-API'et til /studie/. Admin-nøglen gemmes kun i denne fane.
const KEY_STORAGE = 'blog-admin-key';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getAdminKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveAdminKey(value: string) {
  try {
    const key = value.trim();
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* privat vindue */
  }
}

export function forgetAdminKey() {
  saveAdminKey('');
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = getAdminKey();
  if (!key) throw new Error('Indsæt admin-nøglen under Admin-adgang først.');

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Admin-Key': key,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    if (response.status === 401) throw new ApiError(401, 'Admin-nøglen blev afvist. Tjek nøglen på webhotellet.');
    let detail = '';
    try { detail = await response.text(); } catch { /* tomt svar */ }
    throw new ApiError(response.status, detail.trim() || `Serveren svarede ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function testConnection(): Promise<string> {
  if (!getAdminKey()) throw new Error('Indsæt admin-nøglen først.');
  const posts = await api<unknown[]>('/api/admin/blog/posts');
  return `Forbundet · ${posts.length} databaseindlæg`;
}

export interface MediaFileInput {
  name: string;
  bytes: Uint8Array;
  type: string;
}

export interface UploadedMediaResult {
  url: string;
  name: string;
}

export async function uploadMedia(
  file: MediaFileInput,
  slug: string,
  publicPath: string,
  onProgress?: (fraction: number) => void,
): Promise<UploadedMediaResult> {
  const type = file.type || 'application/octet-stream';
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await new Promise<{ id: number; url: string; name: string }>((resolve, reject) => {
        const form = new FormData();
        form.append('file', new Blob([file.bytes], { type }), file.name);
        form.set('postSlug', slug);
        form.set('publicPath', publicPath);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/admin/blog/media');
        const adminKey = getAdminKey();
        if (!adminKey) return reject(new Error('Indsæt admin-nøglen under Admin-adgang først.'));
        xhr.setRequestHeader('X-Admin-Key', adminKey);
        xhr.timeout = 5 * 60_000;
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) onProgress?.(event.loaded / event.total);
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText) as { id: number; url: string; name: string }); }
            catch { reject(new Error('Serveren sendte et ugyldigt svar efter upload.')); }
          } else if (xhr.status === 401) reject(new Error('Admin-nøglen blev afvist.'));
          else reject(new Error(xhr.responseText.trim() || `Upload fejlede (${xhr.status}).`));
        });
        xhr.addEventListener('error', () => reject(new Error('Netværket faldt ud under upload.')));
        xhr.addEventListener('timeout', () => reject(new Error('Upload tog over fem minutter. Prøv en mindre fil.')));
        xhr.send(form);
      });
      onProgress?.(1);
      // Nye uploads ligger i databasen og hentes gennem API-ruten. Den gamle
      // publicPath bevares som metadata til de indlæg, der stadig peger på /media/.
      return { url: result.url, name: result.name || file.name };
    } catch (error) {
      lastError = error as Error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('Upload fejlede.');
}

export interface StudioPostPayload {
  title: string;
  description: string;
  bodyMarkdown: string;
  bodyHtml: string;
  tldr: string;
  publishDate: string;
  draft: boolean;
  tags: string[];
  sites: string[];
  cover: string | null;
  video: string | null;
  videoFormat: string | null;
  font: string;
  voice?: string | null;
  captions?: string | null;
  archived: boolean;
  readingMinutes?: number;
  interactive: { comments: boolean; highlights: boolean; graffiti: boolean; readAloud: boolean };
}

export async function savePost(slug: string, payload: StudioPostPayload): Promise<{ slug: string; draft: boolean; title: string }> {
  return api<{ slug: string; draft: boolean; title: string }>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function postExists(slug: string): Promise<boolean> {
  try {
    await api<unknown>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

export interface PostSummary {
  slug: string;
  title: string;
  description?: string | null;
  publishDate: string;
  updated?: string | null;
  draft: boolean;
  tags: string[];
  sites: string[];
  cover?: string | null;
  readingMinutes: number;
  archived: boolean;
  deletedAt?: string | null;
  status: 'live' | 'kladde' | 'planlagt' | 'slettet';
}

export interface PostDetail extends PostSummary {
  tldr?: string | null;
  bodyMarkdown?: string | null;
  bodyHtml?: string | null;
  links: { title: string; url: string }[];
  video?: string | null;
  videoFormat?: string | null;
  font: string;
  voice?: string | null;
  captions?: string | null;
  interactive: { comments?: boolean; highlights?: boolean; graffiti?: boolean; readAloud?: boolean };
}

export async function getPost(slug: string): Promise<PostDetail> {
  return api<PostDetail>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`);
}

export async function listPosts(trash = false): Promise<PostSummary[]> {
  return api<PostSummary[]>(`/api/admin/blog/posts${trash ? '?trash=true' : ''}`);
}

export async function trashPost(slug: string): Promise<void> {
  await api<void>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

export async function restorePost(slug: string): Promise<PostDetail> {
  return api<PostDetail>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/restore`, { method: 'POST' });
}

export async function purgePost(slug: string): Promise<void> {
  await api<void>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/purge`, { method: 'DELETE' });
}

export async function previewLink(slug: string): Promise<{ url: string; expires: string }> {
  return api<{ url: string; expires: string }>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/preview-link`, { method: 'POST' });
}

export interface Revision {
  id: number;
  title: string;
  createdAt: string;
}

export async function listRevisions(slug: string): Promise<Revision[]> {
  return api<Revision[]>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/revisions`);
}

export async function restoreRevision(slug: string, id: number): Promise<PostDetail> {
  return api<PostDetail>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/revisions/${id}/restore`, { method: 'POST' });
}

export interface MediaSummary {
  id: number;
  fileName: string;
  contentType: string;
  postSlug?: string | null;
  publicPath?: string | null;
  size: number;
  createdAt: string;
  url: string;
  usedBy: string[];
  orphan: boolean;
}

export async function listMedia(): Promise<MediaSummary[]> {
  return api<MediaSummary[]>('/api/admin/blog/media');
}

export async function deleteMedia(id: number): Promise<void> {
  await api<void>(`/api/admin/blog/media/${id}`, { method: 'DELETE' });
}

export async function cleanupMedia(): Promise<{ removed: number }> {
  return api<{ removed: number }>('/api/admin/blog/media/cleanup', { method: 'POST' });
}

export interface Diagnostics {
  ok: boolean;
  database: string;
  adminKeyConfigured: boolean;
  posts: number;
  published: number;
  drafts: number;
  trash: number;
  mediaCount: number;
  mediaBytes: number;
  mediaOrphans: number;
  backupCount: number;
  latestBackup?: string | null;
  maxUploadMb: number;
  serverUtc: string;
}

export async function diagnostics(): Promise<Diagnostics> {
  return api<Diagnostics>('/api/admin/diagnostics');
}

export async function listAudit(): Promise<{ id: number; action: string; entity: string; entityId?: string; detail?: string; createdAt: string }[]> {
  return api<{ id: number; action: string; entity: string; entityId?: string; detail?: string; createdAt: string }[]>('/api/admin/audit');
}

export async function listBackups(): Promise<{ directory: string; files: { name: string; size: number; created: string }[] }> {
  return api<{ directory: string; files: { name: string; size: number; created: string }[] }>('/api/admin/backup');
}

export async function restoreBackup(file: File): Promise<{ postsAdded: number; postsUpdated: number; mediaAdded: number; mediaUpdated: number }> {
  const form = new FormData();
  form.set('file', file);
  return api<{ postsAdded: number; postsUpdated: number; mediaAdded: number; mediaUpdated: number }>('/api/admin/backup/restore', { method: 'POST', body: form });
}
