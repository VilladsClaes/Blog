// JSON-feeds som dine andre websites kan hente: /feeds/alle.json og /feeds/<site>.json
import { getPublishedPosts } from '../../lib/posts';
import { sites } from '../../data/sites';

export async function getStaticPaths() {
  return [{ params: { site: 'alle' } }, ...sites.map((s) => ({ params: { site: s.key } }))];
}

export async function GET({ params, site }) {
  const posts = (await getPublishedPosts()).filter((p) => params.site === 'alle' || p.data.sites.includes(params.site));
  const items = posts.map((p) => ({
    id: p.id,
    url: new URL(`/${p.id}/`, site).href,
    title: p.data.title,
    summary: p.data.description ?? '',
    date_published: p.data.publishDate.toISOString(),
    tags: p.data.tags,
  }));
  return new Response(
    JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'Villads Claes · blog', home_page_url: site.href, items }, null, 2),
    { headers: { 'Content-Type': 'application/feed+json; charset=utf-8' } },
  );
}
