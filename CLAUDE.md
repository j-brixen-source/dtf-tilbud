# TETOS — Tekstil-tryk.dk Ordre System

> **Aktuel version:** v1.065 (april 2026)
> **Tidligere kendt som:** "DTF Tilbudsberegner"

> **Formål med dette dokument:** Fælles "kontrakt" mellem Jakob (ejer) og enhver
> AI-assistent (Claude) der arbejder på projektet. Læs dette først ved enhver
> ny chat — så starter du med komplet kontekst.

---

## 1. Hvad er TETOS?

En intern web-app til **Tekstil-tryk.dk** der bruges til:

- **Tilbudsberegning**: Vælg tøj fra leverandører (L-shop + Stanley Stella),
  beregn pris baseret på costPrice × markup, fratræk mængderabat, generér
  PDF-tilbud
- **Ordrehåndtering**: Konvertér tilbud til ordrer, generér ordreseddel-PDF
  til trykker
- **Kunde-CRM**: Gemmer kunder med adresse, tilbud-historik, ordre-historik
- **AI email-parsing**: Indsæt en kundes email, og Claude AI uddrager
  ordredetaljer (mængder, størrelser, farver, tryk-positioner) — kører
  server-side via Netlify-function siden v1.059

App'en er **single-tenant** (Tekstil-tryk.dk) men har flere medarbejdere via
Supabase Auth + medarbejder-vælger (siden v1.057). Den er bygget med tanke på
fremtidigt offentligt katalog hvor kunder kan browse produkter med
søge-funktion og se priser.

---

## 2. URL'er og adgang

| Tjeneste | URL | Formål |
|---|---|---|
| **Live app** | https://aquamarine-liger-acf01f.netlify.app | Hovedapp |
| **Billeder** | https://tetos-images.netlify.app | L-shop produktbilleder (~40k JPG) |
| **GitHub repo** | https://github.com/j-brixen-source/dtf-tilbud | Kildekode (PUBLIC) |
| **Supabase** | https://vumyufckkdeeszxvmyjb.supabase.co | Database |
| **Anthropic Console** | https://console.anthropic.com | Til at rotere ANTHROPIC_KEY |

### Netlify site IDs
- **Hovedapp**: `f00a8b1e-e61d-434f-80e6-7f159651f68c` (aquamarine-liger-acf01f)
- **Billeder**: `c43da7b4-ea15-4586-8959-59fa6d3069ca` (tetos-images)

---

## 3. Arkitektur

```
┌──────────────────────────────────────────────────────────┐
│  BRUGER (browser, fx Mac/Chrome)                        │
│  Login via Supabase Auth → vælg medarbejder → app       │
└──────────────────────────────────────────────────────────┘
                  │  HTTPS
                  ▼
┌──────────────────────────────────────────────────────────┐
│  HOVEDAPP — aquamarine-liger-acf01f.netlify.app         │
│  Static HTML/CSS/JS — Netlify CDN                        │
│  • index.html (~227 KB)                                  │
│  • lshop-supabase.js (~28 KB)                            │
│  • TETOS_LOGO.png (~26 KB)                               │
│  • netlify/functions/cvr.js          — CVR-opslag proxy │
│  • netlify/functions/parse-email.js  — AI email-parsing │
└──────────────────────────────────────────────────────────┘
       │                │                          │
       ▼                ▼                          ▼
  ┌─────────┐    ┌────────────┐         ┌──────────────────┐
  │Supabase │    │ tetos-     │         │ Netlify Function │
  │Postgres │    │ images.    │         │ /api/parse-email │
  │         │    │ netlify    │         │                  │
  │ Tables: │    │ .app       │         │  ANTHROPIC_KEY   │
  │ lshop_* │    │            │         │  (env var)       │
  │ stanley_*    │ ~40k JPG'er│         │       │          │
  │ kunder  │    │ Web-       │         │       ▼          │
  │ tilbud  │    │ optimized  │         │ ┌──────────────┐ │
  │ ordrer  │    │ 208x268 px │         │ │ Anthropic API│ │
  │medarbej-│    └────────────┘         │ │ claude-sonnet│ │
  │  dere   │                           │ │     -4-6     │ │
  └─────────┘                           │ └──────────────┘ │
       ▲                                └──────────────────┘
       │ Sync workflows
       │
┌──────┴──────────────────────────────────────────────────┐
│  GitHub Actions (.github/workflows/)                    │
│  • lshop-sync.yml      — FTP→Supabase 4× dagligt        │
│  • stanley-sync.yml    — SS API→Supabase 1× dagligt 06:00 │
└─────────────────────────────────────────────────────────┘
       ▲                              ▲
  ┌────┴────┐                    ┌────┴────────────┐
  │L-shop   │                    │ Stanley Stella  │
  │FTP      │                    │ API             │
  │stockfile│                    │ (JSON-RPC 2.0)  │
  │.csv     │                    └─────────────────┘
  └─────────┘
```

