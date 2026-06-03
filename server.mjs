import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const port = Number(process.env.PORT || 3000);
const magnificApiKey = process.env.MAGNIFIC_API_KEY?.trim() ?? "";
const giphyApiKey = process.env.GIPHY_API_KEY?.trim() ?? "";
const maxAssetBytes = 25 * 1024 * 1024;
const maxGiphyUploadBytes = 100 * 1024 * 1024;
const upstreamTimeoutMs = 15000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.magnific.com; worker-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function matchMagnificDownload(pathname) {
  const match = pathname.match(/^\/api\/magnific\/icons\/(\d+)\/download$/);
  return match ? { id: match[1] } : null;
}

function matchGiphyDownload(pathname) {
  const match = pathname.match(/^\/api\/giphy\/gifs\/([^/]+)\/download$/);
  return match ? { id: decodeURIComponent(match[1]) } : null;
}

function isPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  if (normalized === "0.0.0.0" || normalized === "::1" || normalized.startsWith("169.254.")) return true;
  return false;
}

function validateAssetUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Magnific asset URL must use HTTPS.");
  if (isPrivateHostname(url.hostname)) throw new Error("Magnific asset URL resolved to a blocked host.");
  return url;
}

function validateGiphyAssetUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const isGiphyMedia = hostname === "i.giphy.com" || /^media\d*\.giphy\.com$/.test(hostname);
  if (url.protocol !== "https:" || !isGiphyMedia) throw new Error("GIPHY asset URL must use HTTPS media.giphy.com.");
  if (isPrivateHostname(hostname)) throw new Error("GIPHY asset URL resolved to a blocked host.");
  return url;
}

function sanitizeFileName(value, fallback) {
  const cleaned = String(value || "").replace(/["\\/<>:|?*]/g, "").trim();
  return cleaned || fallback;
}

async function fetchWithTimeout(url, init = {}) {
  const signal = AbortSignal.timeout(upstreamTimeoutMs);
  return await fetch(url, { ...init, signal });
}

async function readResponseWithLimit(response, limitBytes) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > limitBytes) throw new Error("Asset is too large.");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > limitBytes) throw new Error("Asset is too large.");
  return buffer;
}

async function readFormData(request) {
  const method = request.method || "GET";
  const init = method === "GET" || method === "HEAD"
    ? { method, headers: request.headers }
    : { method, headers: request.headers, body: request, duplex: "half" };
  const webRequest = new Request(`http://${request.headers.host || "localhost"}${request.url || "/"}`, init);
  return await webRequest.formData();
}

async function handleGiphyProxy(request, requestUrl, response) {
  if (!requestUrl.pathname.startsWith("/api/giphy/")) return false;

  if (!giphyApiKey) {
    sendJson(response, 500, { message: "Missing GIPHY_API_KEY in the server environment." });
    return true;
  }

  try {
    if (requestUrl.pathname === "/api/giphy/search" && request.method === "GET") {
      const limit = Math.max(1, Math.min(48, Number(requestUrl.searchParams.get("limit") || 24)));
      const offset = Math.max(0, Number(requestUrl.searchParams.get("offset") || 0));
      const query = requestUrl.searchParams.get("q")?.trim() ?? "";
      const upstreamParams = new URLSearchParams({
        api_key: giphyApiKey,
        limit: String(limit),
        offset: String(offset),
        rating: "pg-13",
        lang: "en",
      });
      if (query) upstreamParams.set("q", query);

      const endpoint = query ? "search" : "trending";
      const upstream = await fetchWithTimeout(`https://api.giphy.com/v1/gifs/${endpoint}?${upstreamParams.toString()}`);
      const text = await upstream.text();
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      response.end(text);
      return true;
    }

    const downloadMatch = matchGiphyDownload(requestUrl.pathname);
    if (downloadMatch && request.method === "GET") {
      const upstream = await fetchWithTimeout(`https://api.giphy.com/v1/gifs/${encodeURIComponent(downloadMatch.id)}?api_key=${encodeURIComponent(giphyApiKey)}`);
      const lookupText = await upstream.text();
      if (!upstream.ok) {
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
        response.end(lookupText);
        return true;
      }

      const payload = JSON.parse(lookupText);
      const assetUrl = payload?.data?.images?.downsized?.url || payload?.data?.images?.original?.url;
      if (!assetUrl) {
        sendJson(response, 502, { message: "GIPHY response did not include a downloadable GIF URL." });
        return true;
      }

      const assetResponse = await fetchWithTimeout(validateGiphyAssetUrl(assetUrl));
      if (!assetResponse.ok) {
        sendJson(response, 502, { message: "Failed to fetch the GIPHY GIF asset." });
        return true;
      }

      const contentType = assetResponse.headers.get("content-type") || "image/gif";
      if (!contentType.startsWith("image/")) {
        sendJson(response, 502, { message: "GIPHY asset response was not an image." });
        return true;
      }

      const bytes = await readResponseWithLimit(assetResponse, maxAssetBytes);
      const fileName = sanitizeFileName(payload?.data?.slug || payload?.data?.title, `giphy-${downloadMatch.id}`);
      response.statusCode = 200;
      response.setHeader("Content-Type", contentType);
      response.setHeader("Content-Disposition", `inline; filename="${fileName}.gif"`);
      response.end(bytes);
      return true;
    }

    if (requestUrl.pathname !== "/api/giphy/upload" || request.method !== "POST") {
      sendJson(response, 404, { message: "Not found" });
      return true;
    }

    const formData = await readFormData(request);
    const file = formData.get("file");
    if (!(file instanceof File)) {
      sendJson(response, 400, { message: "A GIF file is required for GIPHY upload." });
      return true;
    }

    if (file.size > maxGiphyUploadBytes) {
      sendJson(response, 400, { message: "GIF exceeds GIPHY's 100MB upload limit." });
      return true;
    }

    const upstreamForm = new FormData();
    upstreamForm.set("api_key", giphyApiKey);
    upstreamForm.set("file", file, file.name || "open-gif-studio.gif");
    const tags = formData.get("tags");
    if (typeof tags === "string" && tags.trim()) upstreamForm.set("tags", tags.trim());

    const upstream = await fetchWithTimeout("https://upload.giphy.com/v1/gifs", { method: "POST", body: upstreamForm });
    const text = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.end(text);
    return true;
  } catch (error) {
    sendJson(response, 500, { message: error instanceof Error ? error.message : "GIPHY proxy failed." });
    return true;
  }
}

