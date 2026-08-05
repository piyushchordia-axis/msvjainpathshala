/** Allow-list for PersistQueryClient — attendance + shikshak roster only. */
export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  const segment = queryKey[1];
  if (root === "shikshak") {
    return segment === "attendance-session" || segment === "today";
  }
  if (root === "me" && segment === "attendance") {
    return true;
  }
  return false;
}
