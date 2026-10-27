import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

// Kladder og fremtidige indlæg vises kun under `npm run dev`.
export async function getPublishedPosts(): Promise<Post[]> {
  const now = new Date();
  const posts = await getCollection('posts', ({ data }) =>
    import.meta.env.DEV ? true : !data.draft && data.publishDate <= now,
  );
  return posts.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());
}

export const formatDate = (d: Date) =>
  d.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });

export const tagSlug = (tag: string) =>
  tag.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const readingMinutes = (body: string | undefined) =>
  Math.max(1, Math.round((body ?? '').split(/\s+/).length / 200));
