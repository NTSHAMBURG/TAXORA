// Taxora Backend – Proxy zwischen der Taxora-App und der Claude-API.
// Hält den Anthropic-Key geheim (server-seitig), prüft einen Zugangscode,
// begrenzt die Rate und erlaubt nur die Taxora-App als Aufrufer (CORS).
// Läuft z. B. auf Railway (Node 18+).

const express = require("express");
const app = express();

// ---- Konfiguration über Umgebungsvariablen ----
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ACCESS_CODE       = process.env.ACCESS_CODE || "";
const ALLOWED_ORIGIN    = process.env.ALLOWED_ORIGIN || "https://ntshamburg.github.io";
const RATE_PER_MIN      = parseInt(process.env.RATE_PER_MIN || "20", 10);
const MODEL             = process.env.MODEL || "claude-sonnet-4-6";
const PORT              = process.env.PORT || 3000;

app.use(express.json({ limit: "25mb" })); // große Base64-Bilder erlauben

// ---- CORS: nur die Taxora-App-Domain darf rufen ----
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Access-Code");
  res.header("Vary", "Origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- Rate-Limit: pro Zugangscode, gleitendes 60-Sekunden-Fenster ----
const hits = new Map();
function rateLimited(codeKey) {
  const now = Date.now();
  const arr = (hits.get(codeKey) || []).filter(t => now - t < 60000);
  if (arr.length >= RATE_PER_MIN) { hits.set(codeKey, arr); return true; }
  arr.push(now); hits.set(codeKey, arr); return false;
}

// ---- Zugangscode prüfen ----
function checkAccess(req, res) {
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server nicht konfiguriert (ACCESS_CODE fehlt)." }); return false; }
  const got = (req.headers["x-access-code"] || "").toString();
  if (got !== ACCESS_CODE) { res.status(401).json({ error: "Zugangscode ungültig." }); return false; }
  return true;
}

// ---- Health-Check ----
app.get("/", (req, res) => res.json({ ok: true, service: "taxora-backend" }));

// ---- Verbindungstest: prüft Zugangscode + Anthropic-Key/Guthaben (winzige Anfrage) ----
app.get("/ping", async (req, res) => {
  if (!checkAccess(req, res)) return;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8, messages: [{ role: "user", content: "ping" }] })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(r.status).json({ error: (data && data.error && data.error.message) || ("HTTP " + r.status) });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: "Server erreicht Anthropic nicht: " + (e && e.message ? e.message : String(e)) });
  }
});

// ---- Hauptendpunkt: Beleg auslesen & kontieren ----
app.post("/extract", async (req, res) => {
  if (!checkAccess(req, res)) return;
  if (rateLimited(req.headers["x-access-code"])) return res.status(429).json({ error: "Zu viele Anfragen pro Minute. Bitte kurz warten." });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY fehlt." });

  const body = req.body || {};
  const images = Array.isArray(body.images) ? body.images : [];
  const pdf = body.pdf || null;
  const mandant = (body.mandant || "").toString();
  const kontenrahmen = (body.kontenrahmen || "SKR04").toString();
  if (!images.length && !pdf) return res.status(400).json({ error: "Kein Bild/PDF übergeben." });

  const content = [];
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: stripDataUrl(pdf) } });
  images.forEach(im => content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(im) } }));
  content.push({ type: "text", text:
    'Du bist erfahrener Buchhalter und kontierst diesen Beleg für "' + mandant + '" nach Kontenrahmen ' + kontenrahmen + '. ' +
    'Mehrere Bilder = EIN Beleg. Erkenne Sonderfälle und vermerke sie im Feld hinweis (z. B. Bewirtung § 4 Abs. 5 Nr. 2 EStG: 70% abziehbar, 30% nicht, Vorsteuer 100%; fehlende Pflichtangaben). ' +
    'Antworte AUSSCHLIESSLICH mit JSON: {"lieferant":string,"belegdatum":"YYYY-MM-DD","belegnummer":string,"brutto":number,"steuersatz":number,"steuerbetrag":number,"netto":number,"buchungstext":string,"konto_soll":string,"konto_haben":string,"steuerschluessel":string,"konfidenz":number,"hinweis":string}. ' +
    'Beträge mit Punkt. steuersatz in Prozent. Konten als ' + kontenrahmen + '.'
  });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content }] })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(r.status).json({ error: (data && data.error && data.error.message) || ("HTTP " + r.status) });
    const text = (data.content || []).filter(i => i.type === "text").map(i => i.text).join("\n");
    const obj = parseJson(text);
    if (!obj) return res.status(502).json({ error: "Antwort der KI konnte nicht gelesen werden." });
    res.json({ ok: true, draft: obj });
  } catch (e) {
    res.status(502).json({ error: "Server erreicht Anthropic nicht: " + (e && e.message ? e.message : String(e)) });
  }
});

// ---- Hilfsfunktionen ----
function stripDataUrl(s) {
  s = String(s);
  const i = s.indexOf(",");
  return (i >= 0 && s.slice(0, i).indexOf("base64") >= 0) ? s.slice(i + 1) : s;
}
function parseJson(text) {
  let js = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = js.indexOf("{"), e = js.lastIndexOf("}");
  if (s >= 0 && e > s) js = js.slice(s, e + 1);
  try { return JSON.parse(js); } catch (_) { return null; }
}

app.listen(PORT, () => console.log("Taxora backend läuft auf Port " + PORT));
