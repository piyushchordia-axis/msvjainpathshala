/**
 * The one Socket.IO server instance, shared by every namespace.
 *
 * Extracted from admin-dashboard-feed.ts, which used to call `new Server`
 * itself. That was fine while it was the only feed; a second feed calling
 * `new Server` on the same HTTP server installs a second engine.io handler on
 * the same path and the two fight over every upgrade. Namespaces attach here.
 *
 * PERF #17 — Redis adapter for cross-instance emit, CORS allow-list shared with
 * Express. Socket.IO is imported lazily so a deployment without it degrades to
 * "no live feed" rather than failing to boot.
 */
import type { Server as HttpServer } from "node:http";
import type { Server as IOServer } from "socket.io";
import IORedis from "ioredis";
import { corsOriginDelegate } from "./cors-origins";
import { logger } from "./logger";

let io: IOServer | null = null;
let ready: Promise<IOServer | null> | null = null;
let adapterPub: IORedis | null = null;
let adapterSub: IORedis | null = null;

/** Namespace installers registered before the server finished booting. */
const pending: Array<(server: IOServer) => void> = [];

/** The live server, or null when socket.io is unavailable / not yet attached. */
export function getIo(): IOServer | null {
  return io;
}

/**
 * Boot the shared server on the given HTTP server. Idempotent — a second call
 * returns the same promise rather than creating a second engine.
 */
export function attachSocketServer(httpServer: HttpServer, redisUrl?: string): Promise<IOServer | null> {
  if (ready) return ready;

  ready = Promise.all([import("socket.io"), import("@socket.io/redis-adapter")])
    .then(async ([{ Server }, { createAdapter }]) => {
      const server = new Server(httpServer, {
        path: "/socket.io",
        cors: { origin: corsOriginDelegate, credentials: true },
      });

      const url = (redisUrl ?? process.env.REDIS_URL)?.trim();
      if (url) {
        const base = new IORedis(url, { maxRetriesPerRequest: null });
        base.on("error", (err) => logger.warn({ err }, "socket adapter Redis error"));
        adapterPub = base.duplicate();
        adapterSub = base.duplicate();
        server.adapter(createAdapter(adapterPub, adapterSub));
        logger.info("Socket.IO Redis adapter attached");
      } else {
        logger.warn("REDIS_URL unset — Socket.IO feeds are single-process only");
      }

      io = server;
      for (const install of pending.splice(0)) install(server);
      return server;
    })
    .catch((err) => {
      logger.warn({ err }, "socket.io unavailable; live feeds are disabled");
      return null;
    });

  return ready;
}

/**
 * Register a namespace installer. Runs immediately if the server is already up,
 * otherwise queues until it is — so feed modules never race the boot.
 */
export function onSocketServer(install: (server: IOServer) => void): void {
  if (io) {
    install(io);
    return;
  }
  pending.push(install);
}

/** @internal — test teardown. */
export async function closeSocketServer(): Promise<void> {
  const server = io;
  io = null;
  ready = null;
  pending.length = 0;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  adapterPub?.disconnect();
  adapterSub?.disconnect();
  adapterPub = null;
  adapterSub = null;
}
