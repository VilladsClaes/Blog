// Laver en indlæst MP3 i din egen stemme og sætter `voice:` i indlæggets frontmatter.
//
//   ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=… npm run voice -- min-slug
//
// Voice-id'et findes i din stemmeprofil (fx den fra BørneTV-projektet) hos udbyderen.
// Sæt eventuelt ELEVENLABS_MODEL_ID (standard: eleven_multilingual_v2).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const slugs = args.filter((arg) => !arg.startsWith('-'));
const noPatch = args.includes('--no-patch');

if (!slugs.length) {
  console.error('Brug: npm run voice -- <slug> [<slug> …] [--no-patch]');
  process.exit(1);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

if (!apiKey || !voiceId) {
  console.error('Sæt ELEVENLABS_API_KEY og ELEVENLABS_VOICE_ID som miljøvariabler. Se README.md under “Læs op i min egen stemme”.');
  process.exit(1);
}

const postsDir = 'src/content/posts';
const outputDir = 'public/media/voice';
mkdirSync(outputDir, { recursive: true });

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

function plainText(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^:{2,}[^\n]*$/gm, ' ')
    .replace(/:([a-zA-ZæøåÆØÅ]+)\[([^\]]*)\]/g, '$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>\-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/&[a-z#0-9]+;/g, (entity) => ENTITIES[entity] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function frontmatter(raw) {
  const match = raw.match(/^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n)/);
  if (!match) return null;
  return { eol: match[1], value: match[2], rest: raw.slice(match[0].length), prefixLength: match[0].length };
}

function titleFrom(frontmatterText, fallback) {
  const raw = frontmatterText.match(/^title:\s*(.+)$/m)?.[1] ?? fallback;
  return raw.replace(/^["']|["']$/g, '').replace(/\\"/g, '"').trim();
}

function patchFrontmatter(raw, slug) {
  const parsed = frontmatter(raw);
  if (!parsed) throw new Error('Indlægget mangler frontmatter.');
  const line = `voice: /media/voice/${slug}.mp3`;
  const value = /^voice:.*$/m.test(parsed.value)
    ? parsed.value.replace(/^voice:.*$/m, line)
    : `${parsed.value}${parsed.eol}${line}`;
  return `---${parsed.eol}${value}${parsed.eol}---${parsed.eol}${raw.slice(parsed.prefixLength)}`;
}

function chunks(text, size = 3800) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const result = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > size && current) {
      result.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function stripId3(buffer) {
  if (buffer.subarray(0, 3).toString() !== 'ID3') return buffer;
  const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
  return buffer.subarray(10 + size);
}

async function synthesize(text) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    },
  );
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.detail?.message ?? body?.detail ?? '';
    } catch {
      /* ikke JSON */
    }
    throw new Error(`Udbyderen svarede ${response.status}${detail ? `: ${detail}` : ''}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

for (const slug of slugs) {
  const file = `${postsDir}/${slug}.md`;
  if (!existsSync(file)) {
    console.error(`✗ ${file} findes ikke.`);
    continue;
  }
  const raw = readFileSync(file, 'utf8');
  const parsed = frontmatter(raw);
  if (!parsed) {
    console.error(`✗ ${slug}: frontmatter blev ikke fundet.`);
    continue;
  }
  const title = titleFrom(parsed.value, slug);
  const description = parsed.value.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
  const text = [title, description, plainText(raw.slice(parsed.prefixLength))].filter(Boolean).join('\n\n');

  if (text.length < 20) {
    console.error(`✗ ${slug}: der er ikke nok tekst at læse op.`);
    continue;
  }

  const pieces = chunks(text);
  console.log(`→ ${slug}: ${text.length} tegn i ${pieces.length} del(e) …`);
  const buffers = [];
  for (const [index, piece] of pieces.entries()) {
    process.stdout.write(`  læser del ${index + 1}/${pieces.length} … `);
    buffers.push(index === 0 ? await synthesize(piece) : stripId3(await synthesize(piece)));
    console.log('ok');
  }

  const output = `public/media/voice/${slug}.mp3`;
  writeFileSync(output, Buffer.concat(buffers));
  const seconds = Math.round((buffers.reduce((total, buffer) => total + buffer.length, 0) * 8) / 128_000);
  console.log(`✓ ${output} (ca. ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`);

  if (!noPatch) {
    writeFileSync(file, patchFrontmatter(raw, slug));
    console.log(`  voice: /media/voice/${slug}.mp3 er sat i ${file}`);
  }
}
