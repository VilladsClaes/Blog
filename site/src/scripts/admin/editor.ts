// /admin/ – skriv og gem direkte i bloggens database. Ingen GitHub-token.
import { countWords, renderPostBody, slugify } from './render';

type PostSummary = {
  slug: string;
  title: string;
  publishDate: string;
  updated?: string | null;
  draft: boolean;
  status: string;
  deletedAt?: string | null;
};

type Link = { title: string; url: string };

type PostDetail = PostSummary & {
  description?: string | null;
  tldr?: string | null;
  bodyMarkdown?: string | null;
  bodyHtml?: string | null;
  tags: string[];
  sites: string[];
  links: Link[];
  cover?: string | null;
  video?: string | null;
  videoFormat?: string | null;
  captions?: string | null;
  font: string;
  archived: boolean;
  readingMinutes: number;
  interactive: {
    comments?: boolean;
    highlights?: boolean;
    graffiti?: boolean;
    readAloud?: boolean;
  };
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Mangler element: ${selector}`);
  return element;
};

const keyInput = $<HTMLInputElement>('#admin-key');
const keyStatus = $('#key-status');
const postList = $<HTMLUListElement>('#post-list');
const newButton = $<HTMLButtonElement>('#new-post');
const form = $<HTMLFormElement>('#post-form');
const saveStatus = $('#save-status');
const saveButton = $<HTMLButtonElement>('#save-post');
const deleteButton = $<HTMLButtonElement>('#delete-post');
const titleInput = $<HTMLInputElement>('#post-title');
const slugInput = $<HTMLInputElement>('#post-slug');
const dateInput = $<HTMLInputElement>('#post-date');
const descriptionInput = $<HTMLTextAreaElement>('#post-description');
const tldrInput = $<HTMLTextAreaElement>('#post-tldr');
const tagsInput = $<HTMLInputElement>('#post-tags');
const sitesInput = $<HTMLInputElement>('#post-sites');
const fontInput = $<HTMLSelectElement>('#post-font');
const draftInput = $<HTMLInputElement>('#post-draft');
const archivedInput = $<HTMLInputElement>('#post-archived');
const coverInput = $<HTMLInputElement>('#post-cover');
const coverFile = $<HTMLInputElement>('#cover-file');
const coverStatus = $('#cover-status');
const coverPreview = $<HTMLImageElement>('#cover-preview');
const videoInput = $<HTMLInputElement>('#post-video');
const videoFormatInput = $<HTMLSelectElement>('#post-video-format');
const captionsInput = $<HTMLInputElement>('#post-captions');
const bodyInput = $<HTMLTextAreaElement>('#post-body');
const preview = $<HTMLDivElement>('#post-preview');
const wordCount = $('#word-count');
const bodyImageFile = $<HTMLInputElement>('#body-image-file');
const commentsInput = $<HTMLInputElement>('#feature-comments');
const highlightsInput = $<HTMLInputElement>('#feature-highlights');
const graffitiInput = $<HTMLInputElement>('#feature-graffiti');
const readAloudInput = $<HTMLInputElement>('#feature-read-aloud');
const postStatus = $('#post-status');
const previewButton = $<HTMLButtonElement>('#copy-preview');
const trashList = $<HTMLUListElement>('#trash-list');
const trashStatus = $('#trash-status');
const mediaList = $<HTMLUListElement>('#media-list');
const mediaStatus = $('#media-status');
const cleanupMediaButton = $<HTMLButtonElement>('#cleanup-media');
const diagnosticsStatus = $('#diagnostics-status');
const backupExportButton = $<HTMLButtonElement>('#backup-export');
const backupFile = $<HTMLInputElement>('#backup-file');
const backupStatus = $('#backup-status');
const revisionList = $<HTMLUListElement>('#revision-list');

let key = sessionStorage.getItem('blog-admin-key') ?? '';
let editingSlug: string | null = null;
let slugTouched = false;
let keyTimer: number | undefined;
let autosaveTimer: number | undefined;

const setStatus = (element: HTMLElement, text: string, kind: 'info' | 'busy' | 'ok' | 'error' = 'info') => {
  element.textContent = text;
  element.dataset.kind = kind;
};

const statusLabel = (status: string) =>
  status === 'live' ? 'live' : status === 'kladde' ? 'kladde' : status === 'planlagt' ? 'planlagt' : status === 'slettet' ? 'i papirkurven' : 'ny';

const setPostStatus = (status: string) => {
  postStatus.textContent = statusLabel(status);
  postStatus.dataset.status = status;
};

const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'X-Admin-Key': key } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Admin-nøglen blev afvist. Tjek nøglen på webhotellet.');
    const text = await response.text();
    throw new Error(text || `Serveren svarede ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const toLocalInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const splitList = (value: string) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });

