// Alt det interaktive på et indlæg: afstemninger, holdninger, oplæsning,
// understregninger, noter, graffiti og besyv. Alt brugerindhold indsættes som
// tekst (textContent), aldrig som HTML.

type Counts = Record<string, number>;
interface Choice { counts: Counts; mine: number | null }
interface Comment { id: number; name: string; body: string; createdAt: string; mine: boolean }
interface Annotation { id: number; kind: 'understregning' | 'note'; quote: string; prefix: string; suffix: string; note?: string; name?: string; createdAt: string; mine: boolean }
interface Stroke { id: number; color: string; width: number; points: number[][]; mine: boolean }
interface State { polls: Record<string, Choice>; stances: Record<string, Choice>; comments: Comment[]; annotations: Annotation[]; strokes: Stroke[] }

const slug = document.body.dataset.slug!;
const article = document.querySelector<HTMLElement>('article.post')!;
const prose = document.getElementById('prose')!;
const tools = article.querySelector<HTMLElement>('.x-tools')!;
const features = new Set((article.dataset.features ?? '').split(' '));

const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* privat vindue */ } },
};

const voter = (() => {
  let id = store.get('voter');
  if (!id) { id = crypto.randomUUID(); store.set('voter', id); }
  return id;
})();

let state: State = { polls: {}, stances: {}, comments: [], annotations: [], strokes: [] };
let online = true;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/posts/${encodeURIComponent(slug)}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'Du er lidt for hurtig – vent et øjeblik.' : 'Det mislykkedes. Prøv igen.');
  return res.status === 204 ? (undefined as T) : res.json();
}
const post = <T>(path: string, body: object) => api<T>(path, { method: 'POST', body: JSON.stringify({ ...body, voter }) });
const remove = (path: string) => api<void>(`${path}?voter=${voter}`, { method: 'DELETE' });

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
const when = (iso: string) => new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg: string) {
  const t = h('div', { class: 'x-toast sans', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

/* ---------- Afstemninger ---------- */

function renderPolls() {
  for (const box of prose.querySelectorAll<HTMLElement>('.x-poll')) {
    box.dataset.noAnchor = '';
    const id = box.dataset.poll!;
    const options: string[] = JSON.parse(box.dataset.options ?? '[]');
    const data = state.polls[id] ?? { counts: {}, mine: null };
    const t = total(data.counts);
    const answered = data.mine !== null;
    box.querySelector('.x-poll-fallback')?.remove();
    box.querySelector('.x-poll-options')?.remove();
    const list = h('div', { class: 'x-poll-options sans' });
    options.forEach((label, i) => {
      const n = data.counts[i] ?? 0;
      const btn = h('button', {
        type: 'button',
        class: `x-option${data.mine === i ? ' is-mine' : ''}`,
        'aria-pressed': data.mine === i,
        style: answered ? `--p:${pct(n, t)}%` : '',
        onclick: async () => {
          try {
            state.polls[id] = await post<Choice>(`/polls/${encodeURIComponent(id)}`, { option: i });
            renderPolls();
          } catch (e) { toast((e as Error).message); }
        },
      }, h('span', {}, label), answered ? h('span', { class: 'x-num' }, `${pct(n, t)} %`) : null);
      list.append(btn);
    });
    list.append(h('p', { class: 'x-small' }, answered ? `${t} ${t === 1 ? 'stemme' : 'stemmer'} · du kan skifte mening` : online ? 'Stem for at se resultatet' : 'Afstemningen er midlertidigt lukket'));
    box.append(list);
  }
}

/* ---------- Holdninger ---------- */

const STANCES = ['Helt uenig', 'Uenig', 'Hverken eller', 'Enig', 'Helt enig'];

function renderStances() {
  for (const box of prose.querySelectorAll<HTMLElement>('.x-stance')) {
    box.dataset.noAnchor = '';
    const id = box.dataset.stance!;
    const data = state.stances[id] ?? { counts: {}, mine: null };
    const t = total(data.counts);
    box.querySelector('.x-stance-ui')?.remove();
    const scale = h('div', { class: 'x-scale', role: 'group', 'aria-label': 'Din holdning' });
    STANCES.forEach((label, i) => {
      const v = i + 1;
      scale.append(h('button', {
        type: 'button', class: data.mine === v ? 'is-mine' : '', 'aria-pressed': data.mine === v, title: label,
        onclick: async () => {
          try {
            state.stances[id] = await post<Choice>(`/stances/${encodeURIComponent(id)}`, { value: v });
            renderStances();
          } catch (e) { toast((e as Error).message); }
        },
      }, label));
    });
    const ui = h('div', { class: 'x-stance-ui sans' }, scale);
    if (data.mine !== null && t) {
      const bar = h('div', { class: 'x-dist', 'aria-hidden': 'true' });
      STANCES.forEach((_, i) => bar.append(h('span', { class: `s${i + 1}`, style: `flex-grow:${data.counts[i + 1] ?? 0}` })));
      const agree = (data.counts[4] ?? 0) + (data.counts[5] ?? 0);
      const disagree = (data.counts[1] ?? 0) + (data.counts[2] ?? 0);
      ui.append(bar, h('p', { class: 'x-small' }, `${pct(agree, t)} % enige · ${pct(disagree, t)} % uenige · ${t} svar`));
    } else {
      ui.append(h('p', { class: 'x-small' }, 'Sig din mening for at se, hvad andre mener'));
    }
    box.append(ui);
  }
}

/* ---------- Besyv (kommentarer) ---------- */

function renderComments() {
  const list = article.querySelector<HTMLElement>('.x-comment-list');
  if (!list) return;
  list.replaceChildren(...state.comments.map((c) => h('li', {},
    h('div', { class: 'x-small' }, h('strong', {}, c.name), ` · ${when(c.createdAt)}`,
      c.mine ? h('button', { type: 'button', class: 'x-link', onclick: async () => {
        await remove(`/comments/${c.id}`).catch(() => toast('Kunne ikke slette'));
        state.comments = state.comments.filter((x) => x.id !== c.id);
        renderComments();
      } }, 'slet') : null),
    h('p', {}, c.body),
  )));
  const counter = tools.querySelector('.x-count');
  if (counter) counter.textContent = String(state.comments.length);
}

function setupCommentForm() {
  const form = article.querySelector<HTMLFormElement>('.x-comment-form');
  if (!form) return;
  const status = form.querySelector<HTMLElement>('.x-form-status')!;
  const nameInput = form.elements.namedItem('name') as HTMLInputElement;
  nameInput.value = store.get('name') ?? '';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name')).trim();
    store.set('name', name);
    status.textContent = 'Sender …';
    try {
      const c = await post<Comment>('/comments', { name, body: String(fd.get('body')).trim(), website: fd.get('website') });
      state.comments.push(c);
      renderComments();
      (form.elements.namedItem('body') as HTMLTextAreaElement).value = '';
      status.textContent = 'Tak for dit besyv!';
    } catch (err) { status.textContent = (err as Error).message; }
  });
}

/* ---------- Oplæsning ---------- */

function setupReadAloud() {
  if (!features.has('readAloud') || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const rates = [1, 1.25, 1.5, 0.85];
  let rateIndex = 0;
  let queue: HTMLElement[] = [];
  let pos = 0;
  let playing = false;
  let token = 0;

  const blocks = () => {
    const title = article.querySelector<HTMLElement>('h1')!;
    const els = [...prose.querySelectorAll<HTMLElement>('h2, h3, p, li, blockquote, figcaption')]
      .filter((el) => !el.closest('.x-poll-options, .x-stance-ui') && !el.querySelector('p, li') && el.innerText.trim());
    return [title, ...els];
  };
  const voice = () => synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('da'));

  const clear = () => article.querySelectorAll('.x-reading').forEach((el) => el.classList.remove('x-reading'));
  const speakNext = () => {
    clear();
    if (pos >= queue.length) { stop(); return; }
    const el = queue[pos];
    el.classList.add('x-reading');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const u = new SpeechSynthesisUtterance(el.innerText.replace(/\s+/g, ' ').trim());
    u.lang = 'da-DK';
    const v = voice();
    if (v) u.voice = v;
    u.rate = rates[rateIndex];
    // synth.cancel() udløser også "end" – kun den nyeste ytring må gå videre.
    const mine = ++token;
    u.onend = () => { if (playing && mine === token) { pos++; speakNext(); } };
    synth.speak(u);
  };
  const stop = () => {
    playing = false; synth.cancel(); clear(); pos = 0;
    playBtn.textContent = '▶ Læs op'; stopBtn.hidden = true; rateBtn.hidden = true;
  };

  const playBtn = h('button', { type: 'button', onclick: () => {
    if (!playing && pos === 0) {
      queue = blocks(); playing = true; speakNext();
      playBtn.textContent = '❚❚ Pause'; stopBtn.hidden = false; rateBtn.hidden = false;
    } else if (playing) {
      playing = false; synth.cancel(); playBtn.textContent = '▶ Fortsæt';
    } else {
      playing = true; speakNext(); playBtn.textContent = '❚❚ Pause';
    }
  } }, '▶ Læs op');
  const stopBtn = h('button', { type: 'button', hidden: true, onclick: stop, 'aria-label': 'Stop oplæsning' }, '■');
  const rateBtn = h('button', { type: 'button', hidden: true, title: 'Hastighed', onclick: () => {
    rateIndex = (rateIndex + 1) % rates.length;
    rateBtn.textContent = `${rates[rateIndex]}×`;
    if (playing) { token++; synth.cancel(); speakNext(); }
  } }, '1×');
  tools.append(h('span', { class: 'x-group' }, playBtn, rateBtn, stopBtn));
  window.addEventListener('pagehide', () => synth.cancel());
}

/* ---------- Understregninger og noter ---------- */

interface Piece { node: Text; start: number; end: number }

function textIndex() {
  const pieces: Piece[] = [];
  let all = '';
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('[data-no-anchor], .x-note-pin, .x-video') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    pieces.push({ node: n, start: all.length, end: all.length + n.data.length });
    all += n.data;
  }
  return { all, pieces };
}

