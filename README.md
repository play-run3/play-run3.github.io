# Pulse Bulk URL Checker

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Large URL lists

The UI accepts up to **10,000 URLs per check**. It automatically sends them to the Render/Node backend in **2,000-URL batches**. This keeps each HTTP request manageable while allowing lists larger than 2,000 URLs.

The backend accepts up to 2,000 URLs per `/api/check` request. The browser combines all batch results and preserves the original input order.

## Render

Use Node 18+ and the start command `npm start`. The app listens on the `PORT` environment variable supplied by Render.

For very large lists, increase concurrency carefully. On a free/small Render instance, 25-50 is generally safer than pushing 200 concurrent requests.
