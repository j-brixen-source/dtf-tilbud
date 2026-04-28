// ════════════════════════════════════════════════════════════════════════
//  Netlify Function: AI email-parsing via Anthropic Claude
// ════════════════════════════════════════════════════════════════════════
//
//  Tager en kunde-email + tøjliste (string) og returnerer struktureret
//  JSON med ordredetaljer (kundenavn, tøj-linjer, printpositioner, mm.).
//
//  Fra v1.059 ligger Anthropic API-nøglen som env var ANTHROPIC_KEY på
//  Netlify — IKKE længere i browseren. Det forhindrer at nøglen lækker
//  og fjerner behovet for `anthropic-dangerous-direct-browser-access`.
//
//  Endpoint:
//    POST /api/parse-email
//    Body: { "email": "...", "garmentList": "..." }
//
//  Response (success): det parsede JSON-objekt fra modellen
//  Response (fejl):    { "error": "..." }
// ════════════════════════════════════════════════════════════════════════

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';   // current (feb 2026), $3/$15
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1200;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed — brug POST' });
  }

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      error: 'ANTHROPIC_KEY env var er ikke sat på Netlify. Sæt den under Site settings → Environment variables.'
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Ugyldig JSON i request body' });
  }

  const email = (body.email || '').trim();
  const garmentList = (body.garmentList || 'Tom liste').trim();

  if (!email) {
    return jsonResponse(400, { error: 'Mangler email-tekst' });
  }

  const prompt = buildPrompt({ email, garmentList });

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await aiRes.json();

    if (!aiRes.ok || data.error) {
      const msg = data.error?.message || `Anthropic API status ${aiRes.status}`;
      return jsonResponse(aiRes.status >= 400 ? aiRes.status : 502, {
        error: 'Anthropic API: ' + msg
      });
    }

    // Saml tekst-blokke fra svar (typisk én tekstblok)
    const text = (data.content || []).map(c => c.text || '').join('');

    // Modellen kan finde på at wrappe i ```json ... ``` selv om vi beder om kun JSON
    const cleaned = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      return jsonResponse(502, {
        error: 'Kunne ikke parse JSON fra AI-svar',
        raw_excerpt: cleaned.slice(0, 400)
      });
    }

    return jsonResponse(200, parsed);

  } catch (err) {
    return jsonResponse(500, { error: 'Server-fejl: ' + err.message });
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}

// ──────────────────────────────────────────────────────────────────────
//  Prompt-template
//  Flyttet 1:1 fra index.html v1.058 — uden funktionelle ændringer.
//  Hvis prompt-tweaks er nødvendige, sker de her (ikke i klienten).
// ──────────────────────────────────────────────────────────────────────
function buildPrompt({ email, garmentList }) {
  return `Du er assistent for et t-shirt trykkeri. Læs denne kundeordre og udtræk information.

PRINTPOSITIONER:
- "front", "forside", "bryst", "front tryk", "brysttryk" → "front", trykkstørrelse "large" (standard)
- "back", "bagside", "ryg", "ryggen", "rygtryk" → "back", trykkstørrelse "large" (standard)
- "ærme", "ærmer", "sleeve", "arm" uden yderligere → BEGGE ærmer (sleeve_l OG sleeve_r), altid "small"
- "venstre ærme" / "left sleeve" → kun sleeve_l
- "højre ærme" / "right sleeve" → kun sleeve_r
- "stor" + position → "large" (f.eks. "stor ryg" = back large)
- "lille" + position eller mål under 10×10 cm → "small"
- "ekstra stor" eller mål over 26×35 cm → "xl"
- Ingen print nævnt → tom liste []

TØJSØGNING:
- Match bredt på produktnavn, brand, SKU eller dele heraf
- "creator" matcher Stanley Stella Creator, "E190" matcher B&C E190 osv.

FARVEOVERSSÆTTELSE dansk → engelsk (brug altid det engelske navn fra tøjlisten):
- rød / red → Red
- sort / black / svart → Black
- hvid / white / hvit → White
- blå / blue → Blue eller Navy alt efter kontekst
- navy / mørkeblå → Navy
- grå / grijs / grey / gray → Grey eller Dark Grey
- grøn / green / grön → Green eller Bottle Green
- gul / yellow → Yellow
- orange → Orange
- lyserød / pink → Pink
- lilla / purple / violet → Purple
- brun / brown → Brown
- bordeaux / vinrød → Burgundy eller Red
- beige / sand → Beige eller Sand
- turkis / turquoise → Turquoise eller Atoll

STØRRELSES-ANTAL og STØRRELSESNAVNE:
Brug ALTID de officielle størrelseskoder i størrelsesantal:
- "small" / "lille" / "s" → "S"
- "medium" / "m" → "M"
- "large" / "l" / "stor" → "L"
- "xl" / "ekstra large" → "XL"
- "xxl" / "2xl" / "dobbelt xl" → "XXL"
- "3xl" / "xxxl" → "3XL"
- "4xl" → "4XL" osv.

Eksempler:
- "5 small og 5 xl" → størrelsesantal: {"S":5,"XL":5}
- "5 small og 5 medium" → størrelsesantal: {"S":5,"M":5}
- "10 stk i large" → størrelsesantal: {"L":10}
- Kun totalt antal → sæt totalantal, lad størrelsesantal være {}

FARVE: Skriv farvenavnet på engelsk præcist som det står i tøjlisten (f.eks. "Red", "Black", "Navy").

Tøjliste:
${garmentList}

Ordretekst:
${email}

Svar KUN med JSON (ingen markdown):
{
  "kundenavn":"...",
  "tøj":[{
    "sku":"...",
    "navn":"...",
    "fundet_i_liste":true,
    "farve":"Black",
    "størrelsesantal":{"S":5,"M":5},
    "totalantal":10
  }],
  "mangler":[{"navn":"...","beskrivelse":"..."}],
  "printpositioner":["front"],
  "printtype":{"front":"large","back":"large","sleeve_l":"small","sleeve_r":"small"}
}`;
}