const setCover = (url: string | null) => {
  coverInput.value = url ?? '';
  if (url) {
    coverPreview.src = url;
    coverPreview.hidden = false;
  } else {
    coverPreview.removeAttribute('src');
    coverPreview.hidden = true;
  }
};

const updatePreview = () => {
  preview.innerHTML = renderPostBody(bodyInput.value);
  const words = countWords(bodyInput.value);
  wordCount.textContent = `${words} ord · ca. ${Math.max(1, Math.round(words / 200))} min.`;
};

const updateSlug = () => {
  if (!slugTouched && !editingSlug) slugInput.value = slugify(titleInput.value);
};

const fill = (post: PostDetail) => {
  editingSlug = post.slug;
  deleteButton.hidden = false;
  deleteButton.disabled = false;
  slugTouched = true;
  titleInput.value = post.title;
  slugInput.value = post.slug;
  slugInput.readOnly = true;
  dateInput.value = toLocalInput(new Date(post.publishDate));
  descriptionInput.value = post.description ?? '';
  tldrInput.value = post.tldr ?? '';
  tagsInput.value = post.tags.join(', ');
  sitesInput.value = post.sites.join(', ');
  fontInput.value = post.font || 'serif';
  draftInput.checked = post.draft;
  archivedInput.checked = post.archived;
  videoInput.value = post.video ?? '';
  videoFormatInput.value = post.videoFormat ?? '';
  captionsInput.value = post.captions ?? '';
  bodyInput.value = post.bodyMarkdown ?? '';
  commentsInput.checked = post.interactive.comments ?? true;
  highlightsInput.checked = post.interactive.highlights ?? true;
  graffitiInput.checked = post.interactive.graffiti ?? true;
  readAloudInput.checked = post.interactive.readAloud ?? true;
  setCover(post.cover ?? null);
  updatePreview();
  setPostStatus(post.status);
  previewButton.hidden = false;
  deleteButton.textContent = 'Flyt til papirkurv';
  void loadRevisions(post.slug);
  setStatus(saveStatus, `Redigerer “${post.title}”.`, 'info');
};

const loadList = async () => {
  if (!key) {
    setStatus(keyStatus, 'Indsæt admin-nøglen for at se indlæggene.', 'info');
    return;
  }

  try {
    setStatus(keyStatus, 'Henter indlæg …', 'busy');
    const posts = await api<PostSummary[]>('/api/admin/blog/posts');
    postList.replaceChildren();
    if (posts.length === 0) {
      const item = document.createElement('li');
      item.className = 'admin-note';
      item.textContent = 'Der er ingen databaseindlæg endnu.';
      postList.append(item);
    } else {
      for (const post of posts) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-post-link';
        button.dataset.slug = post.slug;
        if (post.slug === editingSlug) button.dataset.current = 'true';
        const title = document.createElement('strong');
        title.textContent = post.title;
        const meta = document.createElement('span');
        meta.textContent = `${formatDate(post.publishDate)}${post.draft ? ' · kladde' : ''}`;
        button.append(title, meta);
        button.addEventListener('click', () => void loadPost(post.slug));
        item.append(button);
        postList.append(item);
      }
    }
    setStatus(keyStatus, `${posts.length} indlæg i databasen.`, 'ok');
    void loadTrash();
    void loadMedia();
    void loadDiagnostics();
  } catch (error) {
    setStatus(keyStatus, (error as Error).message, 'error');
  }
};

