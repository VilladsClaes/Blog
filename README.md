# blog.villadsclaes.dk

En enkel blog, hvor læserne må sætte spor: stemme, sige deres mening, understrege, skrive noter i marginen, tegne graffiti, få teksten læst op og give deres besyv.

**Indholdet ligger i databasen på webhotellet.** GitHub bruges kun til skabelonen, koden og API'et – ikke som lager for nye indlæg eller billeder.

| Mappe | Hvad |
|---|---|
| `site/` | Bloggens Astro-skabelon. Der ligger ikke længere indlæg som Markdown. |
| `site/src/pages/admin/` | Det nye skriveværktøj på `/admin/`. Det gemmer direkte i databasen. |
| `api/` | ASP.NET Core 10-app, der serverer siderne, API'et og databaseindlæggene. |
| `api/Blog.Api/Seed/` | Engangskopi af de gamle indlæg og medier. API'et indlæser dem i databasen ved opstart og springer allerede importerede slugs over. |
| `.github/workflows/deploy.yml` | Bygger og udgiver **koden** til Simply.com, når den ændres. |

## Sådan virker det

- Alle indlæg – også de gamle – ligger i `blog_posts`; alle gamle billeder ligger i `blog_media`.
- Et indlæg får sin egen side med det samme: `https://blog.villadsclaes.dk/<slug>/`.
- Gamle URL’er som `/elforbrug/` og `/media/zoher4cl/hypo.jpg` virker fortsat. API’et slår op i databasen **før** de statiske filer, så en gammel `index.html` ikke kan skygge for et databaseindlæg.
- Forsiden, `/emner/`, `/sites/`, RSS og JSON-feeds bliver fyldt fra databasen ved hvert request.
- Der er ingen GitHub-token, commit eller Actions-kørsel involveret, når du gemmer et indlæg eller et billede.

## Skriv et indlæg

Gå til <https://blog.villadsclaes.dk/admin/> og indsæt din admin-nøgle. Nøglen gemmes kun i faneens `sessionStorage`.

1. Skriv titel og eventuelt en kort beskrivelse.
2. Vælg udgivelsestidspunkt. Et tidspunkt i fremtiden betyder, at indlægget først vises, når tiden er inde – uden at noget skal bygges om.
3. Slå **Kladde** til, hvis indlægget ikke skal vises endnu.
4. Skriv teksten i Markdown. Forhåndsvisningen viser bloggens blokke.
5. Upload forsidebillede og eventuelle billeder i teksten. De gemmes i databasen og serveres fra `/api/blog/media/<id>`.
6. Tryk **Gem i databasen**. Indlægget er live med det samme, medmindre det er en kladde eller har en fremtidig dato.

Når et indlæg er gemt, kan du finde det igen i listen til venstre. Adressen låses, så gamle links ikke ændrer sig. De gamle indlæg er importeret med deres Markdown, så de kan redigeres på samme måde som nye.

Når et indlæg er åbnet, kan du trykke **Flyt til papirkurv**. Indlægget og dets medier bevares, indtil du tømmer papirkurven permanent. Undervejs gemmes en version ved hvert gem, så du kan gendanne en tidligere tekst. **Slet permanent** fjerner først indlægget, når du bekræfter det i papirkurven.

### Preview, autosave og oprydning

- **Kopiér preview-link** giver et midlertidigt link, der også viser kladder og planlagte indlæg. Linket virker i syv dage og kan deles uden at gøre indlægget offentligt.
- Editoren gemmer automatisk en kladde i browseren, mens du skriver. Efter en genindlæsning kan du gendanne den med knappen over gem-knappen.
- **Medier** i sidepanelet viser, hvilke indlæg der bruger hver fil. Ubrugte filer kan fjernes enkeltvis eller med **Ryd ubrugte**.
- **Backup og drift** henter en zip med både indlæg og mediebytes. Den kan gendannes fra samme panel. API’et laver desuden en automatisk backup ved opstart og derefter hvert døgn og beholder de seneste syv.
- **Diagnostik** viser database, antal indlæg, kladder, papirkurv, medier og seneste backup.

### Blokke i teksten

Blokkene skrives på deres egen linje:

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

