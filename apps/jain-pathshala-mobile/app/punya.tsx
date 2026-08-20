/**
 * L11 — the Punya ledger, reachable by a parent.
 *
 * The screen existed only as a tab under `app/student/`, gated
 * `allowed={["student"]}`, and the parent's home Punya card was a plain
 * <Card> rather than a Pressable. PARENT_ACTIONS had no Punya entry either. So
 * a parent could see their child's total and their tier, and had no route to
 * the ledger behind it from anywhere in the app — including when points were
 * reversed and they wanted to know why.
 *
 * The screen already reads through SessionViewContext and renders a
 * ChildSwitcher, which is exactly the parent's shape, so it needs no
 * parent-specific variant — only a route that is not inside the student tabs.
 */
export { default } from "./student/punya";
