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

### Interaktive elementer i teksten

Skriv dem på deres egen linje:

```md
::afstemning[Skal jeg flytte på landet?]{valg="Ja|Nej|Ved ikke"}
::holdning[Skolen bør afskaffe karakterer]
::video[Valgfri billedtekst]{src="https://youtu.be/abc123"}
```

Og midt i en sætning: `Det her er :vigtigt[rigtig vigtigt].`

Understregninger, noter, graffiti, oplæsning og besyv er slået til på alle indlæg. De kan slås fra pr. indlæg under *Interaktive funktioner*.

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
