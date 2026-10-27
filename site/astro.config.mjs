import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkDirective from 'remark-directive';
import remarkBlogDirectives from './src/plugins/directives.mjs';

export default defineConfig({
  site: 'https://blog.villadsclaes.dk',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
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
