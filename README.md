# blog.villadsclaes.dk

En enkel blog, hvor læserne må sætte spor: stemme, sige deres mening, understrege, skrive noter i marginen, tegne graffiti, få teksten læst op og give deres besyv.

| Mappe | Hvad |
|---|---|
| `site/` | Selve bloggen (Astro). Indlæg ligger som Markdown i `site/src/content/posts/`. |
| `site/public/admin/` | Skriveværktøjet på `/admin/` (Sveltia CMS) – virker også på mobilen. |
| `api/` | Lille ASP.NET Core 10-app, der serverer siderne og gemmer det interaktive i MySQL. |
| `.github/workflows/deploy.yml` | Bygger og udgiver automatisk til Simply.com. |

## Skriv et indlæg

**Fra mobilen eller computeren:** Gå til <https://blog.villadsclaes.dk/admin/>, vælg *Sign in with Token* og indsæt en GitHub-token (se nedenfor). Skriv, tryk *Publish* – så er indlægget ude et par minutter efter.

**Planlæg:** Sæt *Udgivelsestidspunkt* i fremtiden. GitHub Actions kigger hver time og udgiver indlægget, når tiden er inde.

**Kladde:** Slå *Kladde* til, så bliver indlægget ikke vist.

**Direkte i GitHub:** Du kan også oprette en `.md`-fil i `site/src/content/posts/` via GitHub-appen eller github.com.

**Endnu hurtigere:** Brug opslagsstudiet på <https://blog.villadsclaes.dk/studie/>. Her kan du optage video fra webcam, skrive med layoutværktøjer, tage billeder med telefonen og udgive det hele uden at forlade bloggen.

### Opslagsstudiet (`/studie/`)

Studiet er et authoring-værktøj og er markeret med `noindex`. Det bruger den samme GitHub-forbindelse som skriveværktøjet:

1. Lav et fine-grained token med adgang til `VilladsClaes/Blog` og **Contents: Read and write**.
2. Åbn en opslagstype, fold *GitHub-forbindelse* ud, indsæt token'et og tryk *Test forbindelse*.
3. Token'et gemmes kun i browserens `localStorage` og sendes direkte til GitHub – ikke til bloggens server.

Uden token kan du stadig hente mediet og kopiere Markdown til `/admin/`.

#### Video

`/studie/video/` åbner webcam og mikrofon direkte i browseren. Optag op til 3 minutter, sæt klipstart og klipslut, og vælg:

- **Lodret 9:16** til Instagram Reels og YouTube Shorts.
- **Vandret 16:9** til YouTube.

Klippet dannes i realtid i browseren. Chrome/Android giver en WebM-fil; iPhone/Safari giver MP4, som Instagram tager direkte. YouTube tager begge. Studiet laver også færdige Instagram- og YouTube-tekster ud fra titel, beskrivelse og emner.

Ved udgivelse uploades klippet til `site/public/media/uploads/<slug>/` og indlægget får en `::video`-blok med `format="lodret"`.

#### Tekst

`/studie/tekst/` har en værktøjslinje og live-forhåndsvisning. Blokkene kan også skrives i hånden:

```md
::tldr{titel="Kort fortalt"}
Det vigtigste …
::

::detaljer{titel="De udvidede detaljer"}
Alt det lange …
::

::::kolonner{antal="2"}
:::kolonne
Venstre …
:::
:::kolonne
Højre …
:::
::::

::citat{kilde="Navn"}
En sætning, der skal frem …
::

::skrift{font="sans"}
Et afsnit i sans …
::

::faktaboks{titel="Godt at vide"}
En kort boks …
::
```

Skrifttypen kan også vælges for hele indlægget med `font:` i frontmatter (`serif`, `sans`, `mono`, `haandskrift`). `tldr:` i frontmatter giver en TLDR-boks øverst. Læg mærke til, at indlejrede blokke bruger ét kolon mere i hegnet end den ydre blok.

#### Billede

`/studie/billede/` kan åbne telefonens kamera, tage flere billeder, dreje dem og bruge det første som forsidebillede. Billederne skaleres til max. 2000 px og gemmes som JPEG.

**Google Fotos:** På iPhone og Android kan Google Fotos vælges i telefonens egen billedvælger. Vil du hente direkte fra Google Fotos, skal du lave et Google Cloud-projekt med **Photos Picker API** og en OAuth-webklient til bloggens origin og indsætte klient-id'et i `site/src/data/google.ts`. Klient-id'er er offentlige. Uden opsætning vises knappen ikke, men billedvælgeren virker stadig.

#### Lyd (på grenen `lydopslag`)

Lydstudiet ligger bevidst på en separat git-gren, så video-, tekst- og billedstudiet kan udgives først. På grenen findes:

- optagelse med mikrofon, niveau- og bølgevisning, klipning og MP3-eksport med ID3-tags,
- udgivelse som lydopslag med afspiller,
- podcast-feed på `/podcast.xml` med iTunes-tags,
- show notes og eksport til Podbean, Substack og andre podcastportaler.

Skift gren med `git switch lydopslag`. Se grenens README-afsnit for detaljer.

### Interaktive elementer i teksten

Skriv dem på deres egen linje:

