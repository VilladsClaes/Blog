// Gør det let at skrive interaktive elementer direkte i Markdown – også fra mobilen:
//
//   ::afstemning[Skal jeg flytte på landet?]{valg="Ja|Nej|Ved ikke"}
//   ::holdning[Skolen bør afskaffe karakterer]
//   ::video[Valgfri billedtekst]{src="https://youtu.be/abc123"}
//   Dette er :vigtigt[et vigtigt ord] i en sætning.
//
// Engelske aliaser: ::poll, ::stance, :key
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

const el = (tagName, properties, children = []) => ({ type: 'element', tagName, properties, children });
const t = (value) => ({ type: 'text', value });

function videoEmbed(src) {
  const yt = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,})/);
  if (yt) return el('iframe', { src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, title: 'Video', loading: 'lazy', allow: 'accelerometer; encrypted-media; picture-in-picture; fullscreen', allowFullScreen: true });
  const vimeo = src.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return el('iframe', { src: `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`, title: 'Video', loading: 'lazy', allow: 'fullscreen; picture-in-picture', allowFullScreen: true });
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)) return el('video', { src, controls: true, preload: 'metadata', playsInline: true });
  // Alt andet (fx PowerPoint fra OneDrive) indlejres som en almindelig iframe.
  return el('iframe', { src, title: 'Indlejret indhold', loading: 'lazy', allowFullScreen: true });
}

const handlers = {
  afstemning(node) {
    const question = text(node).trim();
    const options = (node.attributes.valg ?? node.attributes.options ?? 'Ja|Nej').split('|').map((o) => o.trim()).filter(Boolean);
    const id = node.attributes.id ?? slugify(question);
    return el('div', { className: ['x-poll'], dataPoll: id, dataOptions: JSON.stringify(options) }, [
      el('p', { className: ['x-poll-q'] }, [t(question)]),
      el('ul', { className: ['x-poll-fallback'] }, options.map((o) => el('li', {}, [t(o)]))),
    ]);
  },
  holdning(node) {
    const statement = text(node).trim();
    const id = node.attributes.id ?? slugify(statement);
    return el('div', { className: ['x-stance'], dataStance: id }, [el('p', { className: ['x-stance-q'] }, [t(statement)])]);
  },
  video(node) {
    const src = node.attributes.src ?? '';
    const caption = text(node).trim();
    return el('figure', { className: ['x-video'] }, [
      el('div', { className: ['x-video-frame'] }, [videoEmbed(src)]),
      ...(caption ? [el('figcaption', {}, [t(caption)])] : []),
    ]);
  },
};
handlers.poll = handlers.afstemning;
handlers.stance = handlers.holdning;

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
      const hast = handler(node);
      node.data = { hName: hast.tagName, hProperties: hast.properties, hChildren: hast.children };
    });
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Samme indlejring som ::video, men som HTML-streng til `video:` i frontmatter.
export function videoHtml(src) {
  const node = videoEmbed(src);
  const attrs = Object.entries(node.properties)
    .map(([k, v]) => (v === true ? k.toLowerCase() : `${k.toLowerCase()}="${esc(v)}"`))
    .join(' ');
  return `<figure class="x-video"><div class="x-video-frame"><${node.tagName} ${attrs}></${node.tagName}></div></figure>`;
}