---

## 4. Kildekode-filer (alle i repo-roden)

| Fil | Størrelse | Formål |
|---|---|---|
| `index.html` | ~227 KB | Hele app'en (HTML+CSS+JS i én fil) |
| `lshop-supabase.js` | ~28 KB | Bibliotek: Supabase load + årlig CSV upload |
| `TETOS_LOGO.png` | ~26 KB | Logo til header + login (faktisk JPEG, .png-extension) |
| `netlify.toml` | <1 KB | Netlify config + `/api/*` redirect til functions |
| `netlify/functions/cvr.js` | ~1 KB | CVR-opslag proxy (CORS-undgåelse) |
| `netlify/functions/parse-email.js` | ~7 KB | AI email-parsing via Anthropic API |
| `ss-diagnostik.html` | ~9 KB | Standalone diagnostik-side til Stanley Stella API |
| `.github/workflows/lshop-sync.yml` | ~9 KB | FTP→Supabase 4× dagligt |
| `.github/workflows/stanley-sync.yml` | ~13 KB | SS→Supabase 1× dagligt |

**Filer der skal manuelt uploades til Netlify (ikke i Git):**
- `tetos-images.netlify.app` indeholder ~40k L-shop JPG-filer
  uploadet via https://app.netlify.com/projects/tetos-images/deploys

---

## 5. Supabase-skema

### `lshop_stock` (~179.518 rækker)
Auto-syncet fra L-shop FTP 4× dagligt.
```sql
article_number  text PRIMARY KEY     -- variant SKU
catalog_nr      text                 -- style/produkt SKU
stock_qty       integer
last_updated    timestamptz
```

### `lshop_products` (~6.792 rækker)
Manuelt uploadet ~1× årligt fra L-shop CSV (artikel + Major-pris).
```sql
sku                text PRIMARY KEY  -- catalog_nr
name               text
brand              text
description        text
product_type       text
colors             jsonb             -- ["Black", "White", ...]
sizes              jsonb             -- ["S", "M", "L", ...]
color_size_map     jsonb             -- {color: [sizes]}
color_hex_map      jsonb             -- {color: "#000000"}
color_picture_map  jsonb             -- {color: "AQ001_Black.jpg"}
search_text        text
updated_at         timestamptz
```

### `lshop_variants` (~174.598 rækker)
Variant-niveau pris og lager. Manuelt uploadet sammen med products.
```sql
article_number  text PRIMARY KEY     -- variant SKU
catalog_nr      text
color           text
size            text
color_hex       text
picture_name    text
ek_price        numeric(10,2)        -- DKK
discontinued    boolean
updated_at      timestamptz
```

### `stanley_products` (~136 rækker)
Auto-syncet fra SS API 1× dagligt kl. 06:00 CET.
```sql
style_code      text PRIMARY KEY     -- "STBU274"
name            text
description     text
brand           text DEFAULT 'Stanley Stella'
product_type    text
colors          jsonb
sizes           jsonb
color_size_map  jsonb
color_hex_map   jsonb
color_code_map  jsonb                -- ColorName → "C153" (til billede-URL)
search_text     text
updated_at      timestamptz
```