function offsetOf(pieces: Piece[], node: Node, offset: number) {
  const p = pieces.find((x) => x.node === node);
  return p ? p.start + offset : -1;
}

function locate(all: string, a: Pick<Annotation, 'quote' | 'prefix' | 'suffix'>) {
  const tries: [string, number][] = [
    [a.prefix + a.quote + a.suffix, a.prefix.length],
    [a.prefix + a.quote, a.prefix.length],
    [a.quote + a.suffix, 0],
    [a.quote, 0],
  ];
  for (const [needle, shift] of tries) {
    const i = all.indexOf(needle);
    if (i >= 0) return i + shift;
  }
  return -1;
}

function wrapRange(start: number, end: number, make: () => HTMLElement) {
  const { pieces } = textIndex();
  const marks: HTMLElement[] = [];
  for (const p of pieces) {
    if (p.end <= start || p.start >= end) continue;
    let node = p.node;
    const from = Math.max(start, p.start) - p.start;
    const to = Math.min(end, p.end) - p.start;
    if (to < node.data.length) node.splitText(to);
    if (from > 0) node = node.splitText(from);
    if (!node.data.trim()) continue;
    const mark = make();
    node.replaceWith(mark);
    mark.append(node);
    marks.push(mark);
  }
  return marks;
}

