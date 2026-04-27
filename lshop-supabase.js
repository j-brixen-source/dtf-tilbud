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

  // ─── 1. AUTO-LOAD: Hent katalog + varianter + lager fra Supabase ─────
  async function loadLshopFromSupabase(opts = {}) {
    const sb = global.getSB && global.getSB();
    if (!sb) { global.dbLog && global.dbLog('Lshop auto-load', 'Supabase ikke klar — springer over'); return false; }

    const status = document.getElementById('garmentStatus');
    if (status) status.innerHTML = '<span style="color:var(--muted);font-size:12px">⏳ Henter L-shop fra Supabase...</span>';

    try {
      // Hent alle tre tabeller parallelt
      const [pRes, vRes, sRes] = await Promise.all([
        sb.from('lshop_products').select('*'),
        sb.from('lshop_variants').select('*'),
        sb.from('lshop_stock').select('article_number, stock_qty, last_updated')
      ]);

      if (pRes.error) throw new Error('lshop_products: ' + pRes.error.message);
      if (vRes.error) throw new Error('lshop_variants: ' + vRes.error.message);
      if (sRes.error) throw new Error('lshop_stock: '   + sRes.error.message);

      const products = pRes.data || [];
      const variants = vRes.data || [];
      const stock    = sRes.data || [];

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
          colorStr: (p.colors || []).join(', '),
          sizeStr:  (p.sizes  || []).join(', '),
          // NYE FELTER (variant-niveau):
          variantPrices,        // { articleNr: {color, size, ek_price, stock_qty} }
          totalStock,           // Sum af lager på alle varianter
          stockUpdated: stock.length > 0 ? stock[0].last_updated : null
        };
      });

      // Erstat L-shop varer i den globale garments-array (bevar SS og CSV)
      const before = (global.garments || []).filter(g => g.source !== 'L-shop');
      global.garments = [...before, ...newGarments];

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

  // ─── Eksportér til global scope ──────────────────────────────────────
  global.lshopSupabase = {
    loadLshopFromSupabase,
    saveLshopToSupabase,
    buildRecordsFromRows,
    parseAndSaveLshopFiles
  };

})(window);
