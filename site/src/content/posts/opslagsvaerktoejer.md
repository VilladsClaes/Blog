---
title: "Sådan bruger du de nye opslagsværktøjer"
description: "En kladde, der viser kolonner, citatfremhævelser, skrifttyper, TLDR og udfoldelige detaljer – og hvordan du selv bruger dem."
publishDate: 2026-11-01T09:00:00+01:00
draft: true
tags: ["blog", "værktøjer", "skrivning"]
font: "serif"
tldr: "Kolonner, citater, skrifttyper og TLDR er nu en del af Markdown. Det her er en levende demonstration, som kun vises under udvikling."
---

Det her er et eksempel på, hvad de nye layoutværktøjer kan. Indlægget er en kladde, så det bliver ikke udgivet sammen med bloggen – men du kan se det i udviklingsserveren og bruge det som skabelon.

::tldr{titel="Kort fortalt"}
Du kan dele teksten i kolonner, fremhæve citater, skifte skrifttype for hele indlægget eller enkelte afsnit og gemme det lange i udfoldelige detaljer.
::

## To kolonner

::::kolonner{antal="2"}
:::kolonne
**Venstre spalte** er god til baggrund, en liste eller et lille regnestykke.

- Første pointe
- Anden pointe
- Tredje pointe
:::
:::kolonne
**Højre spalte** kan fortsætte tanken eller give et eksempel.

> En lille pause i teksten gør det lettere at læse videre.
:::
::::

## Fremhævet citat

::citat{kilde="Villads Claes"}
Det er ikke, fordi der mangler ord. Det er, fordi der mangler plads til at tænke dem.
::

## Skrifttyper

::skrift{font="sans"}
Dette afsnit er sat med bloggens sans-serif. Brug det til praktiske oplysninger, lister eller noget, der skal læses hurtigt.
::

::skrift{font="mono"}
Dette afsnit er sat med mono. Det er godt til kode, tal og små systemer.
::

## Udvidede detaljer

::detaljer{titel="Klik her for hele forklaringen"}
Det lange afsnit behøver ikke at fylde i det første overblik. Her kan du skrive baggrund, forbehold og alt det, som kun de virkelig interesserede har brug for.

Det virker også med flere afsnit og lister:

1. Først det ene
2. Så det andet
3. Til sidst det tredje
::

::faktaboks{titel="Godt at vide"}
Blokkene kan kombineres. Læg fx en kolonne ind i en faktaboks, eller brug `::skrift` om et helt afsnit.
::

## Et billede

::billede[Et billede kan nu have billedtekst og vises i fuld bredde]{src="/media/hfscwysj/villads3.jpg" alt="Villads" bred}

## Skriv selv

Åbn <a href="/studie/tekst/">tekststudiet</a>, markér et afsnit og tryk på et af layoutværktøjerne. Markdown-koden bliver skrevet for dig.
