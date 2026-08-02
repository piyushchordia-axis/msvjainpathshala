/**
 * AT31 — Socket.IO admin feed emits a 10-second windowed aggregate count,
 * not one event per mark (load-test SLO: 5,000 marks / 60s).
 */
import type { Server as HttpServer } from "node:http";
import { logger } from "./logger";

const WINDOW_MS = 10_000;

type CityBucket = { count: number; timer: ReturnType<typeof setTimeout> | null };

const buckets = new Map<string, CityBucket>();
let io: import("socket.io").Server | null = null;

export function attachAdminDashboardFeed(httpServer: HttpServer): void {
  // Dynamic import keeps unit tests free of socket.io peer dep issues when unused.
  void import("socket.io")
    .then(({ Server }) => {
      io = new Server(httpServer, {
        path: "/socket.io",
        cors: { origin: true, credentials: true },
      });
      io.of("/admin-dashboard").on("connection", (socket) => {
        const cityId = String(socket.handshake.query["cityId"] ?? "");
        if (cityId) socket.join(`city:${cityId}`);
      });
      logger.info("Socket.IO admin-dashboard namespace ready");
    })
    .catch((err) => {
      logger.warn({ err }, "socket.io unavailable; admin feed aggregates are in-memory only");
    });
}

export function recordAdminAttendanceMark(cityId: string): void {
  if (!cityId) return;
  let bucket = buckets.get(cityId);
  if (!bucket) {
    bucket = { count: 0, timer: null };
    buckets.set(cityId, bucket);
  }
  bucket.count += 1;
  if (!bucket.timer) {
    bucket.timer = setTimeout(() => {
      const b = buckets.get(cityId);
      if (!b) return;
      const count = b.count;
      b.count = 0;
      b.timer = null;
      if (count > 0) {
        io?.of("/admin-dashboard").to(`city:${cityId}`).emit("attendance.marks_aggregate", {
          city_id: cityId,
          count,
          window_ms: WINDOW_MS,
        });
      }
    }, WINDOW_MS);
    if (typeof bucket.timer === "object" && "unref" in bucket.timer) {
      (bucket.timer as NodeJS.Timeout).unref();
    }
  }
}
