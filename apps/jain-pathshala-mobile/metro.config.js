const http = require("node:http");
const { URL } = require("node:url");
const { getDefaultConfig } = require("expo/metro-config");

const API_TARGET =
  process.env.API_PROXY_TARGET?.replace(/\/$/, "") ?? "http://127.0.0.1:8080";

/** Paths served by api-server (see apps/api-server/src/app.ts). */
const API_PREFIXES = ["/api", "/v1", "/uploads"];

function isApiPath(url) {
  const path = (url ?? "").split("?")[0];
  return API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function proxyToApi(req, res) {
  const target = new URL(`${API_TARGET}${req.url}`);
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;

  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "ERR_PROXY",
            message: `Metro could not reach api-server at ${API_TARGET}: ${err.message}`,
          },
        }),
      );
    }
  });

  req.pipe(proxyReq, { end: true });
}

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (isApiPath(req.url)) {
        proxyToApi(req, res);
        return;
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
