# Taxora Backend

Kleiner Proxy-Server zwischen der Taxora-App und der Claude-API.
Er hält den Anthropic-API-Key **geheim auf dem Server**, prüft einen **Zugangscode**,
**begrenzt die Rate** (Standard 20/Min) und erlaubt nur die Taxora-App als Aufrufer (**CORS**).

So ruft die App nicht mehr direkt Anthropic auf (das war die Ursache für „Load failed"
und die Abhängigkeit von VPN/Adblockern). Stattdessen: App → dein Server → Anthropic.

## Endpunkte
- `POST /extract` — nimmt Belegbilder/PDF entgegen, ruft Claude auf, gibt den Buchungsvorschlag (JSON) zurück.
- `GET /ping` — testet Zugangscode + Anthropic-Key/Guthaben mit einer winzigen Anfrage.
- `GET /` — Health-Check.

## Umgebungsvariablen (in Railway unter „Variables")
| Variable | Pflicht | Standard | Beschreibung |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ja | — | Dein Anthropic-Key (sk-ant-...). Liegt NUR hier, nie in der App. |
| `ACCESS_CODE` | ja | — | Selbst gewählter Zugangscode für die App, z. B. `taxora-nts-2026`. |
| `ALLOWED_ORIGIN` | nein | `https://ntshamburg.github.io` | Welche Domain rufen darf. |
| `RATE_PER_MIN` | nein | `20` | Max. Anfragen pro Minute pro Zugangscode. |
| `MODEL` | nein | `claude-sonnet-4-6` | Verwendetes Claude-Modell. |

## Auf Railway deployen (geht komplett im Browser, auch auf dem iPad)
1. Neues GitHub-Repo anlegen, z. B. `NTSHAMBURG/taxora-backend`, und diese 3 Dateien hochladen:
   `server.js`, `package.json`, `README.md`.
2. Railway öffnen → **New Project** → **Deploy from GitHub repo** → `taxora-backend` auswählen.
3. Im Projekt → Tab **Variables** → mindestens `ANTHROPIC_API_KEY` und `ACCESS_CODE` setzen.
4. Tab **Settings** → **Networking** → **Generate Domain**. Du bekommst eine URL wie
   `https://taxora-backend-production.up.railway.app`.
5. Diese **URL** + deinen **ACCESS_CODE** mir schicken — dann gebe ich dir die fertige `index.html`,
   die genau diesen Server anspricht. Du musst dann **nichts** im Code ändern, nur hochladen.

## Sicherheit
- Der Anthropic-Key liegt nur auf dem Server, nie in der öffentlichen App.
- Zugangscode + Rate-Limit halten Missbrauch ab.
- **Harte Obergrenze:** Ausgabenlimit in der Anthropic-Konsole unter **Limits** setzen
  (Prepaid-Guthaben ohne Auto-Aufladung). Selbst im Worst Case ist der Schaden damit gedeckelt.