### `stanley_variants` (~9.923 rækker)
Variant-niveau pris og lager.
```sql
sku             text PRIMARY KEY     -- B2BSKUREF
style_code      text
color           text
color_code      text                 -- "C153"
size            text
color_hex       text
ek_price_eur    numeric(10,2)        -- EUR (omregnes til DKK i UI med kurs)
stock_qty       integer
updated_at      timestamptz
```

### `kunder`, `tilbud`, `ordrer`
Eksisterer fra v1.050 — strukturen er ikke ændret.

### `medarbejdere` (NYT i v1.057)
```sql
id          uuid PRIMARY KEY
navn        text
sort_order  integer
aktiv       boolean
```
Bruges af medarbejder-vælger efter login. RLS: `authenticated only`.

### Views
- `lshop_full` — joiner products + variants + stock
- `stanley_full` — joiner products + variants

### RLS (v1.057)
- `medarbejdere`, `kunder`, `tilbud`, `dtf_configs`, `indstillinger` — kræver `authenticated`
- `lshop_*` og `stanley_*` — `anon read` (offentligt katalog senere)

**NB:** Hvis fremtidigt offentligt katalog kommer, skal write-policies på
katalog-tabellerne være service_role only.

---

## 6. Secrets og environment variables

### 6.1 GitHub Actions secrets
Sat i https://github.com/j-brixen-source/dtf-tilbud/settings/secrets/actions —
bruges KUN af workflow-jobs (lshop-sync, stanley-sync).

| Secret | Brug |
|---|---|
| `LSHOP_FTP_HOST` | edi.l-shop-team.net |
| `LSHOP_FTP_USER` | FTP brugernavn |
| `LSHOP_FTP_PASS` | FTP kodeord |
| `LSHOP_FTP_PORT` | typisk 21 |
| `SUPABASE_URL` | **PLAIN URL — IKKE med /rest/v1/ suffix!** Det var en bug tidligere. |
| `SUPABASE_ANON_KEY` | anon-nøglen fra Supabase project settings |
| `SS_USER` | Stanley Stella email (info@tekstil-tryk.dk) |
| `SS_PASSWORD` | Stanley Stella kodeord |

### 6.2 Netlify environment variables (NYT i v1.059)
Sat i https://app.netlify.com/projects/aquamarine-liger-acf01f/configuration/env —
bruges KUN af Netlify Functions (parse-email).

| Env var | Scope | Secret? | Brug |
|---|---|---|---|
| `ANTHROPIC_KEY` | Functions | ✓ | Til AI email-parsing via /api/parse-email |

**Vigtigt:** GitHub secrets og Netlify env vars er to forskellige systemer.
GitHub Actions kan IKKE læse Netlify env vars og omvendt. Læg hver secret hvor
den faktisk bruges.

---

## 7. Vigtige tekniske detaljer / gotchas

### `let garments` problemet (LØST i v1.052)
v1.050's `index.html` deklarerer `let garments = []` inde i et `<script>`-tag.
Den variabel kan **IKKE** ses fra eksternt JS (lshop-supabase.js).

**Løsning brugt:** Script-injection trick — lshop-supabase.js opretter et
nyt `<script>`-tag i DOM'en med kode der kører i samme global scope og kan
mutere `garments` direkte:

```js
const inj = document.createElement('script');
inj.textContent = `
  if (typeof garments !== 'undefined') {
    const _before = garments.filter(g => g.source !== 'L-shop');
    garments.length = 0;
    garments.push(..._before, ...window.__lshopPendingGarments);
  }
`;
document.head.appendChild(inj);
document.head.removeChild(inj);
```

Plus `var garments` (i stedet for `let`) gør den til property på window
hvilket er hjælpsomt for backwards compat.

### PostgREST 1000-rækker grænse
Supabase's PostgREST API returnerer **maksimalt 1000 rækker pr. SELECT**.
Med 174k variants skal du paginere via `.range(from, from + 999)`. Funktionen
`fetchAllRows()` i lshop-supabase.js håndterer dette.

