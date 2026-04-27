/* =====================================================================
   lshop-supabase.js — DTF Tilbudsberegner
   Henter og gemmer L-shop katalog/varianter til Supabase.
   Bruges sammen med index.html (v1.060+).

   Indlæses i index.html med:
       <script src="lshop-supabase.js"></script>

   Forventer at globale variabler eksisterer:
       - getSB()              → returnerer Supabase-klient (fra index.html)
       - garments[]           → global array (fra index.html)
       - calcSalePrice(cp)    → funktion (fra index.html)
       - dbLog(label, data)   → log-funktion (fra index.html)
       - renderGarmentTable() → render-funktion (fra index.html)
       - renderGarmentLines() → render-funktion (fra index.html)
   ===================================================================== */

(function (global) {
  'use strict';

  // ─── Hjælpefunktioner ────────────────────────────────────────────────
  function parseDanishPrice(raw) {
    if (raw === null || raw === undefined) return 0;
    const cleaned = String(raw).trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function sortSizes(sizesSet) {
    const order = ['3XS','XXS','XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL','6XL','7XL','8XL'];
    return [...sizesSet].sort((a, b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
  }

  // PostgREST returnerer max 1000 rækker pr. kald.
  // Denne funktion paginerer gennem ALLE rækker via .range().
  async function fetchAllRows(sb, table, selectStr = '*', progressCb = null) {
    const PAGE = 1000;
    const all = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from(table)
        .select(selectStr)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (progressCb) progressCb(all.length);
      if (data.length < PAGE) break;  // sidste side
      from += PAGE;
    }
    return all;
  }


  // ─── 1. AUTO-LOAD: Hent katalog + varianter + lager fra Supabase ─────
  async function loadLshopFromSupabase(opts = {}) {
    const sb = global.getSB && global.getSB();
    if (!sb) { global.dbLog && global.dbLog('Lshop auto-load', 'Supabase ikke klar — springer over'); return false; }

    const status = document.getElementById('garmentStatus');
    if (status) status.innerHTML = '<span style="color:var(--muted);font-size:12px">⏳ Henter L-shop fra Supabase...</span>';

    try {
      // Hent alle tre tabeller med paginering (PostgREST max 1000 rækker pr. kald)
      if (status) status.innerHTML = '<span style="color:var(--muted);font-size:12px">⏳ Henter L-shop fra Supabase (kan tage 30-60 sek)...</span>';

      const products = await fetchAllRows(sb, 'lshop_products', '*',
        n => { if (status && n % 2000 === 0) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ Henter produkter... ${n}</span>`; });

      if (status) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ Henter ${products.length.toLocaleString()} produkter ✓ — Henter varianter...</span>`;
      const variants = await fetchAllRows(sb, 'lshop_variants', '*',
        n => { if (status && n % 10000 === 0) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ Henter varianter... ${n.toLocaleString()}/${products.length ? '~178k' : '?'}</span>`; });

      if (status) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ Henter varianter ✓ ${variants.length.toLocaleString()} — Henter lager...</span>`;
      const stock = await fetchAllRows(sb, 'lshop_stock', 'article_number, stock_qty, last_updated',
        n => { if (status && n % 20000 === 0) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ Henter lager... ${n.toLocaleString()}</span>`; });

      global.dbLog && global.dbLog('Supabase lshop hentet', {
        products: products.length, variants: variants.length, stock: stock.length
      });

      if (products.length === 0) {
        if (status) status.innerHTML = '<span style="color:var(--muted);font-size:12px">Intet L-shop katalog gemt — upload filer for at komme i gang</span>';
        return false;
      }

      // Index stock pr. article_number
      const stockMap = {};
      stock.forEach(s => { stockMap[s.article_number] = s.stock_qty || 0; });

      // Index varianter pr. catalog_nr
      const variantsByCatalog = {};
      variants.forEach(v => {
        if (!variantsByCatalog[v.catalog_nr]) variantsByCatalog[v.catalog_nr] = [];
        variantsByCatalog[v.catalog_nr].push(v);
      });

      // Byg garments[]
      const newGarments = products.map(p => {
        const vs = variantsByCatalog[p.sku] || [];

        // variantPrices: { article_number: { color, size, ek_price, stock_qty } }
        const variantPrices = {};
        const colorStockMap = {};        // farve → total stock for den farve
        const colorSizeStockMap = {};    // farve → { størrelse → stock }
        let totalStock = 0;
        let minEk = Infinity, maxEk = 0;

        vs.forEach(v => {
          const stockQty = stockMap[v.article_number] || 0;
          totalStock += stockQty;
          const ek = parseFloat(v.ek_price) || 0;
          if (ek > 0) {
            if (ek < minEk) minEk = ek;
            if (ek > maxEk) maxEk = ek;
          }
          variantPrices[v.article_number] = {
            color:    v.color || '',
            size:     v.size  || '',
            ek_price: ek,
            stock_qty: stockQty
          };
          // Lager pr. (farve, størrelse) — bruges i UI
          if (v.color) {
            colorStockMap[v.color] = (colorStockMap[v.color] || 0) + stockQty;
            if (!colorSizeStockMap[v.color]) colorSizeStockMap[v.color] = {};
            if (v.size) colorSizeStockMap[v.color][v.size] = stockQty;
          }
        });

        if (minEk === Infinity) minEk = 0;
        const cp = minEk;  // Bagudkompatibel: brug min-pris som costPrice for nu

        return {
          name:       p.name || p.sku,
          sku:        p.sku,
          brand:      p.brand || '',
          searchText: p.search_text || (p.name + ' ' + p.sku + ' ' + (p.brand || '')).toLowerCase(),
          productType: p.product_type || '',
          costPrice:  cp,
          costPriceMin: minEk,
          costPriceMax: maxEk,
          salePrice:  global.calcSalePrice ? global.calcSalePrice(cp) : cp,
          fromSS:     false,
          source:     'L-shop',
          colors:           p.colors            || [],
          sizes:            p.sizes             || [],
          colorSizeMap:     p.color_size_map    || {},
          colorHexMap:      p.color_hex_map     || {},
          colorPictureMap:  p.color_picture_map || {},
          colorStockMap,           // NYT: total stock pr. farve
          colorSizeStockMap,       // NYT: stock pr. (farve, størrelse) - bruges af UI
          colorStr: (p.colors || []).join(', '),
          sizeStr:  (p.sizes  || []).join(', '),
          variantPrices,
          totalStock,
          stockUpdated: stock.length > 0 ? stock[0].last_updated : null
        };
      });

      // ────────────────────────────────────────────────────────────────
      // KRITISK: Opdatér garments på den måde v1.050 selv gør det.
      // v1.050 deklarerer 'let garments' inde i samme <script>-tag som
      // alle dens funktioner — så variablen er kun synlig fra dén closure.
      // Vi kan IKKE skrive direkte til den fra et eksternt script.
      //
      // I stedet bruger vi en lille trick: vi finder og kalder den same
      // mekanisme som handleFile() bruger til at sætte garments. Det er
      // funktionen 'processRows' eller direkte assignment via en proxy.
      //
      // Den bedste måde er at injicere vores data via det samme flow som
      // CSV-uploaden bruger. Vi simulerer at v1.050 lige har parset rows.
      // ────────────────────────────────────────────────────────────────

      const updated = newGarments;

      // Forsøg 1: Brug eksposed setter (hvis index.html har var garments + setter)
      let success = false;
      if (typeof global.__setGarments === 'function') {
        try {
          const before = (global.__getGarments ? global.__getGarments() : []).filter(g => g.source !== 'L-shop');
          global.__setGarments([...before, ...newGarments]);
          const after = global.__getGarments ? global.__getGarments() : [];
          if (after.length >= newGarments.length) success = true;
        } catch (e) { /* fortsæt */ }
      }

      // Forsøg 2: Direct script injection — kør kode i v1.050's egen scope
      if (!success) {
        try {
          // Gem newGarments midlertidigt på window
          global.__lshopPendingGarments = newGarments;
          // Eksekvér kode som v1.050's eget script tag — det får adgang til 'garments'
          const injectedScript = document.createElement('script');
          injectedScript.textContent = `
            try {
              if (typeof garments !== 'undefined' && Array.isArray(window.__lshopPendingGarments)) {
                const _before = garments.filter(g => g.source !== 'L-shop');
                garments.length = 0;
                garments.push(..._before, ...window.__lshopPendingGarments);
                window.__lshopInjectionResult = garments.length;
              } else {
                window.__lshopInjectionResult = -1;  // garments ikke synlig
              }
            } catch(e) { window.__lshopInjectionResult = 'error: ' + e.message; }
          `;
          document.head.appendChild(injectedScript);
          document.head.removeChild(injectedScript);
          delete global.__lshopPendingGarments;
          if (typeof global.__lshopInjectionResult === 'number' && global.__lshopInjectionResult > 0) {
            success = true;
            global.dbLog && global.dbLog('Injection success', global.__lshopInjectionResult);
          } else {
            global.dbLog && global.dbLog('Injection result', global.__lshopInjectionResult);
          }
          delete global.__lshopInjectionResult;
        } catch (e) {
          global.dbLog && global.dbLog('Injection failed', e.message);
        }
      }

      // Forsøg 3: Sidste udvej — sæt window.garments
      if (!success) {
        global.garments = updated;
      }

      global.dbLog && global.dbLog('garments opdateret', {
        success: success,
        ny_størrelse_via_getter: global.__getGarments ? global.__getGarments().length : 'no_getter',
        window_garments: global.garments ? global.garments.length : 'undefined'
      });

      global.dbLog && global.dbLog('L-shop garments bygget', {
        antal: newGarments.length, eksempel: newGarments[0]
      });

      // Vis status
      if (status) {
        const stockTime = stock.length ? new Date(stock[0].last_updated).toLocaleString('da-DK', {dateStyle:'short', timeStyle:'short'}) : 'aldrig';
        status.innerHTML = `<span class="tag tag-green">✓ ${newGarments.length} L-shop produkter fra Supabase</span> <span style="font-size:11px;color:var(--muted)">Lager opdateret ${stockTime}</span>`;
      }

      // Re-render
      if (global.renderGarmentTable) global.renderGarmentTable();
      if (global.renderGarmentLines) global.renderGarmentLines();

      return true;
    } catch (err) {
      global.dbLog && global.dbLog('Lshop auto-load fejl', err.message);
      if (status) status.innerHTML = `<span class="tag tag-red">Auto-load fejl: ${err.message}</span>`;
      return false;
    }
  }

  // ─── 2. BUILD RECORDS: Konvertér uploadede CSV-rækker til DB-poster ──
  // Forventer:
  //   artikelRows: array af objects fra artikelfilen (har Description, color1-4, hexcol1-4, Size, Brand, ArticleNr, CatalogNr, PictureName, etc.)
  //   priceMap: { ArticleNr: ek_price } — fra Major-filen pr. variant
  //
  // Returnerer: { products: [...], variants: [...] }
  function buildRecordsFromRows(artikelRows, priceMap) {
    const productsMap = {};   // catalog_nr → aggregated product
    const variants    = [];   // Pr. ArticleNr

    artikelRows.forEach(r => {
      const articleNr = String(r.ArticleNr || '').trim();
      const sku       = String(r.CatalogNr || '').trim();
      if (!articleNr || !sku) return;
      if (String(r.Discontinued || '').trim() === '1') return;

      const ek = priceMap[articleNr];
      if (ek === undefined || ek === null) return;  // Spring varianter uden pris over

      // Find primær farve (color1) og tilhørende hex
      const color = String(r.color1 || '').trim();
      const size  = String(r.Size   || '').trim();
      let hex     = String(r.hexcol1 || '').trim();
      if (hex) {
        if (hex.length < 6) hex = hex.padStart(6, '0');
        hex = '#' + hex.toUpperCase();
      }

      // Variant-record
      variants.push({
        article_number: articleNr,
        catalog_nr:     sku,
        color:          color,
        size:           size,
        color_hex:      hex,
        picture_name:   String(r.PictureName || '').trim(),
        ek_price:       Number(ek.toFixed(2)),
        discontinued:   false
      });

      // Aggregér til product
      if (!productsMap[sku]) {
        productsMap[sku] = {
          sku:               sku,
          brand:             String(r.Brand || '').trim(),
          description:       String(r.Description || '').trim(),
          product_type:      String(r.SubCategory || r.MainCategory || '').trim(),
          _colorSizeMap:     {},   // til aggregering — fjernes før save
          _colorHexMap:      {},
          _colorPictureMap:  {}
        };
      }
      const p = productsMap[sku];
      if (color && size) {
        if (!p._colorSizeMap[color]) p._colorSizeMap[color] = new Set();
        p._colorSizeMap[color].add(size);
      }
      if (color && hex && !p._colorHexMap[color]) p._colorHexMap[color] = hex;
      const pic = String(r.PictureName || '').trim();
      if (color && pic && !p._colorPictureMap[color]) p._colorPictureMap[color] = pic;
    });

    // Fast struktur til product-records
    const products = Object.values(productsMap).map(p => {
      const colorSizeMap = {};
      Object.entries(p._colorSizeMap).forEach(([c, s]) => { colorSizeMap[c] = sortSizes(s); });
      const colors = Object.keys(colorSizeMap).sort();
      const allSizes = new Set();
      Object.values(colorSizeMap).forEach(arr => arr.forEach(s => allSizes.add(s)));
      const sizes = sortSizes(allSizes);
      const name = p.brand ? `${p.brand} – ${p.description || p.sku}` : (p.description || p.sku);

      return {
        sku:               p.sku,
        name:              name,
        brand:             p.brand,
        description:       p.description,
        product_type:      p.product_type,
        colors:            colors,
        sizes:             sizes,
        color_size_map:    colorSizeMap,
        color_hex_map:     p._colorHexMap,
        color_picture_map: p._colorPictureMap,
        search_text:       (name + ' ' + p.sku + ' ' + p.brand + ' ' + p.product_type).toLowerCase()
      };
    });

    return { products, variants };
  }

  // ─── 3. SAVE: Push records til Supabase ──────────────────────────────
  async function saveLshopToSupabase(products, variants, opts = {}) {
    const sb = global.getSB && global.getSB();
    if (!sb) throw new Error('Supabase ikke konfigureret');

    const status   = document.getElementById('garmentStatus');
    const setMsg   = (m) => { if (status) status.innerHTML = `<span style="color:var(--muted);font-size:12px">${m}</span>`; };
    const BATCH    = 500;

    // 1. Slet alt eksisterende (det er en fuld årlig opdatering)
    setMsg('🗑️ Rydder tidligere katalog i Supabase...');
    let { error: e1 } = await sb.from('lshop_variants').delete().neq('article_number', '___never___');
    if (e1) throw new Error('Delete variants: ' + e1.message);
    let { error: e2 } = await sb.from('lshop_products').delete().neq('sku', '___never___');
    if (e2) throw new Error('Delete products: ' + e2.message);

    // 2. Indsæt products (lille datasæt — én batch nok)
    setMsg(`💾 Gemmer ${products.length.toLocaleString()} produkter...`);
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      const { error } = await sb.from('lshop_products').insert(batch);
      if (error) throw new Error(`Products batch ${i}: ${error.message}`);
    }

    // 3. Indsæt variants (stort datasæt — mange batches)
    setMsg(`💾 Gemmer ${variants.length.toLocaleString()} varianter (0%)...`);
    for (let i = 0; i < variants.length; i += BATCH) {
      const batch = variants.slice(i, i + BATCH);
      const { error } = await sb.from('lshop_variants').insert(batch);
      if (error) throw new Error(`Variants batch ${i}: ${error.message}`);
      if (i % (BATCH * 10) === 0) {
        setMsg(`💾 Gemmer varianter... ${Math.round(i / variants.length * 100)}%`);
      }
    }

    if (status) status.innerHTML = `<span class="tag tag-green">✓ Gemt til Supabase: ${products.length} produkter, ${variants.length} varianter</span>`;
    global.dbLog && global.dbLog('Lshop gemt til Supabase', { products: products.length, variants: variants.length });

    return { products: products.length, variants: variants.length };
  }

  // ─── 4. PARSE-OG-GEM hjælper: Tager 2 fil-objekter og gør hele jobbet
  // files: array af File-objekter (artikelfil + Major-fil)
  // Returnerer: { products, variants } som blev gemt
  async function parseAndSaveLshopFiles(files) {
    if (!files || files.length < 2) {
      throw new Error('Forventer 2 CSV-filer (artikelfil + prisfil)');
    }

    const status = document.getElementById('garmentStatus');
    const setMsg = (m) => { if (status) status.innerHTML = `<span style="color:var(--muted);font-size:12px">${m}</span>`; };

    // Læs begge filer
    setMsg('📖 Læser CSV-filer...');
    const parsed = [];
    for (const f of files) {
      const content = await f.text();
      const stripped = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
      const lines = stripped.split(/\r?\n/).filter(l => l.trim());
      const sep = lines[0].includes(';') ? ';' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
      parsed.push({ name: f.name, headers, lines, sep });
    }

    // Identificér: Major-filen har EK + ArticleNr; artikelfilen har Description men IKKE EK
    const majorFil   = parsed.find(p => p.headers.includes('EK') && p.headers.includes('ArticleNr'));
    const artikelFil = parsed.find(p => p !== majorFil && p.headers.includes('Description'));
    if (!majorFil || !artikelFil) {
      throw new Error('Kunne ikke identificere artikelfil og Major-fil. Headers: ' + parsed.map(p => p.name + ': ' + p.headers.length + ' kolonner').join(' | '));
    }

    // Byg priceMap fra Major-filen: ArticleNr → EK
    setMsg('💰 Læser priser...');
    const idxArt   = majorFil.headers.indexOf('ArticleNr');
    const idxEk    = majorFil.headers.indexOf('EK');
    const priceMap = {};
    for (let i = 1; i < majorFil.lines.length; i++) {
      const vals = majorFil.lines[i].split(majorFil.sep);
      const a = (vals[idxArt] || '').trim().replace(/^"|"$/g, '');
      const e = parseDanishPrice(vals[idxEk]);
      if (a && e > 0) priceMap[a] = e;
    }

    // Læs artikelfilen som rows (objects)
    setMsg(`📋 Læser artikelfil (${artikelFil.lines.length.toLocaleString()} linjer)...`);
    const h = artikelFil.headers;
    const rows = [];
    for (let i = 1; i < artikelFil.lines.length; i++) {
      const vals = artikelFil.lines[i].split(artikelFil.sep);
      const obj = {};
      h.forEach((col, idx) => { obj[col] = (vals[idx] || '').trim().replace(/^"|"$/g, ''); });
      rows.push(obj);
    }

    // Build records
    setMsg('🏗️ Bygger records...');
    const { products, variants } = buildRecordsFromRows(rows, priceMap);
    global.dbLog && global.dbLog('Records bygget', {
      products: products.length, variants: variants.length, prices_uden_match: rows.length - variants.length
    });

    if (variants.length === 0) throw new Error('Ingen valide varianter — tjek at filerne matcher');

    // Save
    await saveLshopToSupabase(products, variants);

    // Re-load garments fra Supabase
    await loadLshopFromSupabase();

    return { products: products.length, variants: variants.length };
  }

  // ════════════════════════════════════════════════════════════════════
  // STANLEY STELLA — auto-load fra Supabase
  // ════════════════════════════════════════════════════════════════════

  async function loadStanleyFromSupabase() {
    const sb = global.getSB && global.getSB();
    if (!sb) { global.dbLog && global.dbLog('Stanley auto-load', 'Supabase ikke klar'); return false; }

    const status = document.getElementById('ssStatus');
    if (status) status.innerHTML = '<span style="color:var(--muted);font-size:12px">⏳ Henter Stanley Stella fra Supabase...</span>';

    try {
      const products = await fetchAllRows(sb, 'stanley_products', '*');
      if (status) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ ${products.length} styles ✓ — Henter varianter...</span>`;

      const variants = await fetchAllRows(sb, 'stanley_variants', '*',
        n => { if (status && n % 2000 === 0) status.innerHTML = `<span style="color:var(--muted);font-size:12px">⏳ Henter varianter... ${n.toLocaleString()}</span>`; });

      global.dbLog && global.dbLog('Supabase stanley hentet', {
        products: products.length, variants: variants.length
      });

      if (products.length === 0) {
        if (status) status.innerHTML = '<span style="color:var(--muted);font-size:12px">Intet Stanley Stella katalog i Supabase endnu</span>';
        return false;
      }

      // Index varianter pr. style
      const variantsByStyle = {};
      variants.forEach(v => {
        if (!variantsByStyle[v.style_code]) variantsByStyle[v.style_code] = [];
        variantsByStyle[v.style_code].push(v);
      });

      // Hent EUR/DKK kurs fra UI
      const eurDkk = parseFloat(document.getElementById('eur_dkk')?.value) || 7.50;

      // Byg global ssColorCodes (ColorName → ColorCode) til billed-URLs.
      // Bygges DIREKTE fra varianttabellen — det er den mest pålidelige kilde,
      // fordi color_code er gemt pr. variant af workflow'et.
      const ssColorCodes = {};
      variants.forEach(v => {
        if (v.color && v.color_code && !ssColorCodes[v.color]) {
          ssColorCodes[v.color] = v.color_code;
        }
      });
      global.ssColorCodes = ssColorCodes;
      global.dbLog && global.dbLog('SS colorCodes bygget til billed-URLs', {
        antal: Object.keys(ssColorCodes).length,
        fadedOlive_test: ssColorCodes['Faded Olive'] || '(IKKE FUNDET)',
        første10: Object.entries(ssColorCodes).slice(0, 10).map(([n, c]) => n + '=' + c)
      });

      // Byg garments[]
      const newGarments = products.map(p => {
        const vs = variantsByStyle[p.style_code] || [];

        // variantPrices: { sku: { color, size, ek_price (DKK), stock_qty } }
        const variantPrices = {};
        let totalStock = 0;
        let minEkDkk = Infinity, maxEkDkk = 0;

        vs.forEach(v => {
          const ekDkk = (parseFloat(v.ek_price_eur) || 0) * eurDkk;
          totalStock += v.stock_qty || 0;
          if (ekDkk > 0) {
            if (ekDkk < minEkDkk) minEkDkk = ekDkk;
            if (ekDkk > maxEkDkk) maxEkDkk = ekDkk;
          }
          variantPrices[v.sku] = {
            color:    v.color || '',
            size:     v.size  || '',
            ek_price: Number(ekDkk.toFixed(2)),
            stock_qty: v.stock_qty || 0
          };
        });

        if (minEkDkk === Infinity) minEkDkk = 0;
        const cp = minEkDkk;

        // Color stock map til UI (sum pr. farve)
        const colorStockMap = {};
        const colorSizeStockMap = {};
        vs.forEach(v => {
          if (!v.color) return;
          colorStockMap[v.color] = (colorStockMap[v.color] || 0) + (v.stock_qty || 0);
          if (!colorSizeStockMap[v.color]) colorSizeStockMap[v.color] = {};
          if (v.size) colorSizeStockMap[v.color][v.size] = v.stock_qty || 0;
        });

        return {
          name:       p.name || p.style_code,
          sku:        p.style_code,
          brand:      p.brand || 'Stanley Stella',
          searchText: p.search_text || (`stanley stella ${p.name} ${p.style_code}`).toLowerCase(),
          productType: p.product_type || '',
          costPrice:  Number(cp.toFixed(2)),
          costPriceMin: Number(minEkDkk.toFixed(2)),
          costPriceMax: Number(maxEkDkk.toFixed(2)),
          salePrice:  global.calcSalePrice ? global.calcSalePrice(cp) : cp,
          fromSS:     true,
          source:     'Stanley Stella',
          colors:     p.colors || [],
          sizes:      p.sizes  || [],
          colorSizeMap:    p.color_size_map || {},
          colorHexMap:     p.color_hex_map  || {},
          colorCodeMap:    p.color_code_map || {},
          colorStockMap,
          colorSizeStockMap,
          colorPictureMap: {},
          colorStr: (p.colors || []).join(', '),
          sizeStr:  (p.sizes  || []).join(', '),
          // Variant-pris (allerede konverteret til DKK)
          variantPrices,
          totalStock,
          stockUpdated: products[0]?.updated_at || null
        };
      });

      // Erstat SS-varer i garments-arrayet (bevar L-shop og CSV)
      // Bruger script-injection som L-shop også gør
      try {
        global.__stanleyPendingGarments = newGarments;
        const inj = document.createElement('script');
        inj.textContent = `
          try {
            if (typeof garments !== 'undefined' && Array.isArray(window.__stanleyPendingGarments)) {
              const _before = garments.filter(g => g.source !== 'Stanley Stella' && !g.fromSS);
              garments.length = 0;
              garments.push(..._before, ...window.__stanleyPendingGarments);
              window.__stanleyInjectionResult = garments.length;
            } else {
              window.__stanleyInjectionResult = -1;
            }
          } catch(e) { window.__stanleyInjectionResult = 'error: ' + e.message; }
        `;
        document.head.appendChild(inj);
        document.head.removeChild(inj);
        delete global.__stanleyPendingGarments;
        global.dbLog && global.dbLog('Stanley injection result', global.__stanleyInjectionResult);
        delete global.__stanleyInjectionResult;
      } catch (e) {
        global.dbLog && global.dbLog('Stanley injection failed', e.message);
      }

      // Status
      if (status) {
        const updated = products[0]?.updated_at ? new Date(products[0].updated_at).toLocaleString('da-DK', {dateStyle:'short', timeStyle:'short'}) : 'aldrig';
        status.innerHTML = `<span class="tag tag-green">✓ ${newGarments.length} Stanley Stella styles</span> <span style="font-size:11px;color:var(--muted)">Opdateret ${updated}</span>`;
      }

      // Re-render
      if (global.renderGarmentTable) global.renderGarmentTable();
      if (global.renderGarmentLines) global.renderGarmentLines();

      return true;
    } catch (err) {
      global.dbLog && global.dbLog('Stanley auto-load fejl', err.message);
      if (status) status.innerHTML = `<span class="tag tag-red">Auto-load fejl: ${err.message}</span>`;
      return false;
    }
  }

  // ─── Eksportér til global scope ──────────────────────────────────────
  global.lshopSupabase = {
    loadLshopFromSupabase,
    saveLshopToSupabase,
    buildRecordsFromRows,
    parseAndSaveLshopFiles,
    loadStanleyFromSupabase
  };

})(window);
