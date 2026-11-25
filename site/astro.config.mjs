import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkDirective from 'remark-directive';
import remarkBlogDirectives from './src/plugins/directives.mjs';

export default defineConfig({
  site: 'https://blog.villadsclaes.dk',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      // De interne skabeloner og admin-siden skal ikke i sitemap. API'et
      // serverer den dynamiske sitemap med databaseindlæg i stedet.
      filter: (page) =>
        !page.includes('/admin/') &&
        !page.includes('/studie/') &&
        !page.includes('/post-shell/') &&
        !page.includes('/topic-shell/') &&
        !page.includes('/site-shell/'),
    }),
  ],
  markdown: {
    remarkPlugins: [remarkDirective, remarkBlogDirectives],
  },
  vite: {
    server: {
      // Under udvikling kører API'et separat (dotnet run i /api).
      proxy: { '/api': 'http://localhost:5080' },
    },
  },
});
