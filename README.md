# Pulse Bulk URL Checker — Fixed

## Important fix
The previous build could show 100% progress with 0 results because the server treated the normal request `close` event as a client disconnect. This build uses `aborted` plus response-close detection correctly, so workers actually process URLs.

## Capacity
- UI accepts up to 10,000 URLs per check.
- Browser sends automatic 2,000-URL batches.
- Results remain in original input order.
- Server handles up to 2,000 URLs per request and 50 concurrent checks.

## Run
```bash
npm install
npm start
```
Then open `http://localhost:3000`.
