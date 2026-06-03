import { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, Plugin } from "vite";
import react from "@vitejs/plugin-react";

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function readRouteParams(url: string) {
  const match = url.match(/^\/api\/magnific\/icons\/(\d+)\/download(?:\?|$)/);
  return match ? { id: match[1] } : null;
}

function readGiphyRouteParams(url: string) {
  const match = url.match(/^\/api\/giphy\/gifs\/([^/]+)\/download(?:\?|$)/);
  return match ? { id: decodeURIComponent(match[1]) } : null;
}

function validateGiphyAssetUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(hostname === "i.giphy.com" || /^media\d*\.giphy\.com$/.test(hostname))) {
    throw new Error("GIPHY asset URL must use HTTPS media.giphy.com.");
  }
  return url;
}

function sanitizeFileName(value: unknown, fallback: string) {
  const cleaned = String(value || "").replace(/["\\/<>:|?*]/g, "").trim();
  return cleaned || fallback;
}

function magnificProxyPlugin(apiKey: string): Plugin {
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = request.url ?? "";
    if (!requestUrl.startsWith("/api/magnific/")) return false;

    if (!apiKey) {
      sendJson(response, 500, { message: "Missing MAGNIFIC_API_KEY in the server environment." });
      return true;
    }

    try {
      if (requestUrl.startsWith("/api/magnific/icons?") || requestUrl === "/api/magnific/icons") {
        const upstreamUrl = new URL(`https://api.magnific.com/v1/icons${new URL(requestUrl, "http://localhost").search}`);
        const upstream = await fetch(upstreamUrl, {
          headers: {
            "x-magnific-api-key": apiKey,
            "Accept-Language": "en-US",
          },
        });
        const text = await upstream.text();
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
        response.end(text);
        return true;
      }

      const params = readRouteParams(requestUrl);
      if (!params) {
        sendJson(response, 404, { message: "Not found" });
        return true;
      }

      const routeUrl = new URL(requestUrl, "http://localhost");
      const upstream = await fetch(`https://api.magnific.com/v1/icons/${params.id}/download?${routeUrl.searchParams.toString()}`, {
        headers: {
          "x-magnific-api-key": apiKey,
          "Accept-Language": "en-US",
        },
      });
      const downloadText = await upstream.text();
      if (!upstream.ok) {
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
        response.end(downloadText);
        return true;
      }

      const downloadPayload = JSON.parse(downloadText) as { data?: { url?: string; filename?: string } };
      const assetUrl = downloadPayload.data?.url;
      if (!assetUrl) {
        sendJson(response, 502, { message: "Magnific download response did not include an asset URL." });
        return true;
      }

      const assetResponse = await fetch(assetUrl);
      if (!assetResponse.ok) {
        sendJson(response, 502, { message: "Failed to fetch the downloaded icon asset." });
        return true;
      }

      const bytes = Buffer.from(await assetResponse.arrayBuffer());
      response.statusCode = 200;
      response.setHeader("Content-Type", assetResponse.headers.get("content-type") || "image/gif");
      const fileName = downloadPayload.data?.filename || `magnific-icon-${params.id}.gif`;
      response.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      response.end(bytes);
      return true;
    } catch (error) {
      sendJson(response, 500, { message: error instanceof Error ? error.message : "Magnific proxy failed." });
      return true;
    }
  }

  return {
    name: "magnific-proxy",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response).then((handled) => {
          if (!handled) next();
        });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}

async function readFormData(request: IncomingMessage) {
  const method = request.method || "GET";
  const init: RequestInit & { duplex?: "half" } = method === "GET" || method === "HEAD"
    ? { method, headers: request.headers as RequestInit["headers"] }
    : { method, headers: request.headers as RequestInit["headers"], body: request as unknown as RequestInit["body"], duplex: "half" };
  const webRequest = new Request(`http://${request.headers.host || "localhost"}${request.url || "/"}`, init);
  return await webRequest.formData();
}

function giphyProxyPlugin(apiKey: string): Plugin {
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith("/api/giphy/")) return false;

    if (!apiKey) {
      sendJson(response, 500, { message: "Missing GIPHY_API_KEY in the server environment." });
      return true;
    }

    try {
      if (requestUrl.pathname === "/api/giphy/search" && request.method === "GET") {
        const limit = Math.max(1, Math.min(48, Number(requestUrl.searchParams.get("limit") || 24)));
        const offset = Math.max(0, Number(requestUrl.searchParams.get("offset") || 0));
        const query = requestUrl.searchParams.get("q")?.trim() ?? "";
        const upstreamParams = new URLSearchParams({
          api_key: apiKey,
          limit: String(limit),
          offset: String(offset),
          rating: "pg-13",
          lang: "en",
        });
        if (query) upstreamParams.set("q", query);

        const endpoint = query ? "search" : "trending";
        const upstream = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${upstreamParams.toString()}`);
        const text = await upstream.text();
        response.statusCode = upstream.status;
        response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
        response.end(text);
        return true;
      }

      const giphyParams = readGiphyRouteParams(request.url ?? "");
      if (giphyParams && request.method === "GET") {
        const upstream = await fetch(`https://api.giphy.com/v1/gifs/${encodeURIComponent(giphyParams.id)}?api_key=${encodeURIComponent(apiKey)}`);
        const lookupText = await upstream.text();
        if (!upstream.ok) {
          response.statusCode = upstream.status;
          response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
          response.end(lookupText);
          return true;
        }

        const payload = JSON.parse(lookupText) as { data?: { slug?: string; title?: string; images?: { original?: { url?: string }; downsized?: { url?: string } } } };
        const assetUrl = payload.data?.images?.downsized?.url || payload.data?.images?.original?.url;
        if (!assetUrl) {
          sendJson(response, 502, { message: "GIPHY response did not include a downloadable GIF URL." });
          return true;
        }

        const assetResponse = await fetch(validateGiphyAssetUrl(assetUrl));
        if (!assetResponse.ok) {
          sendJson(response, 502, { message: "Failed to fetch the GIPHY GIF asset." });
          return true;
        }

        const contentType = assetResponse.headers.get("content-type") || "image/gif";
        const bytes = Buffer.from(await assetResponse.arrayBuffer());
        response.statusCode = 200;
        response.setHeader("Content-Type", contentType);
        const fileName = sanitizeFileName(payload.data?.slug || payload.data?.title, `giphy-${giphyParams.id}`);
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
      if (!file || typeof file === "string" || !("size" in file)) {
        sendJson(response, 400, { message: "A GIF file is required for GIPHY upload." });
        return true;
      }

      if (file.size > 100 * 1024 * 1024) {
        sendJson(response, 400, { message: "GIF exceeds GIPHY's 100MB upload limit." });
        return true;
      }

      const uploadFile = file as Blob & { name?: string };
      const upstreamForm = new FormData();
      upstreamForm.set("api_key", apiKey);
      upstreamForm.set("file", uploadFile, uploadFile.name || "open-gif-studio.gif");
      const tags = formData.get("tags");
      if (typeof tags === "string" && tags.trim()) upstreamForm.set("tags", tags.trim());

      const upstream = await fetch("https://upload.giphy.com/v1/gifs", { method: "POST", body: upstreamForm });
      const text = await upstream.text();
      response.statusCode = upstream.status;
      response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      response.end(text);
      return true;
    } catch (error) {
      sendJson(response, 500, { message: error instanceof Error ? error.message : "GIPHY proxy failed." });
      return true;
    }
  }

  return {
    name: "giphy-proxy",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response).then((handled) => {
          if (!handled) next();
        });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.magnific.com https://upload.giphy.com; worker-src 'self' blob: data:; object-src 'none'; base-uri 'none'",
  );
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      magnificProxyPlugin(env.MAGNIFIC_API_KEY?.trim() ?? ""),
      giphyProxyPlugin(env.GIPHY_API_KEY?.trim() ?? ""),
      {
        name: "security-headers",
        configureServer(server) {
          server.middlewares.use((_req, res, next) => {
            setSecurityHeaders(res);
            next();
          });
        },
      },
    ],
  };
});