::afstemning[Skal jeg flytte på landet?]{valg="Ja|Nej|Ved ikke"}
::holdning[Skolen bør afskaffe karakterer]
::video[Valgfri billedtekst]{src="https://youtu.be/abc123"}
::billede[Billedtekst]{src="/api/blog/media/12"}
```

Et `::spoergsmaal` er et kortere holdningsspørgsmål med faste svarmuligheder. Det bruger samme tælling som en afstemning, men rammen er mere samtalende:

```md
::spoergsmaal[Ville du gøre det samme i den situation?]{valg="Jeg ville nok spørge vedkommende først|Jeg ville gøre præcis det samme|Jeg har aldrig tænkt over det før"}
```

Midt i en sætning: `Det her er :vigtigt[rigtig vigtigt].`

Skrifttypen for hele indlægget vælges i editoren (`serif`, `sans`, `mono` eller `haandskrift`). Understregninger, noter, graffiti, oplæsning og besyv kan slås fra pr. indlæg under **Interaktive funktioner**.

## Første opsætning

1. **Tag en backup** af den gamle blog-mappe på FTP, før den nye kode udgives.
2. **Opret en MySQL-database** i Simplys kontrolpanel. API'et opretter selv `blog_posts` og `blog_media` ved første opstart; de gamle `blog_*`-tabeller oprettes også, hvis de mangler.
3. **Repository secrets** på GitHub:
   - `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` – FTP-login til Simply.
   - `DB_CONNECTION_STRING` – fx `Server=mysql94.unoeuro.com;Port=3306;Database=villadsclaes_dk_db_blog;User=villadsclaes_dk;Password=…;Character Set=utf8mb4;SslMode=Preferred`
   - `ADMIN_KEY` – en lang tilfældig tekst. Den bruges i `/admin/` og i headeren `X-Admin-Key` til moderation.
4. **Kør workflowet** manuelt første gang (*Actions → Byg og udgiv bloggen → Run workflow*, med *full* slået til), så API'et og `appsettings.Production.json` kommer med.
5. **Indsæt admin-nøglen** i `/admin/`. Den er den samme værdi som `ADMIN_KEY`.

Ved første opstart importerer API’et de 15 gamle indlæg og 9 billeder fra `api/Blog.Api/Seed/`. Importen er idempotent: indlæg med samme slug og billeder med samme offentlige sti springes over, så dine senere redigeringer ikke bliver overskrevet. Når importen er gennemført i produktion, kan `Seed/`-mappen slettes; databasen er nu kilden.

Hvis bloggen ligger i en anden FTP-mappe end `/blog/`, sættes repository-variablen `FTP_SERVER_DIR`.

## Kør lokalt

```bash
cd site
npm install
npm run dev        # Astro på http://localhost:4321 – kun den statiske skabelon
npm run build      # bygger den statiske skabelon (uden indlæg)
```

```bash
dotnet run --project api/Blog.Api
# API på http://localhost:5080 med SQLite i api/Blog.Api/blog.db
# Sæt Admin__Key=din-testnøgle for at bruge /admin/ lokalt.
```

Vil du se det hele, som det kører i produktion, så kopiér `site/dist/` til `api/Blog.Api/wwwroot/` og åbn <http://localhost:5080>. Astro sender `/api`-kald videre til API'et under udvikling.

Eksempel på et lokalt admin-kald:

```bash
curl -X PUT \
  -H "X-Admin-Key: din-testnøgle" \
  -H "Content-Type: application/json" \
  --data-binary @indlaeg.json \
  http://localhost:5080/api/admin/blog/posts/min-slug
```

### Regressionstest

```bash
bash api/Blog.Api/smoke-admin.sh
```

Scriptet starter en midlertidig API-instans, gemmer en kladde, tjekker at den ikke er offentlig, henter et preview-link, gemmer en version, flytter til papirkurv, gendanner, og tjekker diagnostik, backup og mediebibliotek. Testindlægget ryddes op bagefter.

## Udgiv kode

Workflowet kører på push til `main`, på pull requests og manuelt. Det bygger Astro-skabelonen og API'et og uploader dem til webhotellet.

**Indhold kræver ingen udgivelse.** Nye indlæg, rettelser og billeder ligger allerede i databasen, når du trykker gem. GitHub Actions er kun nødvendig, når du ændrer koden eller skabelonen.

## Engangsflytningen

De gamle Markdown-filer er fjernet fra `site/src/content/posts/`. `site/scripts/export-posts.mjs` blev brugt én gang til at lave `api/Blog.Api/Seed/posts.json` med Astros egen Markdown-renderer, så HTML’en matcher de gamle sider. `api/Blog.Api/Seed/media/` indeholder de gamle billeder.

API’et indlæser seeden ved opstart. Når `blog_posts` og `blog_media` er fyldt i produktion, behøves seeden ikke længere.

## Opslagsstudie

`/studie/` rummer de tre opslagsværktøjer: **video**, **tekst** og **billede**. De bruger den samme admin-nøgle som `/admin/` og gemmer nu direkte i `blog_posts` og `blog_media` i stedet for at committe til GitHub. Nøglen gemmes kun i fanens `sessionStorage`.

Videoer og billeder uploades til databasen via `/api/admin/blog/media` og serveres fra `/api/blog/media/<id>`. Videoer må højst være 45 MB. Videoer kan få et automatisk forsidebillede fra første frame og en `.vtt`-undertekstfil.

## Dynamiske lister og sitemap

Forsiden, `/emner/`, `/sites/`, `/rss.xml`, `/feeds/…` og `/sitemap.xml` hentes fra databasen ved hvert request. Nye indlæg dukker derfor op med det samme. Nye emner og site-nøgler får også deres egen side via API’ets skabeloner. `/sitemap-index.xml` peger på `/sitemap.xml`, og den gamle `/sitemap-0.xml` svarer med samme sitemap.

## Begrænsninger

- Admin-editoren og opslagsstudiet genererer HTML i browseren og gemmer det i databasen. API’et saniterer HTML’en, men adgangen er stadig én delt admin-nøgle – der er endnu ikke separate brugersessioner.
- Upload genoptages ved at prøve filen igen med progress og automatisk retry. En afbrudt fil fortsætter ikke fra den præcise byte-position.
- Video, kamera og mikrofon er testet i Chromium med syntetisk stream; fysiske telefoner, Safari og Android skal stadig prøves på enhederne.

## Moderation

```bash
curl -H "X-Admin-Key: …" https://blog.villadsclaes.dk/api/admin/seneste
curl -X DELETE -H "X-Admin-Key: …" https://blog.villadsclaes.dk/api/posts/<slug>/comments/<id>
```

Samme for `annotations` og `strokes`. Læsere kan selv slette deres egne bidrag.
