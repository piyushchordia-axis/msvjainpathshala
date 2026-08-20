/**
 * Socket.IO `/push-quizzes/:quizId` — the live push-quiz feed CLAUDE.md mandates.
 *
 * The module was explicitly polling-only, and the admin roster refreshed every
 * 5 seconds per open tab. For a feature whose whole point is a Guruji watching
 * a class answer in real time, that is both too slow to feel live and too
 * chatty to leave open — and it was the one namespace of the three in
 * CLAUDE.md that had never been built.
 *
 * Mirrors shivir-feed.ts deliberately, down to reusing its
 * `extractSocketAccessToken`: the web admin cannot put a token in `auth` because
 * its access token lives in an httpOnly cookie, so the cookie has to be an
 * accepted source there too. One copy of that rule, not two.
 *
 * The join gate reuses `quizVisibleToAdmin`, the same predicate the HTTP roster
 * uses. If the C1 read rule changes, the socket rule changes with it.
 */
import type { Namespace, Socket } from "socket.io";
import { db, push_quizzes, students, centres, type User } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { verifyAccessToken } from "./tokens";
import { loadAuthUser } from "./auth-user-cache";
import { quizVisibleToAdmin } from "./quiz-admin-scope";
import { quizMatchesStudent } from "./quiz-scope";
import { ownedStudentsCondition } from "./route-helpers";
import { extractSocketAccessToken } from "./shivir-feed";
import { getIo, onSocketServer } from "./socket-server";
import { logger } from "./logger";
import { canAccessAdminPanel } from "@workspace/api-zod";

const NAMESPACE_RE =
  /^\/push-quizzes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Two audiences, two payloads.
 *
 * CLAUDE.md names this namespace's audience as "participants of that push
 * quiz", and the review wants the Guruji's roster to stop polling. Both are
 * legitimate, but they must NOT receive the same thing: a roster event carries
 * another child's id and score, which no participant may see.
 *
 * So lifecycle events (`started`, `ended`) go to the whole namespace, and
 * roster events go only to the `staff` room, which only admin-panel roles that
 * pass the C1 read gate join.
 */
export type PushQuizLifecycleEvent =
  | { type: "started"; question_count: number }
  | { type: "ended" };

export type PushQuizRosterEvent = {
  type: "submitted";
  student_id: string;
  score: number;
  submitted_count: number;
};

const STAFF_ROOM = "staff";

/**
 * @internal — the join gate, exported for tests.
 *
 * A participant is a student/parent the quiz actually targets, decided by the
 * same `quizMatchesStudent` rule the take flow uses — not merely "is logged
 * in", or anyone could watch any class.
 */
export async function authenticatePushQuizSocket(
  namespaceName: string,
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, unknown> },
): Promise<{ user: User; pushQuizId: string; isStaff: boolean } | { error: string }> {
  const match = NAMESPACE_RE.exec(namespaceName);
  if (!match) return { error: "bad_namespace" };
  const pushQuizId = match[1]!;

  const token = extractSocketAccessToken(handshake);
  if (!token) return { error: "unauthenticated" };
  const verified = verifyAccessToken(token);
  if (!verified) return { error: "invalid_token" };
  const user = await loadAuthUser(verified.uid);
  if (!user || !user.is_active || user.deleted_at) return { error: "inactive" };

  const [pq] = await db
    .select()
    .from(push_quizzes)
    .where(eq(push_quizzes.id, pushQuizId))
    .limit(1);
  if (!pq) return { error: "not_found" };

  if (canAccessAdminPanel(user.role)) {
    // Staff: the same read gate as GET /push/:id/attempts (C1).
    if (!(await quizVisibleToAdmin(user as User, pq))) return { error: "forbidden" };
    return { user: user as User, pushQuizId, isStaff: true };
  }

  // Participant: a student of theirs must be targeted by this quiz.
  const owned = await db
    .select({
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      age_group: students.age_group,
      city_id: centres.city_id,
      state_id: centres.state_id,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(and(ownedStudentsCondition(user.id), eq(students.status, "active")));

  const targeted = owned.some((s) =>
    quizMatchesStudent(pq, s, s.city_id ?? null, s.state_id ?? null),
  );
  if (!targeted) return { error: "forbidden" };

  return { user: user as User, pushQuizId, isStaff: false };
}

export function attachPushQuizFeed(): void {
  onSocketServer((server) => {
    server.of(NAMESPACE_RE).use(async (socket: Socket, next: (err?: Error) => void) => {
      const nsp = (socket.nsp as Namespace).name;
      const result = await authenticatePushQuizSocket(nsp, socket.handshake);
      if ("error" in result) {
        next(new Error(result.error));
        return;
      }
      socket.data.user = result.user;
      socket.data.pushQuizId = result.pushQuizId;
      socket.data.isStaff = result.isStaff;
      next();
    });
    server.of(NAMESPACE_RE).on("connection", (socket: Socket) => {
      if (socket.data.isStaff === true) socket.join(STAFF_ROOM);
    });
    logger.info("Socket.IO push-quiz namespace ready");
  });
}

/**
 * Lifecycle — safe for everyone in the namespace. This is what lets a student
 * sitting in the runner learn the quiz ended, which polling could not tell them
 * because polling is paused during an attempt (H9).
 *
 * Fire-and-forget by design: the quiz is already committed, so a socket problem
 * must never turn a started quiz into a failed one. Polling stays the fallback.
 */
export function emitPushQuizEvent(pushQuizId: string, event: PushQuizLifecycleEvent): void {
  const io = getIo();
  if (!io || !pushQuizId) return;
  try {
    io.of(`/push-quizzes/${pushQuizId}`).emit("push_quiz.update", {
      push_quiz_id: pushQuizId,
      ...event,
    });
  } catch (err) {
    logger.warn({ err, pushQuizId }, "push quiz feed emit failed");
  }
}

/**
 * Roster — STAFF ONLY. Carries another child's id and score, so it goes to the
 * staff room rather than the namespace. Getting this wrong would leak one
 * student's result to every other student in the class.
 */
export function emitPushQuizRosterEvent(pushQuizId: string, event: PushQuizRosterEvent): void {
  const io = getIo();
  if (!io || !pushQuizId) return;
  try {
    io.of(`/push-quizzes/${pushQuizId}`)
      .to(STAFF_ROOM)
      .emit("push_quiz.roster", { push_quiz_id: pushQuizId, ...event });
  } catch (err) {
    logger.warn({ err, pushQuizId }, "push quiz roster emit failed");
  }
}
