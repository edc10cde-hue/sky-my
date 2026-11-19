// Cloudflare Pages Function: GET /api/flights?region=iraq|gulf|world&source=opensky|sim
const IRAQ = [[42.35,37.1],[44.8,37.15],[45.4,35.9],[46.1,35.1],[45.6,34.0],[46.2,33.1],[47.6,32.4],[48.0,30.9],[48.0,30.0],[47.2,29.1],[46.5,29.1],[44.7,29.2],[41.0,31.0],[39.2,32.1],[38.9,32.0],[40.8,33.5],[41.3,34.6],[41.2,36.4]];
const BOX = {
  iraq: 'lamin=28.8&lomin=38.7&lamax=37.5&lomax=48.8',
  gulf: 'lamin=22&lomin=34&lamax=42&lomax=62',
  world: ''
};
function inside(lon, lat, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

let tok = { v: null, exp: 0 };
async function token(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  if (tok.v && Date.now() < tok.exp) return tok.v;
  try {
    const r = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENSKY_CLIENT_ID, client_secret: env.OPENSKY_CLIENT_SECRET })
    });
    if (!r.ok) return null;
    const j = await r.json();
    tok = { v: j.access_token, exp: Date.now() + ((j.expires_in || 1800) - 60) * 1000 };
    return tok.v;
  } catch { return null; }
}

async function opensky(region, env) {
  const headers = {};
  const tk = await token(env);
  if (tk) headers.Authorization = 'Bearer ' + tk;
  const r = await fetch('https://opensky-network.org/api/states/all?' + BOX[region], { headers });
  if (!r.ok) throw new Error('OpenSky ' + r.status);
  const j = await r.json();
  let d = (j.states || [])
    .filter(s => s[5] != null && s[6] != null && !s[8])
    .map(s => ({ id: s[0], call: (s[1] || '').trim() || s[0], country: s[2], lon: s[5], lat: s[6],
      alt: Math.round((s[7] || 0) * 3.281), spd: Math.round((s[9] || 0) * 1.944), trk: Math.round(s[10] || 0) }));
  if (region === 'iraq') d = d.filter(f => inside(f.lon, f.lat, IRAQ));
  return d;
}

const CENTER = { iraq: [33.3, 43.9, 250], gulf: [30, 46, 250] };
async function adsb(region) {
  const c = CENTER[region];
  if (!c) throw new Error('adsb: region not supported');
  const r = await fetch('https://api.adsb.lol/v2/point/' + c.join('/'));
  if (!r.ok) throw new Error('adsb ' + r.status);
  const j = await r.json();
  let d = (j.ac || [])
    .filter(a => a.lat != null && a.lon != null && typeof a.alt_baro === 'number')
    .map(a => ({ id: a.hex, call: (a.flight || '').trim() || a.hex, country: [a.t, a.r].filter(Boolean).join(' '),
      lon: a.lon, lat: a.lat, alt: Math.round(a.alt_baro), spd: Math.round(a.gs || 0), trk: Math.round(a.track || 0) }));
  if (region === 'iraq') d = d.filter(f => inside(f.lon, f.lat, IRAQ));
  return d;
}

// Deterministic simulation (no server state needed)
function simulate() {
  const t = Date.now() / 1000, al = ['IA', 'EK', 'QR', 'TK', 'FZ'];
  return Array.from({ length: 30 }, (_, i) => {
    const spd = 380 + (i * 13) % 120, trk = (i * 47) % 360, r = trk * Math.PI / 180;
    const dd = spd * 4.63e-6 * t;
    const lat = 29 + (((30 + (i * 29) % 70 / 10 + dd * Math.cos(r)) % 8.5) + 8.5) % 8.5;
    const lon = 38.7 + (((39 + (i * 53) % 90 / 10 + dd * Math.sin(r)) % 10) + 10) % 10 - 0.3;
    return { id: 'sim' + i, call: al[i % 5] + (100 + i * 7), country: 'محاكاة', lat, lon,
      alt: 15000 + (i * 977) % 25000, spd, trk };
  });
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const region = BOX[u.searchParams.get('region')] !== undefined ? u.searchParams.get('region') : 'iraq';
  const sp = u.searchParams.get('source');
  const source = sp === 'sim' || sp === 'adsb' ? sp : 'opensky';
  try {
    const flights = source === 'sim' ? simulate() : source === 'adsb' ? await adsb(region) : await opensky(region, env);
    return new Response(JSON.stringify({ flights, source, at: Date.now() }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=10' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