function unwrapMarks() {
  prose.querySelectorAll('.x-note-pin').forEach((el) => el.remove());
  prose.querySelectorAll('mark.x-hl, mark.x-note').forEach((m) => m.replaceWith(...m.childNodes));
  prose.normalize();
}

let popover: HTMLElement | null = null;
const closePopover = () => { popover?.remove(); popover = null; };

function showPopover(anchor: DOMRect, content: HTMLElement) {
  closePopover();
  popover = h('div', { class: 'x-popover sans', role: 'dialog' }, content);
  document.body.append(popover);
  const w = Math.min(320, window.innerWidth - 32);
  popover.style.width = `${w}px`;
  popover.style.left = `${Math.max(16, Math.min(window.scrollX + anchor.left + anchor.width / 2 - w / 2, window.scrollX + window.innerWidth - w - 16))}px`;
  // Under markeringen, så telefonens egen kopi-menu (der ligger ovenover) ikke dækker.
  popover.style.top = `${window.scrollY + anchor.bottom + 10}px`;
}

function renderAnnotations() {
  if (!features.has('highlights')) return;
  unwrapMarks();
  const { all } = textIndex();
  const groups = new Map<string, { start: number; end: number; items: Annotation[] }>();
  for (const a of state.annotations) {
    const s = locate(all, a);
    if (s < 0) continue;
    const key = `${s}:${a.quote.length}`;
    if (!groups.has(key)) groups.set(key, { start: s, end: s + a.quote.length, items: [] });
    groups.get(key)!.items.push(a);
  }
  const noteList = article.querySelector<HTMLElement>('.x-annotations')!;
  const ol = noteList.querySelector('ol')!;
  ol.replaceChildren();
  let noteNo = 0;
  // Bagfra, så tidligere positioner ikke flytter sig undervejs.
  const sorted = [...groups.values()].sort((a, b) => b.start - a.start);
  for (const g of sorted) {
    const notes = g.items.filter((a) => a.kind === 'note');
    const marks = wrapRange(g.start, g.end, () => h('mark', {
      class: notes.length ? 'x-note' : 'x-hl',
      style: `--n:${Math.min(g.items.length, 5)}`,
      title: notes.length ? `${notes.length} note${notes.length > 1 ? 'r' : ''}` : `Understreget af ${g.items.length}`,
    }));
    if (notes.length && marks.length) {
      const pin = h('button', { type: 'button', class: 'x-note-pin', 'aria-label': 'Vis noter', onclick: (e: Event) => {
        e.stopPropagation();
        showPopover((e.currentTarget as HTMLElement).getBoundingClientRect(), notesView(g.items));
      } }, String(notes.length));
      marks[marks.length - 1].after(pin);
    }
  }
  for (const a of [...state.annotations].filter((x) => x.kind === 'note').sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    noteNo++;
    ol.append(h('li', {}, h('q', {}, a.quote), ' ', a.note ?? '', h('span', { class: 'x-small' }, ` — ${a.name || 'Anonym'}, ${when(a.createdAt)}`)));
  }
  noteList.hidden = noteNo === 0;
}

