# JobWatcher

Zoekt elke dag automatisch naar vacatures die passen bij je CV's, onthoudt wat je al gezien hebt,
en toont alles in een overzichtelijke webapp met een directe **Solliciteer**-link.

```
CV's (.docx)  ──►  keywords per CV  ──►  dagelijkse scraper  ──►  data/jobwatcher.db  ──►  webapp (localhost:3000)
                    (config/profile.json)   (100+ bedrijven,          (SQLite, enkel           Nieuw / Te bekijken /
                                             ictjob.be, Adzuna, …)     nieuwe matches)          Bewaard / Gesolliciteerd
```

## Snel starten (Windows)

Vereist: **Node.js 22.13 of nieuwer** (`node --version`). Anders: LTS installeren via <https://nodejs.org>.

```bat
cd C:\Users\frederic\Desktop\JobWatcher
npm install
npm run scrape                 :: eerste zoekrun (duurt de eerste keer ~5-10 min)
JobWatcher.cmd                 :: opent de app op http://localhost:3000
scripts\install-daily-task.cmd :: elke dag om 08:00 automatisch zoeken
```

Andere tijd? `powershell -ExecutionPolicy Bypass -File scripts\install-daily-task.ps1 -Time 07:30`

## Hoe het werkt

### 1. Keywords uit je CV's (`npm run keywords`)
`scraper/keywords.mjs` leest elk `.docx` in `../CV/Nieuw/<Profiel>/` (instelbaar via `cvFolder`):
- de **functietitel** ("Junior Backend Developer") wordt vertaald naar zoektermen (backend developer, api developer, software engineer, …)
- de **SKILLS-sectie** wordt de lijst met skills (met synoniemen: `Google Cloud` = `gcp`, `Node.js` = `nodejs`, …)

Resultaat: één zoekprofiel per CV in `config/profile.json`. Pas je een CV aan, dan worden de keywords bij de
volgende run automatisch opnieuw opgebouwd.

### 2. Bronnen (`npm run scrape`)
| Bron | Wat | Hoe |
|---|---|---|
| **Bedrijven** (`config/companies.json`) | ~100 Belgische tech-bedrijven en IT-consultancies | Officiële vacature-API van hun recruitmentsysteem (Greenhouse, Lever, Recruitee, Workable, Teamtailor, Personio, SmartRecruiters, Ashby, Workday) of hun eigen vacaturepagina |
| **ictjob.be** | Grootste Belgische IT-jobsite | Publieke sitemap + detailpagina (enkel nieuwe) |
| **Adzuna** | Aggregator met veel Belgische vacatures | API, optioneel: gratis key in `.env` (zie `.env.example`) |
| **Remotive, Arbeitnow** | Remote / Europese jobs | API, enkel België of remote-Europa blijft over |

VDAB, StepStone, Indeed en LinkedIn staan er bewust niet in: hun voorwaarden/robots.txt verbieden scrapen.

**Bedrijf toevoegen:** zet `{ "name": "Naam", "website": "https://..." }` in `config/companies.json` en voer
`npm run discover` uit. Dat zoekt automatisch uit welk recruitmentsysteem ze gebruiken.
Een bedrijf tijdelijk uitzetten: `"disabled": true`.

### 3. Matching & score
Per vacature wordt elk CV-profiel gescoord, het beste profiel wint (dat zie je als label `CV · Backend` →
handig om te weten welk CV je meestuurt):

| | punten |
|---|---|
| Functietitel bevat een rol uit dat CV | +6 |
| Skill in de titel | +2 per skill |
| Skill in de beschrijving | +1 per skill (max +6) |
| Junior / graduate / starter | +3 (titel) of +1.5 (tekst) |
| Regio Gent (voorkeurslocaties) | +2 |
| Vraagt meer jaren ervaring dan `maxYearsExperience` | −4 |

Weggefilterd: titels met `senior`, `lead`, `manager`, `stage`, … (`excludeTitleWords`), freelance, en jobs buiten
je straal (zie hieronder). Alles boven `minScore` (standaard 5) komt in de app.

### Afstand: enkel jobs binnen 25 km van thuis
`settings.json` → `home` (Brugsesteenweg 40, 9000 Gent) en `maxDistanceKm` (25). De plaats in de vacature
("Gent · Hybride", "9050 Gentbrugge", "Ghent, BE", "Mechelen/Leuven/Gent", …) wordt opgezocht in een lijst van
alle Belgische (deel)gemeenten met coördinaten (`scraper/data/be-places.json`, offline) en de afstand in
vogelvlucht berekend. In de app zie je die als `3 km`.
- Meerdere plaatsen vermeld → de dichtstbijzijnde telt.
- Enkel "Belgium" / niets vermeld → de stad van het bedrijf uit `companies.json` (`"city"`) als die gekend is,
  anders label **locatie onbekend** (zet `"unknownLocation": "drop"` om die weg te laten).
- Volledig remote mag (`allowRemote`), hybride telt als op locatie.
- Pas je de straal aan, dan geldt die bij de volgende run ook voor alle bestaande jobs.

