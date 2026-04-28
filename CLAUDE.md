# TETOS — Tekstil-tryk.dk Ordre System

> **Aktuel version:** v1.056 (april 2026)
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
  ordredetaljer (mængder, størrelser, farver, tryk-positioner)

App'en er **enkeltbruger** lige nu (Jakob), men er bygget med tanke på
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

### Netlify site IDs
- **Hovedapp**: `f00a8b1e-e61d-434f-80e6-7f159651f68c` (aquamarine-liger-acf01f)
- **Billeder**: `c43da7b4-ea15-4586-8959-59fa6d3069ca` (tetos-images)

---

## 3. Arkitektur

```
┌──────────────────────────────────────────────────────────┐
│  BRUGER (browser, fx Mac/Chrome)                        │
└──────────────────────────────────────────────────────────┘
                  │  HTTPS
                  ▼
┌──────────────────────────────────────────────────────────┐
│  HOVEDAPP — aquamarine-liger-acf01f.netlify.app         │
│  Static HTML/CSS/JS — Netlify CDN                        │
│  • index.html (~190 KB)                                  │
│  • lshop-supabase.js (~28 KB)                            │
│  • netlify/functions/ (kun til AI email-parsing)         │
└──────────────────────────────────────────────────────────┘
       │                     │                       │
       ▼                     ▼                       ▼
  ┌─────────┐         ┌────────────┐          ┌──────────┐
  │Supabase │         │ tetos-     │          │ Anthropic│
  │Postgres │         │ images.    │          │ API      │
  │         │         │ netlify    │          │ (Claude) │
  │ Tables: │         │ .app       │          │          │
  │ lshop_* │         │            │          │ Email    │
  │ stanley_*         │ ~40k JPG'er│          │ parsing  │
  │ kunder  │         │ Web-       │          │          │
  │ tilbud  │         │ optimized  │          │          │
  └─────────┘         │ 208x268 px │          └──────────┘
       ▲              └────────────┘
       │                     ▲
       │                     │ (manuel upload 1×/år
       │                     │  via Netlify Drop)
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
| `index.html` | ~190 KB | Hele app'en (HTML+CSS+JS i én fil) |
| `lshop-supabase.js` | ~28 KB | Bibliotek: Supabase load + årlig CSV upload |
| `netlify.toml` | <1 KB | Netlify config |
| `netlify/functions/` | — | Edge-funktioner (AI email-parsing) |
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

### Views
- `lshop_full` — joiner products + variants + stock
- `stanley_full` — joiner products + variants

### RLS
Alle tabeller har `anon read+write` policies — passer til den simple
single-user model. **NB:** Hvis fremtidigt offentligt katalog kommer,
skal write-policies strammes op (kun service_role).

---

## 6. GitHub Actions secrets

Sat i https://github.com/j-brixen-source/dtf-tilbud/settings/secrets/actions:

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
trigger re-load af SS data.

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

---

## 8. Versionshistorik

| Version | Dato | Vigtigste ændringer |
|---|---|---|
| **v1.056** | 2026-04-27 | L-shop billeder fra dedikeret tetos-images.netlify.app |
| v1.055 | 2026-04-27 | L-shop billeder fra lokal /public/ (overhalet af 1.056) |
| v1.054 | 2026-04-27 | Fix: SS billeder + L-shop lager-badges |
| v1.053 | 2026-04-27 | Stanley Stella server-side auto-sync, login-felter fjernet |
| v1.052 | 2026-04-27 | Omdøbt til TETOS, variant-priser for L-shop |
| v1.051 | 2026-04-27 | Auto-load fra Supabase, FTP-sync repareret |
| v1.050 | 2026-04 (baseline) | Manuel CSV-upload, SS API login, kunder/tilbud, AI email-parsing |

---

## 9. Pågående/planlagte opgaver

### Prioritet HØJ (under aktiv overvejelse)
1. **Pre-rendered catalog.json** — i stedet for at hver bruger henter 184k
   rækker fra Supabase ved sidestart, byg én statisk JSON-fil (~7 MB gzipped)
   via GitHub Actions. Vejledning til implementation:
   - Strategi A: alt i én fil, hentes ved sidestart, browser-cacher
   - Workflow trigger: `workflow_run` efter lshop-sync og stanley-sync
   - Skriv til `public/catalog.json` + `public/catalog-manifest.json`
   - netlify.toml redirects: `/catalog.json` → `/public/catalog.json`
   - App ændring: `loadCatalogFromCDN(url)` erstatter Supabase-load
   - **Hvorfor**: skalerbarhed til offentligt katalog (kunder browser med søg)

2. **Variant-priser i PDF'er** — Tilbuds-PDF og ordreseddel-PDF viser stadig
   `cl.salePrice` (gennemsnit). Bør opdeles pr. størrelse ligesom skærmen.

### Prioritet MEDIUM
3. **Public katalog-side** — Tøjlisten transformeres til kundekatalog med
   søgning, filter, salgspriser. Kræver pre-rendered JSON først (#1).
4. **Stale data cleanup** — Sync-workflows upserter men sletter ikke gamle
   rækker. Kan tilføjes som DELETE WHERE NOT IN (...).

### Prioritet LAV
5. **Node.js 20 deprecation** — actions/checkout@v4 og actions/setup-node@v4
   kører på Node 20 som deprecates september 2026. Opdater til v5 før da.
6. **Slet `dtf-netlify-v1.052` ZIP** fra repo-roden (gammel artifact).

---

## 10. Workflows fra dag-til-dag

### Daglig drift (automatisk, intet input nødvendigt)
- Stock synces 4× dagligt (00:00, 06:00, 12:00, 18:00 UTC)
- Stanley Stella synces 1× dagligt (05:00 UTC = 06:00 CET)
- Brugere åbner app, data loader fra Supabase ved sidestart

### Når L-shop sender ny prisliste (~årligt)
1. Pak CSV ZIP ud lokalt
2. Åbn app, gå til "Tøjliste fra leverandør"
3. Træk **artikelfil + Major-fil** (ZIP) ind på drag-and-drop
4. Klik **💾 Upload årlig opdatering** — gemmer permanent i Supabase
5. (Også upload nye billeder til tetos-images.netlify.app via drop-siden)

### Når SS skifter login eller kursen ændres
- SS login: opdatér GitHub secrets `SS_USER` og `SS_PASSWORD`
- EUR/DKK kurs: ændres direkte i UI (input-felt), default 7.50

### Hvis ny chat med Claude
- Claude læser denne fil først
- Live URL: https://aquamarine-liger-acf01f.netlify.app
- Test/diagnose: brug Supabase SQL Editor til at verificere data
- Versionsbump: stigende `v1.05X` i title, header-tag, og kommentar-header

---

## 11. Filer i repo-roden lige nu

```
dtf-tilbud/
├── .github/
│   └── workflows/
│       ├── lshop-sync.yml           # 4×/dag FTP→Supabase
│       └── stanley-sync.yml         # 1×/dag SS API→Supabase
├── netlify/
│   └── functions/                   # Edge funcs til AI email-parsing
├── index.html                       # Hele app'en
├── lshop-supabase.js                # Supabase loader bibliotek
├── netlify.toml                     # Netlify config
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

**Principper Jakob foretrækker:**
- Tag små skridt, deploy ofte, bekræft hvert step før det næste
- Versionsbump (v1.05X → v1.05Y) ved enhver substantiel ændring
- Skriv ændring i kommentar-header øverst i `index.html` så historikken bevares
- Brug Netlify-MCP til at verificere deploys (ikke gæt)
- Brug Supabase SQL Editor til at verificere data (ikke antag)

**Hvis chat starter med en specifik bug eller feature-anmodning:**
1. Læs CLAUDE.md (denne fil) først
2. Bekræft hvilken version der kører live (web_fetch URL)
3. Spørg Jakob om bekræftelse på problem-beskrivelse før du koder
4. Foreslå mindste mulige ændring der løser problemet
5. Lever én fil ad gangen så hvert skridt kan testes

**Hvis i tvivl om noget eksisterende:**
- Repo er public — du kan læse alle filer på github.com/j-brixen-source/dtf-tilbud
- Live HTML kan inspiceres via web_fetch på live URL
- Hvis ikke det giver svar, spørg Jakob — han har fuld overblik
