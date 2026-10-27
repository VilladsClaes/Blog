// Bruges af GitHub Actions hver time: Er der et indlæg, der er blevet "modent"
// siden sidste kørsel? Skriver due=true/false til $GITHUB_OUTPUT.
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';

const windowMinutes = Number(process.env.WINDOW_MINUTES ?? 65);
const now = Date.now();
const from = now - windowMinutes * 60_000;
const due = [];

for (const file of readdirSync('src/content/posts').filter((f) => f.endsWith('.md'))) {
  const fm = readFileSync(`src/content/posts/${file}`, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  if (/^draft:\s*true/m.test(fm)) continue;
  const raw = fm.match(/^publishDate:\s*["']?([^"'\n]+)/m)?.[1];
  const t = raw ? Date.parse(raw) : NaN;
  if (t > from && t <= now) due.push(file);
}

console.log(due.length ? `Klar til udgivelse: ${due.join(', ')}` : 'Ingen planlagte indlæg i dette vindue.');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `due=${due.length > 0}\n`);
