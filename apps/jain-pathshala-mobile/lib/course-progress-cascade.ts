/**
 * Learner convenience fan-out for section ↔ subsection completion alignment.
 * Explicit UPSERTs only (complete direction); regressions do not cascade.
 */
import type { CourseProgressStatus } from "@/lib/course-labels";
import type {
  CourseTreeSection,
  CourseTreeSubsection,
} from "@/lib/queries";

export type ProgressWrite = {
  nodeId: string;
  nodeKind: "section" | "subsection";
  student_id: string;
  status: CourseProgressStatus;
};

type Mutate = (input: ProgressWrite) => Promise<unknown>;

/** Section → completed also completes every uncertified, non-completed subsection. */
export async function applySectionStatusCascade(opts: {
  section: CourseTreeSection;
  status: CourseProgressStatus;
  studentId: string;
  mutate: Mutate;
}): Promise<void> {
  const { section, status, studentId, mutate } = opts;
  await mutate({
    nodeId: section.id,
    nodeKind: "section",
    student_id: studentId,
    status,
  });

  if (status !== "completed") return;

  for (const sub of section.subsections) {
    if (sub.certified_at) continue;
    if (sub.status === "completed") continue;
    await mutate({
      nodeId: sub.id,
      nodeKind: "subsection",
      student_id: studentId,
      status: "completed",
    });
  }
}

/**
 * Subsection write; if status is completed and every sibling is completed
 * (including this one), also complete the parent section when not certified.
 */
export async function applySubsectionStatusCascade(opts: {
  section: CourseTreeSection;
  subsection: CourseTreeSubsection;
  status: CourseProgressStatus;
  studentId: string;
  mutate: Mutate;
}): Promise<void> {
  const { section, subsection, status, studentId, mutate } = opts;
  await mutate({
    nodeId: subsection.id,
    nodeKind: "subsection",
    student_id: studentId,
    status,
  });

  if (status !== "completed") return;
  if (section.certified_at) return;

  const allDone = section.subsections.every((sub) => {
    if (sub.id === subsection.id) return true;
    return sub.status === "completed" || !!sub.certified_at;
  });
  if (!allDone) return;
  if (section.status === "completed") return;

  await mutate({
    nodeId: section.id,
    nodeKind: "section",
    student_id: studentId,
    status: "completed",
  });
}
