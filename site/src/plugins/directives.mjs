// Gør det let at skrive interaktive elementer og layout direkte i Markdown – også fra mobilen:
//
//   ::afstemning[Skal jeg flytte på landet?]{valg="Ja|Nej|Ved ikke"}
//   ::spoergsmaal[Ville du gøre det samme?]{valg="Ja|Nej|Måske"}
//   ::holdning[Skolen bør afskaffe karakterer]
//   ::video[Valgfri billedtekst]{src="https://youtu.be/abc123" format="lodret"}
//   ::billede[Billedtekst]{src="/media/..." alt="Beskrivelse" bred}
//   ::tldr{titel="Kort fortalt"}
//   Hele historien i to linjer.
//   ::
//   ::detaljer{titel="De udvidede detaljer"}
//   Alt det lange.
//   ::
//   ::::kolonner{antal="2"}
//   :::kolonne
//   Venstre spalte.
//   :::
//   :::kolonne
//   Højre spalte.
//   :::
//   ::::
//   ::citat{kilde="Jaron Lanier"}
//   Data er ikke penge. Data er liv.
//   ::
//   ::skrift[Hele dette afsnit i en anden skrift]{font="sans"}
//   ::faktaboks{titel="Godt at vide"}
//   Kort faktaboks.
//   ::
//   Dette er :vigtigt[et vigtigt ord] i en sætning.
//
// Engelske aliaser: ::poll, ::stance, :key, ::summary, ::details, ::columns,
// ::column, ::quote, ::font, ::callout, ::image, ::photo.
import { visit } from 'unist-util-visit';

const text = (node) =>
  node.value ?? (node.children ?? []).map(text).join('');

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const el = (tagName, properties = {}, children = []) => ({ type: 'element', tagName, properties, children });
const t = (value) => ({ type: 'text', value });

const FONTS = new Set(['serif', 'sans', 'mono', 'haandskrift']);

function attr(node, ...names) {
  for (const name of names) {
    const value = node.attributes?.[name];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

const has = (node, name) => Object.prototype.hasOwnProperty.call(node.attributes ?? {}, name);

function videoEmbed(src) {
  const yt = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/);
  if (yt) return el('iframe', { src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, title: 'Video', loading: 'lazy', allow: 'accelerometer; encrypted-media; picture-in-picture; fullscreen', allowFullScreen: true });
  const vimeo = src.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return el('iframe', { src: `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`, title: 'Video', loading: 'lazy', allow: 'fullscreen; picture-in-picture', allowFullScreen: true });
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)) return el('video', { src, controls: true, preload: 'metadata', playsInline: true });
  // Alt andet (fx PowerPoint fra OneDrive) indlejres som en almindelig iframe.
  return el('iframe', { src, title: 'Indlejret indhold', loading: 'lazy', allowFullScreen: true });
}

const isVertical = (format) => /^(lodret|vertical|9:16|9x16)$/i.test(format);

function titleBlock(value, className) {
  return {
    type: 'paragraph',
    data: { hName: 'p', hProperties: { className: [className] } },
    children: [t(value)],
  };
}