const loadPost = async (slug: string) => {
  if (!key) {
    setStatus(saveStatus, 'Indsæt admin-nøglen først.', 'error');
    return;
  }

  try {
    setStatus(saveStatus, 'Henter indlæg …', 'busy');
    const post = await api<PostDetail>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`);
    fill(post);
    void loadTrash();
    for (const button of postList.querySelectorAll<HTMLButtonElement>('.admin-post-link')) {
      button.dataset.current = String(button.dataset.slug === slug);
    }
    history.replaceState(null, '', `/admin/?slug=${encodeURIComponent(slug)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    setStatus(saveStatus, (error as Error).message, 'error');
  }
};

const reset = () => {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* privat vindue */ }
  editingSlug = null;
  slugTouched = false;
  deleteButton.hidden = true;
  deleteButton.disabled = false;
  form.reset();
  slugInput.readOnly = false;
  dateInput.value = toLocalInput(new Date());
  fontInput.value = 'serif';
  draftInput.checked = false;
  archivedInput.checked = false;
  commentsInput.checked = true;
  highlightsInput.checked = true;
  graffitiInput.checked = true;
  readAloudInput.checked = true;
  videoFormatInput.value = '';
  captionsInput.value = '';
  setCover(null);
  bodyInput.value = '';
  updatePreview();
  setPostStatus('ny');
  previewButton.hidden = true;
  revisionList.replaceChildren();
  const revisionNote = document.createElement('li');
  revisionNote.className = 'admin-note';
  revisionNote.textContent = 'Gem indlægget én gang for at begynde versionshistorikken.';
  revisionList.append(revisionNote);
  for (const button of postList.querySelectorAll<HTMLButtonElement>('.admin-post-link')) {
    button.dataset.current = 'false';
  }
  history.replaceState(null, '', '/admin/');
  setStatus(saveStatus, 'Nyt indlæg. Det gemmes først, når du trykker gem.', 'info');
  titleInput.focus();
};

const upload = async (file: File): Promise<string> => {
  if (!key) throw new Error('Indsæt admin-nøglen først.');
  const data = new FormData();
  data.set('file', file);
  data.set('postSlug', editingSlug || slugify(titleInput.value));
  const result = await api<{ url: string }>('/api/admin/blog/media', { method: 'POST', body: data });
  return result.url;
};

