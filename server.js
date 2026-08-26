'use strict';

const express = require('express');
const path = require('node:path');
const dns = require('node:dns').promises;
const net = require('node:net');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_USER_AGENT =
  process.env.USER_AGENT ||
  'URLSignalBot/1.0 (+https://example.com/bot)';

const MAX_URLS_PER_REQUEST = 100;
const MAX_CONCURRENCY = 50;
const DEFAULT_CONCURRENCY = 25;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 10;
const BODY_LIMIT = '1mb';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function normalizeUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a,b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0;
}

function isPrivateIpv6(ip) {
  const v = ip.toLowerCase().split('%')[0];
  return v === '::1' || v === '::' ||
    v.startsWith('fc') || v.startsWith('fd') ||
    v.startsWith('fe8') || v.startsWith('fe9') ||
    v.startsWith('fea') || v.startsWith('feb');
}

function isBlockedIp(ip) {
  const family = net.isIP(ip);
  return family === 4 ? isPrivateIpv4(ip) : family === 6 ? isPrivateIpv6(ip) : false;
}

async function assertPublicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Local/private hosts are not allowed');
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('Private IP addresses are not allowed');
    return;
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => isBlockedIp(r.address))) {
    throw new Error('Host resolves to a private or local IP');
  }
}

async function checkUrl(rawUrl, options = {}) {
  const result = {
    originalUrl: rawUrl,
    finalUrl: '',
    statusCode: '',
    redirectCount: 0,
    redirectChain: '',
    responseTimeMs: '',
    contentType: '',
    server: '',
    contentLength: '',
    error: ''
  };

  const firstUrl = normalizeUrl(rawUrl);
  if (!firstUrl) {
    result.error = 'Empty URL';
    return result;
  }

  let currentUrl;
  try {
    currentUrl = new URL(firstUrl).toString();
    if (!['http:', 'https:'].includes(new URL(currentUrl).protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }
  } catch {
    result.error = 'Invalid URL';
    return result;
  }

  const timeoutMs = Math.min(
    Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000),
    MAX_TIMEOUT_MS
  );
  const followRedirects = options.followRedirects !== false;
  const userAgent = String(options.userAgent || DEFAULT_USER_AGENT).slice(0, 300);
  const chain = [];
  const start = Date.now();

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(currentUrl);
      await assertPublicHost(parsed.hostname);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': userAgent,
            'Accept': '*/*'
          },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get('location');
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);

      if (followRedirects && isRedirect && location) {
        chain.push(`${response.status} -> ${currentUrl}`);
        if (response.body) response.body.cancel().catch(() => {});
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      result.finalUrl = currentUrl;
      result.statusCode = response.status;
      result.redirectCount = chain.length;
      result.redirectChain = chain.join(' | ');
      result.responseTimeMs = Date.now() - start;
      result.contentType = response.headers.get('content-type') || '';
      result.server = response.headers.get('server') || '';
      result.contentLength = response.headers.get('content-length') || '';

      if (response.body) response.body.cancel().catch(() => {});
      return result;
    }

    result.finalUrl = currentUrl;
    result.redirectCount = chain.length;
    result.redirectChain = chain.join(' | ');
    result.responseTimeMs = Date.now() - start;
    result.error = `Too many redirects (>${MAX_REDIRECTS})`;
  } catch (err) {
    result.responseTimeMs = Date.now() - start;
    result.finalUrl = currentUrl;
    result.error = err?.name === 'AbortError'
      ? `Timeout after ${timeoutMs / 1000}s`
      : (err?.message || String(err));
  }

  return result;
}

// Lightweight in-memory rate limit. Keeps a public deployment from being
// hammered without adding another dependency.
const rate = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60_000;
  const max = 20;
  const item = rate.get(ip);

  if (!item || now - item.started > windowMs) {
    rate.set(ip, { started: now, count: 1 });
    return next();
  }
  item.count += 1;
  if (item.count > max) {
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }
  next();
}

app.post('/api/check', rateLimit, async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.urls) || body.urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }
  if (body.urls.length > MAX_URLS_PER_REQUEST) {
    return res.status(400).json({ error: `Maximum ${MAX_URLS_PER_REQUEST} URLs per request` });
  }

  const urls = body.urls.map(v => String(v ?? '').trim()).filter(Boolean);
  const concurrency = Math.min(
    Math.max(Number.parseInt(body.concurrency, 10) || DEFAULT_CONCURRENCY, 1),
    MAX_CONCURRENCY,
    urls.length
  );

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    'X-Accel-Buffering': 'no',
    ...headers
  });

  let nextIndex = 0;
  let closed = false;
  req.on('close', () => { closed = true; });

  async function worker() {
    while (!closed) {
      const index = nextIndex++;
      if (index >= urls.length) return;
      const result = await checkUrl(urls[index], {
        userAgent: body.userAgent,
        timeoutMs: body.timeoutMs,
        followRedirects: body.followRedirects
      });
      if (!closed) {
        res.write(JSON.stringify({ ...result, index, total: urls.length }) + '\n');
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    if (!res.writableEnded) res.end();
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`URLSignal running on http://localhost:${PORT}`);
});
