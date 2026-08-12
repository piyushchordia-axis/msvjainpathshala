import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "@/lib/api-client";
import type { LibraryAdminTree } from "./library-admin-types";

export function useLibraryAdminTree() {
  const [tree, setTree] = useState<LibraryAdminTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<LibraryAdminTree>("/v1/admin/library");
      setTree(data);
    } catch (err) {
      setTree(null);
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not load library.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tree, loading, error, reload, sections: tree?.sections ?? [] };
}
