// Valgfri Google Photos Picker. Kræver et Google Cloud-projekt med Photos Picker API
// og en OAuth-webklient, hvis origin er bloggens. Uden opsætning bruger studiet
// telefonens egen billedvælger, hvor Google Fotos også ligger.

interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GooglePhotosMediaFile {
  baseUrl: string;
  mimeType?: string;
  filename?: string;
}

interface GooglePhotosItem {
  id: string;
  mediaFile?: GooglePhotosMediaFile;
}

interface PickerSession {
  id: string;
  pickerUri: string;
  mediaItemsSet?: boolean;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google-klienten kunne ikke hentes. Tjek internetforbindelsen.'));
    document.head.append(script);
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAccessToken(clientId: string): Promise<string> {
  await loadScript('https://accounts.google.com/gsi/client');
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error('Google-login blev ikke indlæst.');
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error(response.error === 'access_denied' ? 'Du gav ikke adgang til Google Fotos.' : 'Google gav ingen adgangstoken.'));
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function json<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = '';
    try {
      const body = await response.json();
      message = body?.error?.message ?? '';
    } catch {
      /* ikke JSON */
    }
    throw new Error(message || `Google Fotos svarede ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export async function pickGooglePhotos(clientId: string): Promise<File[]> {
  const token = await getAccessToken(clientId);
  const session = await json<PickerSession>('https://photospicker.googleapis.com/v1/sessions', token, {
    method: 'POST',
    body: '{}',
  });

  const popup = window.open(session.pickerUri, 'google-photos-picker', 'popup=yes,width=980,height=760');
  if (!popup) {
    throw new Error('Browseren blokerede Google Fotos-vinduet. Tillad pop op-vinduer og prøv igen.');
  }

  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    await sleep(2000);
    const current = await json<PickerSession>(`https://photospicker.googleapis.com/v1/sessions/${session.id}`, token);
    if (current.mediaItemsSet) {
      ready = true;
      break;
    }
    if (popup.closed) break;
  }
  popup.close();

  if (!ready) {
    throw new Error('Der blev ikke valgt nogen billeder i Google Fotos. Prøv igen.');
  }

  try {
    const list = await json<{ mediaItems?: GooglePhotosItem[] }>(
      `https://photospicker.googleapis.com/v1/mediaItems?sessionId=${session.id}&pageSize=100`,
      token,
    );
    const files: File[] = [];
    for (const [index, item] of (list.mediaItems ?? []).entries()) {
      const media = item.mediaFile;
      if (!media?.baseUrl) continue;
      const response = await fetch(`${media.baseUrl}=w2048-h2048`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) continue;
      const blob = await response.blob();
      const name = media.filename || `google-foto-${index + 1}.jpg`;
      files.push(new File([blob], name, { type: blob.type || media.mimeType || 'image/jpeg' }));
    }
    if (!files.length) throw new Error('Google Fotos gav ingen billeder, der kunne hentes.');
    return files;
  } finally {
    await fetch(`https://photospicker.googleapis.com/v1/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
}