function notesView(items: Annotation[]) {
  const box = h('div');
  for (const a of items) {
    box.append(h('div', { class: 'x-note-item' },
      a.kind === 'note' ? h('p', {}, a.note ?? '') : h('p', { class: 'x-small' }, 'Understreget'),
      h('div', { class: 'x-small' }, `${a.name || 'Anonym'} · ${when(a.createdAt)} `,
        a.mine ? h('button', { type: 'button', class: 'x-link', onclick: async () => {
          await remove(`/annotations/${a.id}`).catch(() => toast('Kunne ikke slette'));
          state.annotations = state.annotations.filter((x) => x.id !== a.id);
          closePopover(); renderAnnotations();
        } }, 'fjern') : null)));
  }
  return box;
}

function setupSelection() {
  if (!features.has('highlights')) return;
  let pending: { quote: string; prefix: string; suffix: string; rect: DOMRect } | null = null;

  const check = () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!prose.contains(range.commonAncestorContainer)) return;
    const { all, pieces } = textIndex();
    let s = offsetOf(pieces, range.startContainer, range.startOffset);
    let e = offsetOf(pieces, range.endContainer, range.endOffset);
    const raw = sel.toString().trim();
    if (s < 0 || e < 0 || e <= s) { s = all.indexOf(raw); e = s + raw.length; }
    if (s < 0 || !raw) return;
    // Trim mellemrum i kanterne.
    while (s < e && /\s/.test(all[s])) s++;
    while (e > s && /\s/.test(all[e - 1])) e--;
    const quote = all.slice(s, e);
    if (quote.length < 2 || quote.length > 600) return;
    pending = { quote, prefix: all.slice(Math.max(0, s - 32), s), suffix: all.slice(e, e + 32), rect: range.getBoundingClientRect() };
    showPopover(pending.rect, h('div', { class: 'x-row' },
      h('button', { type: 'button', onclick: () => save('understregning') }, 'Understreg'),
      h('button', { type: 'button', onclick: noteForm }, 'Skriv note'),
    ));
  };

  const save = async (kind: Annotation['kind'], note?: string, name?: string) => {
    if (!pending) return;
    try {
      const a = await post<Annotation>('/annotations', { kind, quote: pending.quote, prefix: pending.prefix, suffix: pending.suffix, note, name });
      state.annotations.push(a);
      document.getSelection()?.removeAllRanges();
      closePopover(); renderAnnotations();
    } catch (e) { toast((e as Error).message); }
  };

  const noteForm = () => {
    if (!pending) return;
    const ta = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'Din note …', required: true }) as HTMLTextAreaElement;
    const name = h('input', { placeholder: 'Navn (valgfrit)', maxlength: 60, value: store.get('name') ?? '' }) as HTMLInputElement;
    const form = h('form', { class: 'x-stack', onsubmit: (e: Event) => {
      e.preventDefault();
      if (name.value.trim()) store.set('name', name.value.trim());
      save('note', ta.value.trim(), name.value.trim());
    } }, h('q', { class: 'x-small' }, pending.quote.length > 80 ? pending.quote.slice(0, 80) + '…' : pending.quote), ta, name,
      h('div', { class: 'x-row' }, h('button', { type: 'submit' }, 'Gem note'), h('button', { type: 'button', class: 'x-link', onclick: closePopover }, 'Annullér')));
    showPopover(pending.rect, form);
    ta.focus();
  };

  let timer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 450);
  });
  document.addEventListener('pointerdown', (e) => {
    if (popover && !popover.contains(e.target as Node) && !(e.target as HTMLElement).closest('.x-note-pin')) closePopover();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
}

/* ---------- Graffiti ---------- */

const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#c8402a', '#1f6feb', '#2da44e', '#111111', '#f2c94c'];
let svg: SVGSVGElement;

function pathData(points: number[][]) {
  if (points.length === 1) return `M${points[0][0]} ${points[0][1]}l0.1 0`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`;
  }
  const last = points[points.length - 1];
  return d + `L${last[0]} ${last[1]}`;
}

function sizeSvg() {
  const w = article.clientWidth || 1;
  const hgt = article.scrollHeight;
  svg.setAttribute('viewBox', `0 0 1000 ${(hgt * 1000) / w}`);
  svg.style.height = `${hgt}px`;
}

function renderStrokes() {
  if (!svg) return;
  svg.querySelectorAll('path').forEach((p) => p.remove());
  for (const s of state.strokes) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', pathData(s.points));
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', String(s.width));
    svg.append(p);
  }
}

function setupGraffiti() {
  if (!features.has('graffiti')) return;
  svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('x-graffiti');
  svg.setAttribute('aria-hidden', 'true');
  article.append(svg);
  sizeSvg();
  new ResizeObserver(sizeSvg).observe(article);

  let color = store.get('graffiti-color') ?? COLORS[0];
  let width = 4;
  let current: { el: SVGPathElement; points: number[][] } | null = null;

  const point = (e: PointerEvent) => {
    const r = article.getBoundingClientRect();
    const k = 1000 / r.width;
    return [Math.round((e.clientX - r.left) * k * 10) / 10, Math.round((e.clientY - r.top) * k * 10) / 10];
  };
  svg.addEventListener('pointerdown', (e) => {
    if (!article.classList.contains('x-drawing')) return;
    svg.setPointerCapture(e.pointerId);
    const el = document.createElementNS(SVG, 'path');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', String(width));
    svg.append(el);
    current = { el, points: [point(e)] };
    el.setAttribute('d', pathData(current.points));
  });
  svg.addEventListener('pointermove', (e) => {
    if (!current) return;
    const p = point(e);
    const last = current.points[current.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2 || current.points.length > 1500) return;
    current.points.push(p);
    current.el.setAttribute('d', pathData(current.points));
  });
  const finish = async () => {
    if (!current) return;
    const { el, points } = current;
    current = null;
    try {
      const s = await post<Stroke>('/strokes', { color, width, points });
      state.strokes.push(s);
    } catch (err) {
      el.remove();
      toast((err as Error).message);
    }
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);

  const palette = h('span', { class: 'x-group x-palette', hidden: true });
  for (const c of COLORS) {
    palette.append(h('button', {
      type: 'button', class: `x-swatch${c === color ? ' is-mine' : ''}`, style: `--c:${c}`, 'aria-label': `Farve ${c}`,
      onclick: (e: Event) => {
        color = c; store.set('graffiti-color', c);
        palette.querySelectorAll('.x-swatch').forEach((b) => b.classList.toggle('is-mine', b === e.currentTarget));
      },
    }));
  }
  palette.append(
    h('button', { type: 'button', title: 'Tykkelse', onclick: (e: Event) => {
      width = width === 4 ? 9 : width === 9 ? 2 : 4;
      (e.currentTarget as HTMLElement).textContent = width === 2 ? 'tynd' : width === 4 ? 'mellem' : 'tyk';
    } }, 'mellem'),
    h('button', { type: 'button', onclick: async () => {
      const mine = [...state.strokes].reverse().find((s) => s.mine);
      if (!mine) return toast('Du har ikke tegnet noget endnu');
      await remove(`/strokes/${mine.id}`).catch(() => toast('Kunne ikke fortryde'));
      state.strokes = state.strokes.filter((s) => s.id !== mine.id);
      renderStrokes();
    } }, '↶ Fortryd'),
  );
  const toggle = h('button', { type: 'button', 'aria-pressed': false, onclick: () => {
    const on = article.classList.toggle('x-drawing');
    article.classList.remove('x-hide-marks');
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? '✓ Færdig' : '✎ Graffiti';
    palette.hidden = !on;
    if (on) toast('Tegn direkte på siden. Alle kan se det.');
  } }, '✎ Graffiti');
  tools.append(h('span', { class: 'x-group' }, toggle), palette);
}

/* ---------- Værktøjslinje ---------- */

function setupToolbar() {
  tools.hidden = false;
  setupReadAloud();
  setupGraffiti();
  const hide = h('button', { type: 'button', 'aria-pressed': false, title: 'Skjul andres understregninger, noter og graffiti', onclick: () => {
    const on = article.classList.toggle('x-hide-marks');
    hide.setAttribute('aria-pressed', String(on));
    hide.textContent = on ? '◑ Vis spor' : '◐ Skjul spor';
    store.set('hide-marks', on ? '1' : '');
  } }, '◐ Skjul spor');
  if (features.has('highlights') || features.has('graffiti')) tools.append(hide);
  if (store.get('hide-marks')) hide.click();
  if (features.has('comments')) tools.append(h('a', { href: '#besyv', class: 'x-besyv' }, '💬 Besyv ', h('span', { class: 'x-count' }, '0')));
  if (features.has('highlights')) tools.append(h('span', { class: 'x-hint' }, 'Markér tekst for at understrege eller skrive en note'));
}

async function init() {
  setupToolbar();
  setupCommentForm();
  setupSelection();
  try {
    state = await api<State>(`/state?voter=${voter}`);
  } catch {
    online = false;
    tools.append(h('span', { class: 'x-hint' }, 'De interaktive funktioner er offline lige nu.'));
  }
  renderPolls();
  renderStances();
  renderComments();
  renderAnnotations();
  renderStrokes();
}

init();