const save = async () => {
  if (!key) {
    setStatus(saveStatus, 'Indsæt admin-nøglen først.', 'error');
    keyInput.focus();
    return;
  }

  const title = titleInput.value.trim();
  if (!title) {
    setStatus(saveStatus, 'Indlægget mangler en titel.', 'error');
    titleInput.focus();
    return;
  }
  const slug = slugify(slugInput.value || title);
  if (!slug) {
    setStatus(saveStatus, 'Adressen må kun indeholde a-z, 0-9 og bindestreg.', 'error');
    slugInput.focus();
    return;
  }
  const publishDate = new Date(dateInput.value);
  if (Number.isNaN(publishDate.valueOf())) {
    setStatus(saveStatus, 'Vælg et gyldigt udgivelsestidspunkt.', 'error');
    dateInput.focus();
    return;
  }

  const body = bodyInput.value;
  const payload = {
    title,
    description: descriptionInput.value.trim(),
    bodyMarkdown: body,
    bodyHtml: renderPostBody(body),
    tldr: tldrInput.value.trim(),
    publishDate: publishDate.toISOString(),
    draft: draftInput.checked,
    tags: splitList(tagsInput.value),
    sites: splitList(sitesInput.value),
    links: [],
    cover: coverInput.value || null,
    video: videoInput.value.trim() || null,
    videoFormat: videoFormatInput.value || null,
    captions: captionsInput.value.trim() || null,
    font: fontInput.value,
    archived: archivedInput.checked,
    readingMinutes: Math.max(1, Math.round(countWords(body) / 200)),
    interactive: {
      comments: commentsInput.checked,
      highlights: highlightsInput.checked,
      graffiti: graffitiInput.checked,
      readAloud: readAloudInput.checked,
    },
  };

  saveButton.disabled = true;
  setStatus(saveStatus, 'Gemmer i databasen …', 'busy');
  try {
    const post = await api<PostDetail>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    editingSlug = post.slug;
    deleteButton.hidden = false;
    deleteButton.textContent = 'Flyt til papirkurv';
    slugInput.value = post.slug;
    slugInput.readOnly = true;
    history.replaceState(null, '', `/admin/?slug=${encodeURIComponent(post.slug)}`);
    setPostStatus(post.status);
    previewButton.hidden = false;
    setStatus(saveStatus, post.draft ? 'Kladden er gemt i databasen.' : post.status === 'planlagt' ? 'Indlægget er gemt og udgives på det valgte tidspunkt.' : 'Indlægget er gemt i databasen og er live.', 'ok');
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* privat vindue */ }
    await loadList();
    await loadRevisions(post.slug);
    await loadTrash();
    await loadDiagnostics();
  } catch (error) {
    setStatus(saveStatus, (error as Error).message, 'error');
  } finally {
    saveButton.disabled = false;
  }
};

const remove = async () => {
  if (!key) {
    setStatus(saveStatus, 'Indsæt admin-nøglen først.', 'error');
    keyInput.focus();
    return;
  }
  if (!editingSlug) return;

  const slug = editingSlug;
  const title = titleInput.value.trim() || slug;
  if (!window.confirm(`Flyt “${title}” til papirkurven? Indlægget og medierne kan gendannes bagefter.`)) return;

  deleteButton.disabled = true;
  setStatus(saveStatus, 'Flytter indlægget til papirkurven …', 'busy');
  try {
    await api<void>(`/api/admin/blog/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    reset();
    await loadList();
    await loadTrash();
    setStatus(saveStatus, 'Indlægget ligger nu i papirkurven. Det kan gendannes.', 'ok');
  } catch (error) {
    setStatus(saveStatus, (error as Error).message, 'error');
  } finally {
    deleteButton.disabled = false;
  }
};

const loadRevisions = async (slug: string) => {
  revisionList.replaceChildren();
  try {
    const revisions = await api<{ id: number; title: string; createdAt: string }[]>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/revisions`);
    if (!revisions.length) {
      const note = document.createElement('li');
      note.className = 'admin-note';
      note.textContent = 'Ingen ældre versioner endnu. Næste gem gemmer den nuværende tekst.';
      revisionList.append(note);
      return;
    }
    for (const revision of revisions) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'admin-revision-row';
      const label = document.createElement('span');
      label.textContent = `${new Date(revision.createdAt).toLocaleString('da-DK')} · ${revision.title}`;
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'button button-ghost admin-small-button';
      restore.textContent = 'Gendan';
      restore.addEventListener('click', async () => {
        if (!window.confirm('Gendan denne version? Den nuværende tekst gemmes først som en ny version.')) return;
        try {
          const post = await api<PostDetail>(`/api/admin/blog/posts/${encodeURIComponent(slug)}/revisions/${revision.id}/restore`, { method: 'POST' });
          fill(post);
          setStatus(saveStatus, 'Versionen er gendannet.', 'ok');
        } catch (error) {
          setStatus(saveStatus, (error as Error).message, 'error');
        }
      });
      row.append(label, restore);
      item.append(row);
      revisionList.append(item);
    }
  } catch (error) {
    const note = document.createElement('li');
    note.className = 'admin-note';
    note.textContent = (error as Error).message;
    revisionList.append(note);
  }
};

