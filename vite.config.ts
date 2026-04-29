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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), magnificProxyPlugin(env.MAGNIFIC_API_KEY?.trim() ?? "")],
  };
});
