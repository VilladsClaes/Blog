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
    videoFormat: z.enum(['vandret', 'lodret']).optional(),
    cover: z.string().optional(),
    // Kort resumé øverst – kan også skrives som ::tldr i teksten.
    tldr: z.string().optional(),
    // Skrifttypen for hele indlægget. Enkelte afsnit kan overstyres med ::skrift.
    font: z.enum(['serif', 'sans', 'mono', 'haandskrift']).default('serif'),
    // Lydfil med indlæst oplæsning i din egen stemme (fx /media/voice/<slug>.mp3).
    voice: z.string().optional(),
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