const loadTrash = async () => {
  if (!key) return;
  try {
    const posts = await api<PostSummary[]>('/api/admin/blog/posts?trash=true');
    trashList.replaceChildren();
    if (!posts.length) {
      const note = document.createElement('li');
      note.className = 'admin-note';
      note.textContent = 'Papirkurven er tom.';
      trashList.append(note);
      setStatus(trashStatus, '', 'info');
      return;
    }
    for (const post of posts) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'admin-post-link';
      const title = document.createElement('strong');
      title.textContent = post.title;
      const meta = document.createElement('span');
      meta.textContent = `${formatDate(post.publishDate)} · ${statusLabel(post.status)}`;
      row.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'admin-action-buttons';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'button button-ghost admin-small-button';
      restore.textContent = 'Gendan';
      restore.addEventListener('click', async () => {
        try {
          await api(`/api/admin/blog/posts/${encodeURIComponent(post.slug)}/restore`, { method: 'POST' });
          await loadList();
          await loadTrash();
          setStatus(saveStatus, 'Indlægget er gendannet fra papirkurven.', 'ok');
        } catch (error) {
          setStatus(trashStatus, (error as Error).message, 'error');
        }
      });
      const purge = document.createElement('button');
      purge.type = 'button';
      purge.className = 'button button-ghost admin-small-button admin-delete-button';
      purge.textContent = 'Slet permanent';
      purge.addEventListener('click', async () => {
        if (!window.confirm(`Slet “${post.title}” og alle dets medier permanent? Det kan ikke fortrydes.`)) return;
        try {
          await api(`/api/admin/blog/posts/${encodeURIComponent(post.slug)}/purge`, { method: 'DELETE' });
          await loadTrash();
          if (editingSlug === post.slug) reset();
        } catch (error) {
          setStatus(trashStatus, (error as Error).message, 'error');
        }
      });
      actions.append(restore, purge);
      item.append(row, actions);
      trashList.append(item);
    }
    setStatus(trashStatus, `${posts.length} indlæg i papirkurven.`, 'info');
  } catch (error) {
    setStatus(trashStatus, (error as Error).message, 'error');
  }
};

type MediaSummary = {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  url: string;
  usedBy: string[];
  orphan: boolean;
};

const formatBytes = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

const loadMedia = async () => {
  if (!key) return;
  try {
    const media = await api<MediaSummary[]>('/api/admin/blog/media');
    mediaList.replaceChildren();
    if (!media.length) {
      const note = document.createElement('li');
      note.className = 'admin-note';
      note.textContent = 'Der er ingen medier i databasen endnu.';
      mediaList.append(note);
      return;
    }
    for (const item of media) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'admin-media-row';
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = item.fileName;
      const meta = document.createElement('span');
      meta.textContent = `${formatBytes(item.size)}${item.usedBy.length ? ` · brugt af ${item.usedBy.join(', ')}` : ' · ubrugt'}`;
      row.append(link, meta);
      if (item.orphan) {
        const removeMedia = document.createElement('button');
        removeMedia.type = 'button';
        removeMedia.className = 'button button-ghost admin-small-button';
        removeMedia.textContent = 'Fjern';
        removeMedia.addEventListener('click', async () => {
          if (!window.confirm(`Fjern den ubrugte fil “${item.fileName}”?`)) return;
          try {
            await api(`/api/admin/blog/media/${item.id}`, { method: 'DELETE' });
            await loadMedia();
          } catch (error) {
            setStatus(mediaStatus, (error as Error).message, 'error');
          }
        });
        row.append(removeMedia);
      }
      li.append(row);
      mediaList.append(li);
    }
    setStatus(mediaStatus, `${media.length} filer · ${media.filter((item) => item.orphan).length} ubrugte.`, 'info');
  } catch (error) {
    setStatus(mediaStatus, (error as Error).message, 'error');
  }
};

