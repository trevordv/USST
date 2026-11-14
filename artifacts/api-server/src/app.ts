import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { staticCacheControl } from "./lib/http-cache";

const app: Express = express();
const appUrl = process.env["APP_URL"]?.replace(/\/+$/, "");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Production is served same-origin. If an APP_URL is configured, only that
// origin is allowed to make browser cross-origin requests to the API.
app.use(cors({ origin: appUrl ? [appUrl] : false }));
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const publicDir = path.resolve(process.cwd(), "dist/public");
const frontendIndex = path.join(publicDir, "index.html");

if (existsSync(frontendIndex)) {
  app.use(express.static(publicDir, {
    setHeaders(res, filePath) {
      res.setHeader("Cache-Control", staticCacheControl(filePath, publicDir));
    },
  }));

  // SPA fallback: client-side routes should return the built React app.
  // API requests are deliberately excluded so unknown API routes still 404.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(frontendIndex);
  });
}

export default app;
