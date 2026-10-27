import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    // Et indlæg med en dato i fremtiden bliver først vist, når datoen er passeret
    // (GitHub Actions bygger sitet hver time og udgiver det, når tiden er inde).
    publishDate: z.coerce.date(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    // Nøgler fra src/data/sites.ts – knytter indlægget til dine andre websites.
    sites: z.array(z.string()).default([]),
    links: z.array(z.object({ title: z.string(), url: z.string().url() })).default([]),
    video: z.string().optional(),
    cover: z.string().optional(),
    archived: z.boolean().default(false),
    interactive: z
      .object({
        comments: z.boolean().default(true),
        highlights: z.boolean().default(true),
        graffiti: z.boolean().default(true),
        readAloud: z.boolean().default(true),
      })
      .default({ comments: true, highlights: true, graffiti: true, readAloud: true }),
  }),
});

export const collections = { posts };
