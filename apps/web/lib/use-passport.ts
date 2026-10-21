"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, friendlyError, isAbort, pagePath, UserError } from "./api";
import type { Passport } from "./types";

export function usePassport(
  id?: string,
  version?: number,
  artworkUrl?: string,
) {
  const [passport, setPassport] = useState<Passport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const pageCount = useRef(1);
  const scope = useRef(id);
  const moreController = useRef<AbortController | null>(null);
  if (scope.current !== id) {
    scope.current = id;
    pageCount.current = 1;
  }
  useEffect(() => {
    moreController.current?.abort();
    setLoadingMore(false);
    setMoreError("");
    if (!id) {
      setPassport(null);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPassport((current) => (current?.profile.id === id ? current : null));
    void (async () => {
      let combined: Passport | null = null;
      const seen = new Set<string>();
      let cursor: string | null | undefined;
      for (let page = 0; page < pageCount.current; page++) {
        const result = await api<{ item: Passport }>(
          pagePath(`/v1/passports/${encodeURIComponent(id)}`, cursor),
          { signal: controller.signal },
        );
        combined = combined
          ? {
              ...result.item,
              history: [...combined.history, ...result.item.history],
            }
          : result.item;
        cursor = result.item.nextCursor;
        if (!cursor) break;
        if (seen.has(cursor))
          throw new UserError(
            "The next chapter couldn’t load. Refresh the history to try again.",
          );
        seen.add(cursor);
      }
      return combined;
    })()
      .then((result) => {
        if (controller.signal.aborted) return;
        setPassport(result);
        setLoading(false);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && !isAbort(cause)) {
          setError(friendlyError(cause));
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [id, version, artworkUrl, revision]);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const loadMore = useCallback(async () => {
    if (
      !id ||
      !passport?.nextCursor ||
      passport.profile.id !== id ||
      loadingMore ||
      loading
    )
      return;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreError("");
    try {
      const result = await api<{ item: Passport }>(
        pagePath(
          `/v1/passports/${encodeURIComponent(id)}`,
          passport.nextCursor,
        ),
        { signal: controller.signal },
      );
      if (controller.signal.aborted || scope.current !== id) return;
      if (result.item.nextCursor === passport.nextCursor)
        throw new UserError(
          "The next chapter couldn’t load. Refresh the history to try again.",
        );
      setPassport((current) =>
        current?.profile.id === id
          ? {
              ...result.item,
              history: [
                ...new Map(
                  [...current.history, ...result.item.history].map((event) => [
                    event.id,
                    event,
                  ]),
                ).values(),
              ],
            }
          : current,
      );
      pageCount.current++;
    } catch (cause) {
      if (!controller.signal.aborted && !isAbort(cause))
        setMoreError(friendlyError(cause));
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [id, passport, loading, loadingMore]);
  return {
    passport: passport?.profile.id === id ? passport : null,
    error,
    loading,
    refresh,
    loadMore,
    loadingMore,
    moreError,
  };
}
