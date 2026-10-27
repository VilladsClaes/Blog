import rss from '@astrojs/rss';
import { getPublishedPosts } from '../lib/posts';

export async function GET(context) {
  const posts = await getPublishedPosts();
  return rss({
    title: 'Villads Claes · blog',
    description: 'Tanker, der må tegnes på.',
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.publishDate,
      link: `/${p.id}/`,
      categories: p.data.tags,
    })),
    customData: '<language>da-dk</language>',
  });
}
