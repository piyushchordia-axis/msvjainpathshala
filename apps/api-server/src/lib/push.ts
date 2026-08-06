/**
 * Expo push notifications (server-side). No paid account required.
 * Ticket + receipt handling deactivates dead tokens (FIX #3).
 */
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, device_push_tokens, push_receipts } from "@workspace/db";
import { logger } from "./logger";

const expo = new Expo();

const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);

export function isValidExpoPushToken(token: string): boolean {
  return Expo.isExpoPushToken(token);
}

export interface PushPayload {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

async function deactivateTokens(tokens: string[]): Promise<void> {
  const unique = [...new Set(tokens)].filter(Boolean);
  if (unique.length === 0) return;
  await db
    .update(device_push_tokens)
    .set({ is_active: false, updated_at: new Date() })
    .where(inArray(device_push_tokens.expo_token, unique));
}

function ticketErrorCode(ticket: ExpoPushTicket): string | null {
  if (ticket.status !== "error") return null;
  const details = ticket.details as { error?: string } | undefined;
  return details?.error ?? null;
}

/**
 * Send push notifications, chunked. Invalid tokens are dropped silently.
 * Maps each ticket back to its expo_token so DeviceNotRegistered /
 * InvalidCredentials can deactivate that row. Persists 'ok' ticket ids for
 * the receipt sweep. Never throws — push is best-effort.
 */
export async function sendPush(payloads: PushPayload[]): Promise<ExpoPushTicket[]> {
  const messages: ExpoPushMessage[] = [];
  for (const p of payloads) {
    const tokens = (Array.isArray(p.to) ? p.to : [p.to]).filter(isValidExpoPushToken);
    for (const token of tokens) {
      messages.push({
        to: token,
        sound: "default",
        title: p.title,
        body: p.body,
        data: p.data ?? {},
      });
    }
  }
  if (messages.length === 0) return [];

  const tickets: ExpoPushTicket[] = [];
  const deadTokens: string[] = [];
  const okReceipts: Array<{ ticket_id: string; expo_token: string }> = [];

  try {
    for (const chunk of expo.chunkPushNotifications(messages)) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < chunkTickets.length; i++) {
        const ticket = chunkTickets[i]!;
        const token = String(chunk[i]?.to ?? "");
        tickets.push(ticket);
        const err = ticketErrorCode(ticket);
        if (err && DEAD_TOKEN_ERRORS.has(err) && token) {
          deadTokens.push(token);
          continue;
        }
        if (ticket.status === "ok" && ticket.id && token) {
          okReceipts.push({ ticket_id: ticket.id, expo_token: token });
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Expo push send failed");
    return tickets;
  }

  try {
    if (deadTokens.length > 0) {
      await deactivateTokens(deadTokens);
    }
    if (okReceipts.length > 0) {
      await db
        .insert(push_receipts)
        .values(okReceipts)
        .onConflictDoNothing({ target: push_receipts.ticket_id });
    }
  } catch (err) {
    logger.warn({ err }, "push ticket post-process failed");
  }

  return tickets;
}

/**
 * Sweep unchecked Expo receipts: deactivate dead tokens, stamp checked_at,
 * delete rows older than 7 days (Expo does not retain receipts beyond that).
 */
export async function sweepPushReceipts(): Promise<{
  checked: number;
  deactivated: number;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db.delete(push_receipts).where(lt(push_receipts.created_at, sevenDaysAgo));

  const unchecked = await db
    .select({
      id: push_receipts.id,
      ticket_id: push_receipts.ticket_id,
      expo_token: push_receipts.expo_token,
    })
    .from(push_receipts)
    .where(isNull(push_receipts.checked_at))
    .limit(1000);

  if (unchecked.length === 0) {
    return { checked: 0, deactivated: 0 };
  }

  const tokenByTicket = new Map(unchecked.map((r) => [r.ticket_id, r.expo_token]));
  const deadTokens: string[] = [];
  const checkedTicketIds: string[] = [];
  const ticketIds = unchecked.map((r) => r.ticket_id);

  try {
    for (const chunk of expo.chunkPushNotificationReceiptIds(ticketIds)) {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const ticketId of chunk) {
        checkedTicketIds.push(ticketId);
        const receipt = receipts[ticketId];
        if (!receipt || receipt.status !== "error") continue;
        const err =
          (receipt.details as { error?: string } | undefined)?.error ?? null;
        if (err && DEAD_TOKEN_ERRORS.has(err)) {
          const token = tokenByTicket.get(ticketId);
          if (token) deadTokens.push(token);
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Expo receipt sweep failed");
  }

  if (deadTokens.length > 0) {
    await deactivateTokens(deadTokens);
  }
  if (checkedTicketIds.length > 0) {
    await db
      .update(push_receipts)
      .set({ checked_at: new Date(), updated_at: new Date() })
      .where(
        and(
          inArray(push_receipts.ticket_id, checkedTicketIds),
          isNull(push_receipts.checked_at),
        ),
      );
  }

  return {
    checked: checkedTicketIds.length,
    deactivated: [...new Set(deadTokens)].length,
  };
}
