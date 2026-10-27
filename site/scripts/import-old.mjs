// Engangsimport af de gamle Articulate-indlæg: node scripts/import-old.mjs <mappe med .html>
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import TurndownService from 'turndown';

const dir = process.argv[2];
const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&aelig;/g, 'æ').replace(/&oslash;/g, 'ø').replace(/&aring;/g, 'å').replace(/&hellip;/g, '…').trim();
const yaml = (s) => JSON.stringify(s);

for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(dir, file), 'utf8');
  const slug = basename(file, '.html');
  const out = `src/content/posts/${slug}.md`;
  if (existsSync(out)) continue;
  const title = decode(html.match(/class="post-title">([^<]*)</)?.[1] ?? slug);
  const date = html.match(/<time datetime="([^"]+)"/)?.[1];
  const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '').split('\n')[0].slice(0, 200);
  const tags = decode(html.match(/<meta name="tags" content="([^"]*)"/)?.[1] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const content = html.match(/<section class="post-content">([\s\S]*?)<\/section>/)?.[1] ?? '';
  const md = td.turndown(content).replace(/\n{3,}/g, '\n\n').trim();
  writeFileSync(out, `---
title: ${yaml(title)}
description: ${yaml(description)}
publishDate: ${date}
tags: ${JSON.stringify([...tags, 'arkiv'])}
archived: true
---

${md}
`);
  console.log('Importeret', slug);
}