const handlers = {
  afstemning(node) {
    const question = text(node).trim();
    const options = (attr(node, 'valg', 'options') || 'Ja|Nej').split('|').map((o) => o.trim()).filter(Boolean);
    const id = attr(node, 'id') || slugify(question);
    return el('div', { className: ['x-poll'], dataPoll: id, dataOptions: JSON.stringify(options) }, [
      el('p', { className: ['x-poll-q'] }, [t(question)]),
      el('ul', { className: ['x-poll-fallback'] }, options.map((o) => el('li', {}, [t(o)]))),
    ]);
  },
  holdning(node) {
    const statement = text(node).trim();
    const id = attr(node, 'id') || slugify(statement);
    return el('div', { className: ['x-stance'], dataStance: id }, [el('p', { className: ['x-stance-q'] }, [t(statement)])]);
  },
  spoergsmaal(node) {
    const base = handlers.afstemning(node);
    if (!base) return null;
    base.properties.className = ['x-poll', 'x-opinion'];
    base.children.unshift(el('p', { className: ['x-opinion-kicker'] }, [t('Hvad tænker du?')]));
    return base;
  },
  video(node) {
    const src = attr(node, 'src');
    if (!src) return null;
    const caption = text(node).trim();
    const vertical = isVertical(attr(node, 'format', 'retning'));
    return el('figure', { className: ['x-video', ...(vertical ? ['is-vertical'] : [])] }, [
      el('div', { className: ['x-video-frame'] }, [videoEmbed(src)]),
      ...(caption ? [el('figcaption', {}, [t(caption)])] : []),
    ]);
  },
  billede(node) {
    const src = attr(node, 'src');
    if (!src) return null;
    const caption = text(node).trim();
    const alt = attr(node, 'alt') || caption;
    const wide = has(node, 'bred') || has(node, 'wide');
    return el('figure', { className: ['x-figure', ...(wide ? ['x-wide'] : [])] }, [
      el('img', { src, alt, loading: 'lazy', decoding: 'async' }),
      ...(caption ? [el('figcaption', {}, [t(caption)])] : []),
    ]);
  },
  tldr(node) {
    const title = attr(node, 'titel', 'title') || 'TLDR';
    if (node.type === 'containerDirective') {
      return {
        tagName: 'aside',
        properties: { className: ['x-tldr'] },
        prepend: titleBlock(title, 'x-tldr-title'),
      };
    }
    return el('aside', { className: ['x-tldr'] }, [
      el('p', { className: ['x-tldr-title'] }, [t(title)]),
      el('p', {}, [t(text(node).trim())]),
    ]);
  },
  detaljer(node) {
    const title = attr(node, 'titel', 'title', 'summary') || 'Læs mere';
    if (node.type === 'containerDirective') {
      return {
        tagName: 'details',
        properties: { className: ['x-details'] },
        prepend: {
          type: 'paragraph',
          data: { hName: 'summary' },
          children: [t(title)],
        },
      };
    }
    return el('details', { className: ['x-details'] }, [
      el('summary', {}, [t(title)]),
      el('p', {}, [t(text(node).trim())]),
    ]);
  },
  kolonner(node) {
    const wanted = Number(attr(node, 'antal', 'kolonner', 'columns'));
    const cols = wanted >= 2 && wanted <= 4 ? wanted : 2;
    return {
      tagName: 'div',
      properties: { className: ['x-columns'], style: `--cols:${cols}` },
    };
  },
  kolonne() {
    return { tagName: 'div', properties: { className: ['x-column'] } };
  },
  citat(node) {
    const source = attr(node, 'kilde', 'forfatter', 'author', 'source');
    if (node.type === 'containerDirective') {
      return {
        tagName: 'figure',
        properties: { className: ['x-pullquote'] },
        append: source
          ? { type: 'paragraph', data: { hName: 'figcaption' }, children: [t(`— ${source}`)] }
          : undefined,
      };
    }
    return el('figure', { className: ['x-pullquote'] }, [
      el('blockquote', {}, [el('p', {}, [t(text(node).trim())])]),
      ...(source ? [el('figcaption', {}, [t(`— ${source}`)])] : []),
    ]);
  },
  skrift(node) {
    const font = attr(node, 'font', 'skrift').toLowerCase();
    const className = `x-font-${FONTS.has(font) ? font : 'serif'}`;
    if (node.type === 'containerDirective') {
      return { tagName: 'div', properties: { className: ['x-font-block', className] } };
    }
    return el('span', { className: [className] }, [t(text(node))]);
  },
  faktaboks(node) {
    const title = attr(node, 'titel', 'title') || 'Godt at vide';
    if (node.type === 'containerDirective') {
      return {
        tagName: 'aside',
        properties: { className: ['x-callout'] },
        prepend: titleBlock(title, 'x-callout-title'),
      };
    }
    return el('aside', { className: ['x-callout'] }, [
      el('p', { className: ['x-callout-title'] }, [t(title)]),
      el('p', {}, [t(text(node).trim())]),
    ]);
  },
  galleri() {
    return { tagName: 'div', properties: { className: ['x-gallery'] } };
  },
};

handlers.poll = handlers.afstemning;
handlers.question = handlers.spoergsmaal;
handlers.opinion = handlers.spoergsmaal;
handlers.stance = handlers.holdning;
handlers.summary = handlers.tldr;
handlers.resume = handlers.tldr;
handlers.details = handlers.detaljer;
handlers.columns = handlers.kolonner;
handlers.column = handlers.kolonne;
handlers.quote = handlers.citat;
handlers.pullquote = handlers.citat;
handlers.font = handlers.skrift;
handlers.callout = handlers.faktaboks;
handlers.factbox = handlers.faktaboks;
handlers.image = handlers.billede;
handlers.photo = handlers.billede;
handlers.gallery = handlers.galleri;

export default function remarkBlogDirectives() {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'textDirective') {
        if (node.name === 'vigtigt' || node.name === 'key') {
          node.data = { hName: 'strong', hProperties: { className: ['x-key'] } };
        } else if (parent && index != null) {
          // Ukendt ":ord" var nok bare almindelig tekst (fx "kl.:10").
          parent.children.splice(index, 1, { type: 'text', value: `:${node.name}` }, ...node.children);
        }
        return;
      }
      if (node.type !== 'leafDirective' && node.type !== 'containerDirective') return;
      const handler = handlers[node.name];
      if (!handler) return;
      const result = handler(node);
      if (!result) return;
      const isContainer = node.type === 'containerDirective' && result.tagName;
      if (isContainer) {
        // Behold børnene (afsnit, lister, billeder …), så Markdown stadig virker i blokken.
        if (result.prepend) node.children.unshift(result.prepend);
        if (result.append) node.children.push(result.append);
        node.data = { hName: result.tagName, hProperties: result.properties };
        return;
      }
      const hast = result;
      node.data = { hName: hast.tagName, hProperties: hast.properties, hChildren: hast.children };
    });
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Samme indlejring som ::video, men som HTML-streng til `video:` i frontmatter.
export function videoHtml(src, format = '') {
  const node = videoEmbed(src);
  const attrs = Object.entries(node.properties)
    .map(([k, v]) => (v === true ? k.toLowerCase() : `${k.toLowerCase()}="${esc(v)}"`))
    .join(' ');
  const vertical = isVertical(format) ? ' is-vertical' : '';
  return `<figure class="x-video${vertical}"><div class="x-video-frame"><${node.tagName} ${attrs}></${node.tagName}></div></figure>`;
}