### Stanley Stella API format (vigtigt!)
SS API bruger JSON-RPC 2.0, IKKE REST. Korrekt payload-format:
```json
{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "db_name": "production_api",
    "user": "...",
    "password": "...",
    "LanguageCode": "en_GB",
    "Published": true
  }
}
```
Forkert format giver fejlteksten `"JSON param empty error"` i `result`.

Endpoints brugt:
- `/webrequest/color/get_json` — farve-katalog (567 farver)
- `/webrequest/products/get_prices` — variant-niveau priser (~9.923 records)
- `/webrequest/products/get_json` — variant-data
- `/webrequest/productsV2/get_json` — style-niveau metadata

### CSV format L-shop
- Fil: `stockfile.csv` på FTP — UTF-8 BOM, semicolon-separeret
- Kolonner: `article;stock;catalog`
- Format-bemærkning: BOM skal strippes med `csv.replace(/^\uFEFF/, '')`
- Manuel artikel/major-CSV: 80-107 kolonner, semicolon, dansk komma som decimal

### Cache-busting
`<script src="lshop-supabase.js?v=8">` — bump tallet hver gang lshop-supabase.js
ændres så browsere ikke serverer cachet gammel version.

### EUR/DKK kurs
Stanley Stella priser gemmes i EUR i Supabase (`ek_price_eur`). UI har et
input-felt med default 7.50 — appen omregner ved load. Ændring af kurs
trigger re-load af SS data. Kursen persisteres i localStorage som `tetos_eur_dkk`
siden v1.065.

### Variant-pris i tilbudsberegning
Hver garment-objekt har `variantPrices: { sku: {color, size, ek_price, stock_qty} }`.
Funktionen `getVariantSalePrice(gl, size)` slår op på (selectedColor, size)
for at finde præcis pris pr. variant. Hvis ingen variant-data findes,
falder den tilbage til `gl.salePrice` (gennemsnit/min-pris).

### L-shop billed-URL'er (v1.056)
Formatet er `{CatalogNr}_{ColorName}.jpg` med bindestreger for spaces:
- `AQ001_Black.jpg`
- `JC003_Charcoal-(Solid)_Jet-Black.jpg`

Filerne hostes på `https://tetos-images.netlify.app/` (flat i roden).
PictureName findes i `lshop_products.color_picture_map` og `lshop_variants.picture_name`.

Smart fallback i `buildLineImageHTML()`:
1. `tetos-images.netlify.app/{PictureName}` — variant-specifik
2. `tetos-images.netlify.app/{CatalogNr}.jpg` — hovedbillede uden farve
3. "Billede ikke fundet"

L-shop's egne shop-URL'er (shop.l-shop-team.dk) er bevaret som fallback men
kræver login og virker derfor ikke for end-users.

### SS billed-URL'er
Stanley Stella's egen Cloudinary CDN:
```
https://res.cloudinary.com/www-stanleystella-com/t_pim/TechnicalNames/P{F|B}M0_{styleCode}_{colorCode}.jpg
```
F=Front, B=Back. `colorCode` er fx "C153" og findes i `stanley_variants.color_code`.

`window.ssColorCodes` (ColorName→ColorCode mapping) genopbygges fra Supabase
variants når `loadStanleyFromSupabase()` kører.

### AI email-parsing via Netlify-function (v1.059+)
Klienten kalder `/api/parse-email` (alias for `/.netlify/functions/parse-email`),
**ikke** Anthropic-API'en direkte. Hele flowet:

1. Bruger indsætter email i `<textarea id="emailInput">`, klikker "Læs email med AI"
2. `readEmail()` filtrerer garments-listen med stopwords-baseret søgning og
   bygger en `garmentList`-string
3. POST til `/api/parse-email` med body `{ email, garmentList }`
4. Function (`netlify/functions/parse-email.js`) bygger system prompt + kalder
   `https://api.anthropic.com/v1/messages` med modellen `claude-sonnet-4-6`
