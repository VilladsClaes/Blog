// Dine andre websites. Brug nøglen i et indlægs `sites:` for at knytte det til sitet.
// Sitet kan vise relaterede indlæg med: <script src="https://blog.villadsclaes.dk/embed.js" data-site="longbets" async></script>
export interface Site {
  key: string;
  name: string;
  url: string;
  description: string;
}

export const sites: Site[] = [
  { key: 'villadsclaes', name: 'villadsclaes.dk', url: 'https://villadsclaes.dk', description: 'Sites og projekter' },
  { key: 'mig', name: 'Mig', url: 'https://mig.villadsclaes.dk', description: 'Om Villads' },
  { key: 'longbets', name: 'LongBets', url: 'https://longbets.villadsclaes.dk', description: 'Danmarks mest tålmodige bookmaker' },
  { key: 'hyponet', name: 'Hyponet', url: 'https://hyponet.villadsclaes.dk', description: 'Samtalen' },
  { key: 'techtree', name: 'Læringstræet', url: 'https://techtree.villadsclaes.dk', description: 'Teknologiens og læringens træ' },
  { key: 'goodbad', name: 'GoodBad', url: 'https://goodbad.villadsclaes.dk', description: 'Det gode og det dårlige' },
  { key: 'quiz', name: 'Quiz', url: 'https://quiz.villadsclaes.dk', description: 'Quizzer' },
  { key: 'venskab', name: 'Venskabsbutikken', url: 'https://venskab.villadsclaes.dk', description: 'Køb et venskab' },
  { key: 'foretagsomheden', name: 'Foretagsomheden', url: 'https://www.foretagsomheden.dk', description: 'Foretagsomheden' },
];

export const siteByKey = (key: string) => sites.find((s) => s.key === key);