### Sollicitaties-sheet
Jobs die al in je Google Sheet **Sollicitaties** staan, worden niet meer als nieuw getoond:
- tabblad *Gesolliciteerd* → status **Gesolliciteerd**
- tabblad *Te solliciteren*: status "Gesolliciteerd" → **Gesolliciteerd**, "Niet solliciteren" → **Verborgen**,
  anders → **Bewaard**

Herkenning op link, of op bedrijf + functie (tikfouten zoals "Engeneer" of "Kwerry" worden opgevangen; de
onderscheidende woorden zoals backend/frontend/python moeten wel overeenkomen). In de app staat dan
"In je sheet (Gesolliciteerd): Qargo – Backend Software Engineer, 02/05/2026".

**De sheet is privé**, dus de scraper heeft toegang nodig. Kies één manier:

1. **Service account (aanbevolen: sheet blijft privé)**
   1. <https://console.cloud.google.com> → nieuw project (bv. "jobwatcher")
   2. *APIs & Services → Library* → zoek **Google Sheets API** → *Enable*
   3. *IAM & Admin → Service Accounts* → *Create service account* → naam `jobwatcher` → *Done*
   4. Klik op het account → tab *Keys* → *Add key → Create new key → JSON* → bestand downloadt
   5. Hernoem naar `google-service-account.json` en zet het in `JobWatcher\config\` (staat in `.gitignore`)
   6. Open de sheet → *Delen* → plak het e-mailadres van het service account (`…@….iam.gserviceaccount.com`,
      staat ook in het JSON-bestand bij `client_email`) → rol **Lezer**
2. **Link delen** – sheet → *Delen* → "Iedereen met de link" → Lezer. Snel, maar dan kan iedereen met de link
   je sollicitaties (incl. namen/e-mails in de feedback) lezen.
3. **Lokaal bestand** – *Bestand → Downloaden → .xlsx*, zet het pad in `applications.file`. Werkt offline, maar
   je moet het zelf opnieuw downloaden als je de sheet aanpast.

Bij elke run zie je in het logboek `✔ sollicitaties: 180 rijen ingelezen` (of een duidelijke foutmelding).

### 4. "Niet opnieuw tonen"
Elke job wordt bewaard in `data/jobwatcher.db` met de run waarin hij voor het eerst gevonden werd.
Een job die al in de database zit (zelfde link, of zelfde bedrijf + titel via een andere site) wordt nooit
opnieuw als nieuw getoond. Afgewezen detailpagina's worden ook onthouden, zodat ze niet elke dag opnieuw
opgehaald worden.

### 5. De app
- **Nieuw**: wat de laatste zoekrun gevonden heeft
- **Te bekijken**: alles wat je nog niet geopend hebt (zodra je op een job klikt, verdwijnt hij hier)
- **Bewaard / Gesolliciteerd / Verborgen**: met de knoppen bij elke job
- Filter op CV-profiel, minimumscore, zoekterm (`/` om te zoeken); knop **Nu zoeken** start meteen een run
- "mogelijk offline": de job werd niet meer teruggevonden bij de laatste runs

## Instellingen (`config/settings.json`)
| Sleutel | Uitleg |
|---|---|
| `cvFolder` | Map met je CV's (relatief t.o.v. deze map) |
| `minScore` | Minimumscore om in de app te komen |
| `maxYearsExperience` | Meer gevraagde jaren ervaring → strafpunten |
| `extraRoles`, `extraSkills` | Extra zoektermen bovenop je CV's |
| `excludeTitleWords`, `excludeCompanies` | Uitsluiten |
| `home`, `maxDistanceKm`, `unknownLocation`, `allowRemote` | Afstandsfilter rond je thuisadres |
| `applications` | Je sollicitatie-sheet (`sheetId`, `tabs`, `serviceAccountKeyFile` of `file`) |
| `sources` | Bronnen aan/uit zetten |
| `maxMinutesPerSource`, `maxDetailsPerSource` | Beveiliging zodat één trage site de run niet blokkeert |

## Commando's
| | |
|---|---|
| `npm run scrape` | Zoekrun (`-- --only=ictjob` enkel één bron, `-- --dry` testen zonder opslaan) |
| `npm run keywords` | Keywords uit CV's opnieuw opbouwen en tonen |
| `npm run discover` | Recruitmentsystemen zoeken voor nieuwe bedrijven (`-- --all` alles opnieuw) |
| `npm run dev` / `JobWatcher.cmd` | App starten |
| `scripts\install-daily-task.cmd` / `uninstall-daily-task.cmd` | Dagelijkse taak aan/uit |

Logboek: `logs/scraper.log`.

## Structuur
```
config/      settings.json (jouw instellingen), companies.json (bedrijven), profile.json (gegenereerd)
scraper/     run.mjs (hoofdscript), match.mjs (score), keywords.mjs (CV → keywords), discover.mjs,
             geo.mjs (afstand), applications.mjs (sollicitatie-sheet), sources/ (ats, html, boards),
             data/be-places.json (Belgische gemeenten + coördinaten), db.mjs, http.mjs, docx.mjs (docx/xlsx)
src/         Next.js app (app/page.tsx, app/api/*, components/JobRow.tsx, lib/db.ts)
data/        jobwatcher.db (SQLite)
scripts/     Windows-taakplanner
```
Geen externe packages voor de scraper: enkel ingebouwde Node.js-modules (`fetch`, `node:sqlite`, `zlib`).
