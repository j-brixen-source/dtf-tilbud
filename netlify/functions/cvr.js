// Netlify Function: CVR opslag proxy
// Undgår CORS-problemer ved at kalde cvrapi.dk fra serveren

export async function handler(event) {
  const cvr = event.queryStringParameters?.cvr;

  if (!cvr || cvr.length < 8) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Ugyldigt CVR-nummer' })
    };
  }

  try {
    const res = await fetch(
      `https://cvrapi.dk/api?search=${encodeURIComponent(cvr)}&country=dk`,
      {
        headers: {
          'User-Agent': 'DTF Tilbudsberegner - Netlify Function',
          'Accept': 'application/json'
        }
      }
    );

    const data = await res.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'CVR opslag fejlede: ' + err.message })
    };
  }
}