5. Function parser AI-svar (stripper evt. ```json fences) og returnerer JSON
6. Klient post-processerer JSON ind i `garmentLinesData`

Prompten lever **server-side** i parse-email.js — tweaks sker der, ikke i
index.html. ANTHROPIC_KEY ligger som Netlify env var (scope: Functions, secret).
Klienten har INGEN API-nøgle længere — det fjerner CORS/dangerous-direct-browser-access
problemer. `/api/*` redirect-regel i `netlify.toml`.

### Brand/Model/Farve søgefelter (v1.061)
Inline søge-input ved siden af label, mønstret er ens for alle tre:
```html
<div class="field-label-with-search">
  <span>Label</span>
  <input class="field-search-mini" placeholder="🔍 søg..."
    oninput="searchXxxInline(i, this.value)">
</div>
```

Funktionerne er `searchBrandInline`, `searchModelInline`, `searchColorInline`.
Auto-vælger ved præcis 1 match. Ved 0/flere matches: opdatér KUN den enkelte
linjes `<select>.innerHTML` (Safari ignorerer `display:none` på `<option>`,
så options skal rebuildes for pålidelig filtering — IKKE bruge full
`renderGarmentLines()` ved hver keystroke pga. fokus-tab).

State pr. tøjlinje: `gl.brandSearch`, `gl.modelSearch` på `garmentLinesData[i]`.

### Stock-cap på antal-input (v1.063)
Indtastning i størrelse-felter går gennem `setSizeQty(lineIdx, size, val)` som:
1. Hvis `qty > stock` (når stock kendes) → cap til stock + alert + re-render
2. Ellers → light update via `updateLineTotals(lineIdx)` (bevarer fokus)

`<input type="number" max="${stock}">` får browser-spinneren til at respektere
loftet ved klik.

### Farveskift-validering (v1.062 + v1.063)
`selectColor()` bevarer `sizeQtys` og bruger forskellige strategier ved farveskift:

| Status i ny farve | Adfærd |
|---|---|
| Størrelsen findes ikke | Drop antal + warn ("findes ikke") |
| Stock = 0 | Drop antal + warn ("udsolgt") |
| 0 < stock < ønsket | Cap til stock + warn ("ikke nok på lager") |
| Stock ≥ ønsket | Behold antal, ingen warn |
| Ingen stock-data overhovedet | Behold antal, ingen warn |

Pop-up grupperer alle tre kategorier i én besked.

### Settings-persistens (v1.065)
15 inputs i Indstillinger gemmes i localStorage med prefix `tetos_`:
- Markup: `tetos_mu_low`, `tetos_mu_mid`, `tetos_mu_high`
- Trykpriser: `tetos_p_front_small/large/xl`, `tetos_p_back_*`, `tetos_p_sleeve_l_small`, `tetos_p_sleeve_r_small`
- Setup/rabat: `tetos_setup_fee`, `tetos_disc_per_unit`, `tetos_disc_max`
- Valuta: `tetos_eur_dkk`

Helpers: `persistInput(el)` (skriver) + `loadPersistedSettings()` (læser ved
init før `recalc()`). Per-bruger/per-browser — ikke synced på tværs af enheder.
Hvis multi-device sync ønskes senere, flyt til Supabase `indstillinger`-tabel.

Produktionstid-felter har egen localStorage-konvention (uden tetos_ prefix)
fra v1.050 — det er bevidst ikke unified.

### Dansk talformat (v1.065)
Hjælpere defineret tidligt i scriptet:
```js
function fmtNum(amount) {  // "1234.5" → "1.234,50"
  return Number(amount).toLocaleString('da-DK', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
function fmtKr(amount)  { return fmtNum(amount) + ' kr'; }
```

Bruges OVERALT hvor monetære værdier vises (skærm + PDF). Brug ALDRIG
`.toFixed(2) + ' kr'` direkte — det giver engelsk format. Eneste undtagelse:
rabat-procentsatser bruger `discPct.toFixed(2).replace('.', ',')` historisk
og er korrekte (intet tusind-separator behov for %).

### Logo (v1.064)
`TETOS_LOGO.png` ligger i repo-roden, serveres af Netlify som `/TETOS_LOGO.png`.
Filen er teknisk JPEG (med .png-extension). Den har mørk baggrund — designet
til mørke flader. Bruges to steder:
- Header (mørk): `<img class="header-logo-img" src="/TETOS_LOGO.png">` 32px høj
- Login-overlay: placeret OVER det hvide kort på den mørke #1a1a1a baggrund
  (ikke INDE i kortet — det ville give sort kasse på hvidt)

### Startside (v1.061)
Siden v1.061 er default-panel `panel-quote` (Nyt tilbud), ikke `panel-settings`.
Init-flow: efter `onAuthSuccess` → `loadMedarbejdere()` → `showPanel('quote')`
så `renderGarmentLines()` + `recalc()` køres når panelet vises første gang.

---

## 8. Versionshistorik

| Version | Dato | Vigtigste ændringer |
|---|---|---|
| **v1.065** | 2026-04-28 | Settings-persistens (localStorage) + dansk talformat (`fmtKr`/`fmtNum`) |
| v1.064 | 2026-04-28 | TETOS-logo i header + login-skærm |
| v1.063 | 2026-04-28 | Stock-cap på antal-input + udvidet farveskift-validering |
| v1.062 | 2026-04-28 | Bevar antal ved farveskift + udsolgt-advarsel |
| v1.061 | 2026-04-28 | Brand/Model søgefelter + ny startside (Nyt tilbud) |
| v1.060 | 2026-04-28 | Cleanup: fjern resterende anthropic_key-rester |
| v1.059 | 2026-04-28 | Lag 2: Anthropic API-nøgle flyttet server-side til Netlify Function |
| v1.058 | 2026-04-28 | Ryddet UI på Indstillinger og API-adgange |
| v1.057 | 2026-04-28 | Lag 1: Login (Supabase Auth) + medarbejder-vælger |
| v1.056 | 2026-04-27 | L-shop billeder fra dedikeret tetos-images.netlify.app |
| v1.055 | 2026-04-27 | L-shop billeder fra lokal /public/ (overhalet af 1.056) |
| v1.054 | 2026-04-27 | Fix: SS billeder + L-shop lager-badges |
| v1.053 | 2026-04-27 | Stanley Stella server-side auto-sync, login-felter fjernet |
| v1.052 | 2026-04-27 | Omdøbt til TETOS, variant-priser for L-shop |
| v1.051 | 2026-04-27 | Auto-load fra Supabase, FTP-sync repareret |
| v1.050 | 2026-04 (baseline) | Manuel CSV-upload, SS API login, kunder/tilbud, AI email-parsing |

---

## 9. Pågående/planlagte opgaver

### Prioritet HØJ (under aktiv overvejelse)
1. **PDF-billeder i tilbud + ordreseddel** (planned: v1.066)
   - Lille produktbillede mellem "Produkt" og "SKU" kolonne
   - Async pre-load af alle billeder før `doc.autoTable` kører
   - HTMLImageElement med `crossOrigin="anonymous"` + canvas → dataURL
   - `didDrawCell`-hook på autoTable kalder `doc.addImage()`
   - Skal også gælde ordreseddel-PDF
   - CORS-test: tetos-images.netlify.app + Cloudinary forventes at virke
     med default headers; fall back gracefully hvis ikke

2. **Pre-rendered catalog.json** (forberedelse til offentligt katalog)
   - I stedet for at hver bruger henter 184k rækker fra Supabase ved sidestart,
     byg én statisk JSON-fil (~7 MB gzipped) via GitHub Actions
   - Strategi A: alt i én fil, hentes ved sidestart, browser-cacher
   - Workflow trigger: `workflow_run` efter lshop-sync og stanley-sync
   - Skriv til `public/catalog.json` + `public/catalog-manifest.json`
   - netlify.toml redirects: `/catalog.json` → `/public/catalog.json`
   - App ændring: `loadCatalogFromCDN(url)` erstatter Supabase-load
   - **Hvorfor**: skalerbarhed til offentligt katalog (kunder browser med søg)

3. **Tøjliste søg/filter** (planned: v1.067)
   - Søgning + filter-knapper på Tøjliste-fanen (svarer til
     Brand/Model-søg-mønstret fra v1.061)

4. **Variant-priser i PDF'er** — Tilbuds-PDF og ordreseddel-PDF viser stadig
   `cl.salePrice` (gennemsnit). Bør opdeles pr. størrelse ligesom skærmen.

### Prioritet MEDIUM
5. **Public katalog-side** — Tøjlisten transformeres til kundekatalog med
   søgning, filter, salgspriser. Kræver pre-rendered JSON først (#2).

6. **Multi-device sync af settings** — Flyt `tetos_*`-keys fra localStorage
   til Supabase `indstillinger` så Mac og PC viser samme markup-faktorer.

7. **Stale data cleanup** — Sync-workflows upserter men sletter ikke gamle
   rækker. Kan tilføjes som DELETE WHERE NOT IN (...).

### Prioritet LAV
8. **Node.js 20 deprecation** — actions/checkout@v4 og actions/setup-node@v4
   kører på Node 20 som deprecates september 2026. Opdater til v5 før da.

9. **API-key rotation** — Den ANTHROPIC_KEY der blev sat i Netlify under
   v1.059-deploy bør roteres engang (delvist eksponeret i screenshot under
   setup). Tag ny på console.anthropic.com → opdatér Netlify env var → revoke
   gamle. 2 minutters arbejde.

---

## 10. Workflows fra dag-til-dag

### Daglig drift (automatisk, intet input nødvendigt)
- Stock synces 4× dagligt (00:00, 06:00, 12:00, 18:00 UTC)
- Stanley Stella synces 1× dagligt (05:00 UTC = 06:00 CET)
- Brugere åbner app, login → vælg medarbejder → lander på "Nyt tilbud"
- Data loader fra Supabase ved sidestart

### Når L-shop sender ny prisliste (~årligt)
1. Pak CSV ZIP ud lokalt
2. Åbn app, gå til "Tøjliste fra leverandør" (Indstillinger → Avanceret)
3. Træk **artikelfil + Major-fil** (ZIP) ind på drag-and-drop
4. Klik **💾 Upload årlig opdatering** — gemmer permanent i Supabase
5. (Også upload nye billeder til tetos-images.netlify.app via drop-siden)

### Når SS skifter login eller kursen ændres
- SS login: opdatér GitHub secrets `SS_USER` og `SS_PASSWORD`
- EUR/DKK kurs: ændres direkte i UI (input-felt), default 7.50 — gemmes
  i localStorage siden v1.065

### Når ANTHROPIC_KEY skal opdateres
- Netlify dashboard → Site settings → Environment variables
- Path: https://app.netlify.com/projects/aquamarine-liger-acf01f/configuration/env
- Scope skal være "Functions", marker som secret
- Næste `/api/parse-email`-kald bruger den nye nøgle automatisk (ingen redeploy)

### Hvis ny chat med Claude
- Claude læser denne fil først
- Live URL: https://aquamarine-liger-acf01f.netlify.app
- Test/diagnose: brug Supabase SQL Editor til at verificere data,
  Netlify MCP til at verificere deploys, web_fetch på live URL
- Versionsbump: stigende `v1.0XX` i title, header-tag, og kommentar-header

---

## 11. Filer i repo-roden lige nu

```
dtf-tilbud/
├── .github/
│   └── workflows/
│       ├── lshop-sync.yml           # 4×/dag FTP→Supabase
│       └── stanley-sync.yml         # 1×/dag SS API→Supabase
├── netlify/
│   └── functions/
│       ├── cvr.js                   # CVR-opslag proxy
│       └── parse-email.js           # AI email-parsing (v1.059+)
├── index.html                       # Hele app'en
├── lshop-supabase.js                # Supabase loader bibliotek
├── netlify.toml                     # Netlify config + /api/* redirect
├── TETOS_LOGO.png                   # Logo (v1.064+)
├── ss-diagnostik.html               # Standalone SS API diagnostik-side
├── CLAUDE.md                        # Dette dokument
└── README.md                        # (valgfri, kan suppleres)
```

---

## 12. Kontakt / ejer

- **Jakob Brixen**, Tekstil-tryk.dk
- Email: info@tekstil-tryk.dk
- Lokation: Skanderborg, DK
- Bruger: macOS (Safari + Chrome), nogle gange PC

---

## 13. Til en fremtidig AI-assistent

Læs denne fil grundigt før du foreslår ændringer. Mange gotchas er allerede
løst — særligt `let garments`-scope-problemet, SS API JSON-RPC-formatet, og
PostgREST 1000-rækkers paginering. Hvis noget skal udvides, **byg ovenpå
eksisterende mønstre** i stedet for at genopfinde.

**Mønstre der allerede findes i kodebasen — genbrug dem:**
- Inline søgefelt + auto-select: se `searchColorInline`/`searchBrandInline`/`searchModelInline`
- Settings-persistens: tilføj key til `PERSISTED_SETTING_IDS` + sæt
  `onchange="persistInput(this)"` på input — det er det
- Dansk talformat: brug `fmtKr(x)` og `fmtNum(x)`. ALDRIG `.toFixed(2) + ' kr'`
- Server-side API-kald: følg mønstret i `netlify/functions/parse-email.js`,
  inkl. `/api/*`-redirect i `netlify.toml`
- Supabase-load: brug `fetchAllRows()` fra lshop-supabase.js til paginering
- Pop-up advarsler: brug `setTimeout(() => alert(msg), 50)` så DOM er
  færdig-rendret først

**Principper Jakob foretrækker:**
- Tag små skridt, deploy ofte, bekræft hvert step før det næste
- Versionsbump (v1.0XX → v1.0XY) ved enhver substantiel ændring
- Skriv ændring i kommentar-header øverst i `index.html` så historikken bevares
- Brug Netlify-MCP til at verificere deploys (ikke gæt)
- Brug Supabase SQL Editor til at verificere data (ikke antag)
- Lever én fil ad gangen så hvert skridt kan testes
- Spørg Jakob om bekræftelse på problem-beskrivelse + UX-valg før du koder
- Når der er flere fortolkninger af et ønske: præsentér dem klart og lad
  Jakob vælge

**Hvis chat starter med en specifik bug eller feature-anmodning:**
1. Læs CLAUDE.md (denne fil) først
2. Bekræft hvilken version der kører live (web_fetch URL eller Netlify MCP)
3. Re-clone repoet for frisk state — Jakob uploader filer via GitHub web UI
   så den lokale arbejdskopi i agentens hukommelse kan være forældet
4. Spørg Jakob om bekræftelse på problem-beskrivelse før du koder
5. Foreslå mindste mulige ændring der løser problemet
6. Lever én fil ad gangen så hvert skridt kan testes

**Deploy-flow:**
- Repo'et er auto-deploy fra GitHub `main` branch til Netlify
- Jakob commiter via GitHub web UI ("Add file → Upload files" eller
  pencil-edit på enkelte filer)
- Netlify trigger deploy automatisk (~30-60 sek)
- Du verificerer via `Netlify:netlify-project-services-reader` MCP at
  deploy er "ready" + at relevante functions er i `available_functions`
- Direkte deploy via `netlify-deploy-services-updater` MCP er mulig men
  bryder Jakob's git-historik — brug kun hvis han eksplicit beder om det

**Hvis i tvivl om noget eksisterende:**
- Repo er public — du kan læse alle filer på github.com/j-brixen-source/dtf-tilbud
- Live HTML kan inspiceres via web_fetch på live URL (men obs: web_fetch
  cacher aggressivt — hvis du lige har deployet, så accepter at MCP-en
  siger sandheden om deploy-state)
- Hvis ikke det giver svar, spørg Jakob — han har fuld overblik
