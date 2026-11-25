// Engangseksport: Markdown -> api/Blog.Api/Seed/posts.json.
// Bruger Astros egen Markdown-processor, så HTML'en bliver den samme som i de
// gamle statiske sider. Kun filer, der er tracked i Git, kommer med.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import remarkDirective from 'remark-directive';
import remarkBlogDirectives from '../src/plugins/directives.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(siteRoot, '..');
const output = resolve(repoRoot, 'api/Blog.Api/Seed/posts.json');

const tracked = execFileSync('git', ['-C', repoRoot, 'ls-files', 'site/src/content/posts'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((path) => path.endsWith('.md'));

if (tracked.length === 0) {
  console.error('Der er ingen tracked Markdown-indlæg tilbage. Seed-filen er allerede lavet, og scriptet må ikke overskrive den med en tom liste.');
  process.exit(1);
}

const processor = await createMarkdownProcessor({
  remarkPlugins: [remarkDirective, remarkBlogDirectives],
});

const words = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean).length;

const posts = [];
for (const path of tracked) {
  const raw = await readFile(resolve(repoRoot, path), 'utf8');
  const { frontmatter: data, content } = parseFrontmatter(raw);
  const rendered = await processor.render(content);
  const slug = path.split('/').pop().replace(/\.md$/, '');
  const publishDate = new Date(data.publishDate);
  if (Number.isNaN(publishDate.valueOf())) throw new Error(`${path}: ugyldig publishDate`);

  posts.push({
    slug,
    title: String(data.title ?? slug),
    description: data.description ? String(data.description) : null,
    bodyMarkdown: content,
    bodyHtml: rendered.code,
    tldr: data.tldr ? String(data.tldr) : null,
    publishDate: publishDate.toISOString(),
    updated: data.updated ? new Date(data.updated).toISOString() : null,
    draft: Boolean(data.draft),
    tags: (data.tags ?? []).map(String),
    sites: (data.sites ?? []).map(String),
    links: (data.links ?? []).map((link) => ({ title: String(link.title), url: String(link.url) })),
    cover: data.cover ? String(data.cover) : null,
    video: data.video ? String(data.video) : null,
    videoFormat: data.videoFormat ?? null,
    font: data.font ?? 'serif',
    voice: data.voice ? String(data.voice) : null,
    archived: Boolean(data.archived),
    readingMinutes: Math.max(1, Math.round(words(content) / 200)),
    interactive: {
      comments: data.interactive?.comments ?? true,
      highlights: data.interactive?.highlights ?? true,
      graffiti: data.interactive?.graffiti ?? true,
      readAloud: data.interactive?.readAloud ?? true,
    },
  });
}

posts.sort((a, b) => b.publishDate.localeCompare(a.publishDate));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(posts, null, 2)}\n`);

console.log(`Skrev ${posts.length} indlæg til ${output}`);
for (const post of posts) console.log(`  ${post.slug}${post.draft ? ' (kladde)' : ''}`);
