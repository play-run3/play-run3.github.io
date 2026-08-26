# Pulse — Bulk URL Status Checker

A colorful, streaming bulk URL status checker with separate frontend JavaScript.

## Run
1. `npm install`
2. `npm start`
3. Open `http://localhost:3000`

## Structure
- `server.js` — Express API, streaming NDJSON results, redirect handling, timeouts, SSRF protection and rate limiting.
- `public/index.html` — Pulse UI and styles.
- `public/app.js` — frontend logic, streaming results, filtering, search, confetti and lazy XLSX export.
- `package.json` / `package-lock.json` — Node dependencies.

## Features
- Up to 100 URLs per request.
- Live streamed results.
- 2xx / 3xx / 4xx / 5xx / Error filters.
- Search results.
- TXT/CSV import.
- XLSX export loaded only when Export is clicked.
- Confetti celebration after a completed check.
- Responsive colorful Pulse design.