async function handleMagnificProxy(requestUrl, response) {
  if (!requestUrl.pathname.startsWith("/api/magnific/")) return false;

  if (!magnificApiKey) {
    sendJson(response, 500, { message: "Missing MAGNIFIC_API_KEY in the server environment." });
    return true;
  }

  try {
    if (requestUrl.pathname === "/api/magnific/icons") {
      const upstream = await fetchWithTimeout(`https://api.magnific.com/v1/icons${requestUrl.search}`, {
        headers: {
          "x-magnific-api-key": magnificApiKey,
          "Accept-Language": "en-US",
        },
      });
      const text = await upstream.text();
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      response.end(text);
      return true;
    }

    const match = matchMagnificDownload(requestUrl.pathname);
    if (!match) {
      sendJson(response, 404, { message: "Not found" });
      return true;
    }

    const upstream = await fetchWithTimeout(`https://api.magnific.com/v1/icons/${match.id}/download${requestUrl.search}`, {
      headers: {
        "x-magnific-api-key": magnificApiKey,
        "Accept-Language": "en-US",
      },
    });
    const downloadText = await upstream.text();

    if (!upstream.ok) {
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      response.end(downloadText);
      return true;
    }

    const payload = JSON.parse(downloadText);
    const assetUrl = payload?.data?.url;
    if (!assetUrl) {
      sendJson(response, 502, { message: "Magnific download response did not include an asset URL." });
      return true;
    }

    const assetResponse = await fetchWithTimeout(validateAssetUrl(assetUrl));
    if (!assetResponse.ok) {
      sendJson(response, 502, { message: "Failed to fetch the downloaded icon asset." });
      return true;
    }

    const contentType = assetResponse.headers.get("content-type") || "image/gif";
    if (!contentType.startsWith("image/")) {
      sendJson(response, 502, { message: "Magnific asset response was not an image." });
      return true;
    }

    const bytes = await readResponseWithLimit(assetResponse, maxAssetBytes);
    const fileName = payload?.data?.filename || `magnific-icon-${match.id}.gif`;
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Disposition", `inline; filename="${String(fileName).replace(/["\\]/g, "")}"`);
    response.end(bytes);
    return true;
  } catch (error) {
    sendJson(response, 500, { message: error instanceof Error ? error.message : "Magnific proxy failed." });
    return true;
  }
}

async function serveStatic(requestUrl, response) {
  if (requestUrl.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  const rawPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPath = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(distDir, normalizedPath);
  const safePath = filePath.startsWith(distDir) ? filePath : path.join(distDir, "index.html");

  try {
    const data = await readFile(safePath);
    const ext = path.extname(safePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
    response.end(data);
    return;
  } catch {
    if (path.extname(safePath)) {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
  }

  const indexHtml = await readFile(path.join(distDir, "index.html"));
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(indexHtml);
}

createServer(async (request, response) => {
  setSecurityHeaders(response);
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (await handleGiphyProxy(request, requestUrl, response)) return;
  if (await handleMagnificProxy(requestUrl, response)) return;
  await serveStatic(requestUrl, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`OGS server listening on ${port}`);
});
