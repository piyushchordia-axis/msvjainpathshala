import type { Href } from "expo-router";

/**
 * X-9 (review 2026-08) — deep links were dead for eleven of twelve emitters:
 * the client read ONLY `data.route`, and only quiz-notify.ts ever set it.
 * `data.route` is still honoured first (an emitter can be precise about
 * where a tap should land), but this now also maps `kind` + whatever entity
 * id came along for the ride to a real screen, so an emitter that only ever
 * sets `kind` and an id still deep-links correctly. Shared by the push-tap
 * handler (app/_layout.tsx) and the inbox's tap-through (NotificationsInbox).
 */
export function routeForNotificationData(data: unknown): Href {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.route === "string" && d.route.startsWith("/")) {
    return d.route as Href;
  }

  const kind = typeof d.kind === "string" ? d.kind : "";
  const str = (key: string): string | null => (typeof d[key] === "string" ? (d[key] as string) : null);

  switch (kind) {
    case "homework": {
      const id = str("assignment_id");
      return (id ? `/homework-assignment/${id}` : "/homework") as Href;
    }
    case "quiz":
      return "/quizzes" as Href;
    case "shivir": {
      const id = str("shivir_id");
      return (id ? `/shivir/${id}` : "/shivirs") as Href;
    }
    case "gallery":
      return "/gallery" as Href;
    case "library": {
      const id = str("library_item_id");
      return (id ? `/library/item/${id}` : "/library/index") as Href;
    }
    case "niyam_approved":
    case "niyam_rejected":
    case "niyam_badge":
      return "/niyam-submissions" as Href;
    case "attendance":
    case "attendance_streak":
      return "/my-attendance" as Href;
    case "notice":
      return "/notices" as Href;
    default:
      return "/notifications" as Href;
  }
}
