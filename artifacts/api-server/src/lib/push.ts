/**
 * Expo push notifications (server-side). No paid account required.
 * Token storage is a module concern; this util just validates + sends.
 */
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { logger } from "./logger";

const expo = new Expo();

export function isValidExpoPushToken(token: string): boolean {
  return Expo.isExpoPushToken(token);
}

export interface PushPayload {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Send push notifications, chunked and de-duplicated. Invalid tokens are
 * dropped silently. Returns the tickets for any callers that want receipts.
 * Never throws — push is best-effort.
 */
export async function sendPush(payloads: PushPayload[]): Promise<ExpoPushTicket[]> {
  const messages: ExpoPushMessage[] = [];
  for (const p of payloads) {
    const tokens = (Array.isArray(p.to) ? p.to : [p.to]).filter(isValidExpoPushToken);
    for (const token of tokens) {
      messages.push({ to: token, sound: "default", title: p.title, body: p.body, data: p.data ?? {} });
    }
  }
  if (messages.length === 0) return [];

  const tickets: ExpoPushTicket[] = [];
  try {
    for (const chunk of expo.chunkPushNotifications(messages)) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }
  } catch (err) {
    logger.warn({ err }, "Expo push send failed");
  }
  return tickets;
}
