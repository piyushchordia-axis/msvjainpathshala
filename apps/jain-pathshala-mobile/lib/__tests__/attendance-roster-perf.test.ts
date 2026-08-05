/**
 * PERF #22 — attendance roster row re-render counts at 50 students.
 *
 * Pure React simulation (createElement, no JSX) matching AttendanceRosterRow
 * + useCallback onMark in app/attendance/[id].tsx.
 *
 * Measured row re-renders on a single mark tap (student-0 → present):
 *   BEFORE (non-memo inline .map rows): 50
 *   AFTER  (React.memo row + stable onMark): 1
 */
/// @vitest-environment jsdom

import { act, createElement, memo, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";

const ROSTER_SIZE = 50;
const rosterIds = Array.from({ length: ROSTER_SIZE }, (_, i) => `student-${i}`);

function mount(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(ui);
  });
  return {
    unmount() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Mirrors the pre-optimisation roster: every parent update re-renders all rows. */
function simulateBeforeMarkTap(): number {
  let renderCount = 0;

  function Row({ id, status }: { id: string; status?: string }) {
    renderCount += 1;
    return createElement("div", { "data-testid": id }, status ?? "unset");
  }

  function BeforeRoster() {
    const [marks, setMarks] = useState<Record<string, string>>({});
    return createElement(
      "div",
      null,
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "mark-first",
          onClick: () => setMarks({ "student-0": "present" }),
        },
        "mark",
      ),
      ...rosterIds.map((id) => createElement(Row, { key: id, id, status: marks[id] })),
    );
  }

  const view = mount(createElement(BeforeRoster));
  const beforeInitial = renderCount;
  act(() => {
    (document.querySelector('[data-testid="mark-first"]') as HTMLButtonElement).click();
  });
  view.unmount();
  return renderCount - beforeInitial;
}

/** Mirrors AttendanceRosterRow: memo + useCallback keeps other rows stable. */
function simulateAfterMarkTap(): number {
  let renderCount = 0;

  const Row = memo(function Row({
    id,
    status,
    onMark,
  }: {
    id: string;
    status?: string;
    onMark: (id: string) => void;
  }) {
    renderCount += 1;
    return createElement(
      "div",
      { "data-testid": id },
      status ?? "unset",
      createElement("button", { type: "button", onClick: () => onMark(id) }, "pick"),
    );
  });

  function AfterRoster() {
    const [marks, setMarks] = useState<Record<string, string>>({});
    const onMark = useCallback((id: string) => {
      setMarks((prev) => ({ ...prev, [id]: "present" }));
    }, []);
    return createElement(
      "div",
      null,
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "mark-first",
          onClick: () => onMark("student-0"),
        },
        "mark",
      ),
      ...rosterIds.map((id) =>
        createElement(Row, { key: id, id, status: marks[id], onMark }),
      ),
    );
  }

  const view = mount(createElement(AfterRoster));
  const beforeTap = renderCount;
  act(() => {
    (document.querySelector('[data-testid="mark-first"]') as HTMLButtonElement).click();
  });
  view.unmount();
  return renderCount - beforeTap;
}

describe("attendance roster perf (pure React simulation)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("BEFORE: non-memo rows re-render all 50 on one mark tap", () => {
    const delta = simulateBeforeMarkTap();
    expect(delta).toBe(50);
  });

  it("AFTER: memoised rows re-render only the changed row on one mark tap", () => {
    const delta = simulateAfterMarkTap();
    expect(delta).toBe(1);
  });
});