const loadDiagnostics = async () => {
  if (!key) return;
  try {
    const d = await api<{ database: string; posts: number; published: number; drafts: number; trash: number; mediaCount: number; mediaOrphans: number; backupCount: number; latestBackup?: string }>('/api/admin/diagnostics');
    setStatus(diagnosticsStatus, `${d.database} · ${d.posts} indlæg (${d.published} live, ${d.drafts} kladder, ${d.trash} i papirkurv) · ${d.mediaCount} medier (${d.mediaOrphans} ubrugte) · ${d.backupCount} backup${d.latestBackup ? `, senest ${d.latestBackup}` : ''}.`, 'ok');
  } catch (error) {
    setStatus(diagnosticsStatus, (error as Error).message, 'error');
  }
};

const exportBackup = async () => {
  if (!key) return;
  backupExportButton.disabled = true;
  setStatus(backupStatus, 'Pakker database og medier …', 'busy');
  try {
    const response = await fetch('/api/admin/backup/export', { headers: { 'X-Admin-Key': key } });
    if (!response.ok) throw new Error(await response.text() || `Serveren svarede ${response.status}.`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `blog-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
    setStatus(backupStatus, 'Backup hentet. Opbevar den et sikkert sted.', 'ok');
    await loadDiagnostics();
  } catch (error) {
    setStatus(backupStatus, (error as Error).message, 'error');
  } finally {
    backupExportButton.disabled = false;
  }
};

const restoreBackup = async (file: File) => {
  if (!key) return;
  if (!window.confirm('Gendan denne backup? Indlæg med samme adresse overskrives, og der gemmes en version først.')) return;
  setStatus(backupStatus, 'Gendanner backup …', 'busy');
  try {
    const form = new FormData();
    form.set('file', file);
    const result = await api<{ postsAdded: number; postsUpdated: number; mediaAdded: number; mediaUpdated: number }>('/api/admin/backup/restore', { method: 'POST', body: form });
    setStatus(backupStatus, `Backup gendannet: ${result.postsAdded} nye og ${result.postsUpdated} opdaterede indlæg, ${result.mediaAdded} nye medier.`, 'ok');
    await loadList();
    await loadMedia();
  } catch (error) {
    setStatus(backupStatus, (error as Error).message, 'error');
  } finally {
    backupFile.value = '';
  }
};

const AUTOSAVE_KEY = 'blog-admin-autosave';
const recoveryButton = document.createElement('button');
recoveryButton.type = 'button';
recoveryButton.className = 'button button-ghost admin-small-button';
recoveryButton.textContent = 'Gendan automatisk kladde';
recoveryButton.hidden = true;
saveButton.before(recoveryButton);

const scheduleAutosave = () => {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      if (!titleInput.value.trim() && !bodyInput.value.trim()) return;
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        slug: editingSlug,
        title: titleInput.value,
        description: descriptionInput.value,
        tldr: tldrInput.value,
        tags: tagsInput.value,
        sites: sitesInput.value,
        body: bodyInput.value,
      }));
    } catch { /* privat vindue */ }
  }, 1200);
};

const offerAutosave = () => {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { savedAt: string; slug?: string | null; title?: string; body?: string; description?: string; tldr?: string; tags?: string; sites?: string };
    if (!saved.title?.trim() && !saved.body?.trim()) return;
    recoveryButton.hidden = false;
    recoveryButton.textContent = `Gendan kladde fra ${new Date(saved.savedAt).toLocaleTimeString('da-DK')}`;
    recoveryButton.onclick = () => {
      titleInput.value = saved.title ?? '';
      descriptionInput.value = saved.description ?? '';
      tldrInput.value = saved.tldr ?? '';
      tagsInput.value = saved.tags ?? '';
      sitesInput.value = saved.sites ?? '';
      bodyInput.value = saved.body ?? '';
      if (saved.slug) editingSlug = saved.slug;
      updatePreview();
      updateSlug();
      recoveryButton.hidden = true;
      setStatus(saveStatus, 'Den automatisk gemte kladde er gendannet. Gem for at sende den til databasen.', 'ok');
    };
  } catch { /* ugyldig gammel kladde */ }
};

for (const input of [titleInput, descriptionInput, tldrInput, tagsInput, sitesInput, bodyInput]) {
  input.addEventListener('input', scheduleAutosave);
}

titleInput.addEventListener('input', updateSlug);
slugInput.addEventListener('input', () => {
  slugTouched = true;
});
bodyInput.addEventListener('input', updatePreview);
previewButton.addEventListener('click', async () => {
  if (!editingSlug) return;
  try {
    const link = await api<{ url: string }>(`/api/admin/blog/posts/${encodeURIComponent(editingSlug)}/preview-link`, { method: 'POST' });
    await navigator.clipboard.writeText(`${location.origin}${link.url}`);
    setStatus(saveStatus, 'Preview-linket er kopieret. Det virker i syv dage.', 'ok');
  } catch (error) {
    setStatus(saveStatus, (error as Error).message, 'error');
  }
});
backupExportButton.addEventListener('click', () => void exportBackup());
backupFile.addEventListener('change', () => {
  const file = backupFile.files?.[0];
  if (file) void restoreBackup(file);
});
cleanupMediaButton.addEventListener('click', async () => {
  if (!key) return;
  if (!window.confirm('Fjern alle medier, som ingen indlæg bruger?')) return;
  try {
    const result = await api<{ removed: number }>('/api/admin/blog/media/cleanup', { method: 'POST' });
    setStatus(mediaStatus, `${result.removed} ubrugte medier fjernet.`, 'ok');
    await loadMedia();
    await loadDiagnostics();
  } catch (error) {
    setStatus(mediaStatus, (error as Error).message, 'error');
  }
});
form.addEventListener('submit', (event) => event.preventDefault());
saveButton.addEventListener('click', () => void save());
deleteButton.addEventListener('click', () => void remove());
newButton.addEventListener('click', reset);

keyInput.addEventListener('input', () => {
  key = keyInput.value.trim();
  sessionStorage.setItem('blog-admin-key', key);
  window.clearTimeout(keyTimer);
  keyTimer = window.setTimeout(() => void loadList(), 350);
});

coverFile.addEventListener('change', async () => {
  const file = coverFile.files?.[0];
  if (!file) return;
  setStatus(coverStatus, 'Uploader billede …', 'busy');
  try {
    setCover(await upload(file));
    setStatus(coverStatus, 'Billedet er gemt i databasen.', 'ok');
  } catch (error) {
    setStatus(coverStatus, (error as Error).message, 'error');
  } finally {
    coverFile.value = '';
  }
});

bodyImageFile.addEventListener('change', async () => {
  const file = bodyImageFile.files?.[0];
  if (!file) return;
  setStatus(saveStatus, 'Uploader billede …', 'busy');
  try {
    const url = await upload(file);
    const snippet = `\n\n::billede[Billedtekst]{src="${url}"}\n\n`;
    const start = bodyInput.selectionStart;
    bodyInput.setRangeText(snippet, start, bodyInput.selectionEnd, 'end');
    updatePreview();
    setStatus(saveStatus, 'Billedet er indsat i teksten. Ret billedteksten.', 'ok');
    bodyInput.focus();
  } catch (error) {
    setStatus(saveStatus, (error as Error).message, 'error');
  } finally {
    bodyImageFile.value = '';
  }
});

keyInput.value = key;
dateInput.value = toLocalInput(new Date());
updatePreview();
if (key) void loadList();
offerAutosave();

const initialSlug = new URLSearchParams(window.location.search).get('slug');
if (initialSlug && key) void loadPost(initialSlug);
