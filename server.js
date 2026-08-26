const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 10;
const MAX_URLS_PER_REQUEST = 2000;

function normalizeUrl(raw) {
  const url = (raw || "").trim();

  if (!url) return "";

  if (!/^https?:\/\//i.test(url)) {
    return "https://" + url;
  }

  return url;
}

async function checkUrl(rawUrl, userAgent) {
  const result = {
    originalUrl: rawUrl,

    // ORIGINAL URL STATUS
    statusCode: "",

    // FINAL URL AFTER REDIRECTS
    finalUrl: "",

    // FINAL RESPONSE STATUS
    finalStatusCode: "",

    redirectCount: 0,
    redirectChain: "",
    responseTimeMs: "",
    contentType: "",
    server: "",
    contentLength: "",
    error: "",
  };

  const url = normalizeUrl(rawUrl);

  if (!url) {
    result.error = "Empty URL";
    return result;
  }

  const chain = [];
  let currentUrl = url;
  let response;

  const start = Date.now();

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController();

      const timer = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);

      try {
        response = await fetch(currentUrl, {
          method: "GET",

          // VERY IMPORTANT
          // Redirects manually follow honge taake original status
          // aur final status dono mil saken.
          redirect: "manual",

          headers: {
            "User-Agent":
              userAgent || DEFAULT_USER_AGENT,
            Accept: "*/*",
          },

          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // FIRST RESPONSE = ORIGINAL URL STATUS
      if (hop === 0) {
        result.statusCode = response.status;
      }

      const isRedirect = [
        301,
        302,
        303,
        307,
        308,
      ].includes(response.status);

      const location =
        response.headers.get("location");

      if (isRedirect && location) {
        chain.push(
          `${response.status} -> ${currentUrl}`
        );

        if (response.body) {
          response.body.cancel().catch(() => {});
        }

        currentUrl = new URL(
          location,
          currentUrl
        ).toString();

        continue;
      }

      break;
    }

    const elapsed = Date.now() - start;

    // FINAL URL
    result.finalUrl = currentUrl;

    // FINAL STATUS
    result.finalStatusCode =
      response ? response.status : "";

    result.redirectCount = chain.length;

    result.redirectChain =
      chain.join(" | ");

    result.responseTimeMs = elapsed;

    result.contentType =
      response?.headers.get("content-type") || "";

    result.server =
      response?.headers.get("server") || "";

    result.contentLength =
      response?.headers.get("content-length") || "";

    if (response?.body) {
      response.body.cancel().catch(() => {});
    }
  } catch (err) {
    if (err.name === "AbortError") {
      result.error =
        `Timeout after ${TIMEOUT_MS / 1000}s`;
    } else {
      result.error =
        err.message || String(err);
    }
  }

  return result;
}


// ================================
// BULK CHECK API
// ================================

app.post("/api/check", async (req, res) => {
  const {
    urls,
    concurrency,
    userAgent,
  } = req.body || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      error: "No URLs provided",
    });
  }

  const limited =
    urls.slice(0, MAX_URLS_PER_REQUEST);

  const poolSize = Math.min(
    Math.max(
      parseInt(concurrency) || 50,
      1
    ),
    200
  );

  res.writeHead(200, {
    "Content-Type":
      "application/x-ndjson; charset=utf-8",

    "Cache-Control": "no-cache",

    "X-Accel-Buffering": "no",
  });

  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;

      if (i >= limited.length) {
        return;
      }

      const result =
        await checkUrl(
          limited[i],
          userAgent
        );

      res.write(
        JSON.stringify({
          ...result,

          index: i,

          total: limited.length,
        }) + "\n"
      );
    }
  }

  const workerCount = Math.min(
    poolSize,
    limited.length
  );

  const workers =
    Array.from(
      { length: workerCount },
      () => worker()
    );

  try {
    await Promise.all(workers);
  } finally {
    res.end();
  }
});


// ================================
// HEALTH CHECK
// ================================

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      status: "ok",
    });
  }
);


// ================================
// START SERVER
// ================================

app.listen(
  PORT,
  () => {
    console.log(
      `Bulk URL Checker running on port ${PORT}`
    );
  }
);