```md
::afstemning[Skal jeg flytte på landet?]{valg="Ja|Nej|Ved ikke"}
::holdning[Skolen bør afskaffe karakterer]
::video[Valgfri billedtekst]{src="https://youtu.be/abc123"}
```

Et `::spoergsmaal` er et kortere holdningsspørgsmål med faste svarmuligheder. Det bruger samme tælling som en afstemning, men rammen er mere samtalende – god til spørgsmål, der hører tæt sammen med teksten:

```md
::spoergsmaal[Ville du gøre det samme i den situation?]{valg="Jeg ville nok spørge vedkommende først|Jeg ville gøre præcis det samme som kloge Villads|Jeg har aldrig tænkt over det før"}
```

Og midt i en sætning: `Det her er :vigtigt[rigtig vigtigt].`

Understregninger, noter, graffiti, oplæsning og besyv er slået til på alle indlæg. De kan slås fra pr. indlæg under *Interaktive funktioner*.

### Læs op i min egen stemme

Et indlæg kan få en indlæst version i din egen stemme. Læserne ser en *Lyt med min stemme*-afspiller øverst, og browserens oplæsning virker stadig som reserve.

1. Brug stemmeprofilen fra BørneTV-projektet hos din TTS-udbyder (fx ElevenLabs), eller lav en ny stemmeklon. Stemmeprøven kan optages under *Tekst* → *Læs op i min egen stemme*.
2. Sæt miljøvariablerne og kør scriptet i `site/`:

```bash
ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=… npm run voice -- min-slug
```

Scriptet læser titel, beskrivelse og den rene tekst, laver `site/public/media/voice/<slug>.mp3` og sætter `voice:` i indlæggets frontmatter. Brug `--no-patch`, hvis du selv vil indsætte linjen. Nøglen og voice-id'et ligger kun i miljøet – aldrig i repoet.

### Knyt et indlæg til dine andre sites

### Knyt et indlæg til dine andre sites

Vælg sitet under *Hører til disse sites*. Indlægget vises så på `/sites/<site>/`, og sitet selv kan vise listen med én linje:

```html
<script src="https://blog.villadsclaes.dk/embed.js" data-site="longbets" async></script>
```

Listen over sites står i `site/src/data/sites.ts` og i `site/public/admin/config.yml`.

## Første opsætning

1. **Tag en backup** af den gamle blog-mappe (`/blog/` på FTP), før første udgivelse – den nye blog overskriver `Web.config`.
2. **Opret en MySQL-database** til bloggen i Simplys kontrolpanel (fx `villadsclaes_dk_db_blog`). Tabellerne (`blog_*`) oprettes automatisk ved første opstart.
3. **Repository secrets** på GitHub (*Settings → Secrets and variables → Actions*):
   - `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` – samme som i dine andre Simply-repos.
   - `DB_CONNECTION_STRING` – fx `Server=mysql94.unoeuro.com;Port=3306;Database=villadsclaes_dk_db_blog;User=villadsclaes_dk;Password=…;Character Set=utf8mb4;SslMode=Preferred`
   - `ADMIN_KEY` – en lang tilfældig tekst. Bruges i headeren `X-Admin-Key` til at slette upassende indhold.
4. **Kør workflowet** manuelt (*Actions → Byg og udgiv bloggen → Run workflow*, med *full* slået til).
5. **GitHub-token til skriveværktøjet:** <https://github.com/settings/personal-access-tokens/new> → *Only select repositories*: `VilladsClaes/Blog` → *Repository permissions → Contents: Read and write*. Gem den i din adgangskodeadministrator, så du kan indsætte den på mobilen.

Hvis bloggen ligger i en anden FTP-mappe end `/blog/`, sættes repository-variablen `FTP_SERVER_DIR`.

## Kør lokalt

```bash
cd site && npm install && npm run dev        # http://localhost:4321 – viser også kladder og planlagte indlæg
npm run build                                # bygger hele bloggen inkl. /studie/
npm run voice -- <slug>                      # laver oplæsning (kræver ELEVENLABS_API_KEY og ELEVENLABS_VOICE_ID)
```

```bash
dotnet run --project api/Blog.Api            # API på http://localhost:5080 med SQLite (blog.db)
```

Astro sender `/api`-kald videre til API'et. Vil du se det hele, som det kører i produktion, så kopiér `site/dist/` til `api/Blog.Api/wwwroot/` og åbn http://localhost:5080.

## Moderation

```bash
curl -H "X-Admin-Key: …" https://blog.villadsclaes.dk/api/admin/seneste
```

```bash
curl -X DELETE -H "X-Admin-Key: …" https://blog.villadsclaes.dk/api/posts/<slug>/comments/<id>
```

Samme for `annotations` og `strokes`. Læsere kan selv slette deres egne bidrag.

Stemmer og holdninger har ét svar pr. læser, så de ryddes via spørgsmålets id – her slettes **alle** svar på spørgsmålet:

```bash
curl -X DELETE -H "X-Admin-Key: …" https://blog.villadsclaes.dk/api/posts/<slug>/polls/<pollId>
curl -X DELETE -H "X-Admin-Key: …" https://blog.villadsclaes.dk/api/posts/<slug>/stances/<stanceId>
```

Uden `X-Admin-Key` kan en læser trække sit eget svar tilbage med `?voter=<id>`.
