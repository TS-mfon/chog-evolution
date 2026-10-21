import { ApiError } from "./config.js";

export type PageCursor = { t: string; i: string };
const MAX_CURSOR_LENGTH = 500;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function pageLimit(value: unknown): number {
  const limit =
    typeof value === "string" && /^[1-9]\d{0,2}$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new ApiError("invalid_page_limit", 400);
  return limit;
}

function validCursor(value: unknown): value is PageCursor {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "t") ||
    !Object.hasOwn(value, "i")
  )
    return false;
  const { t, i } = value as PageCursor;
  return (
    typeof t === "string" &&
    TIMESTAMP.test(t) &&
    Number.isFinite(Date.parse(t)) &&
    new Date(t).toISOString() === t &&
    typeof i === "string" &&
    IDENTIFIER.test(i)
  );
}

const encode = (cursor: PageCursor) =>
  Buffer.from(JSON.stringify({ t: cursor.t, i: cursor.i })).toString(
    "base64url",
  );

export function parsePage(value: unknown = {}): {
  limit: number;
  cursor?: PageCursor;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError("invalid_page_query", 400);
  const query = value as { limit?: unknown; cursor?: unknown };
  const limit = pageLimit(
    Object.hasOwn(query, "limit") && query.limit !== undefined
      ? query.limit
      : 25,
  );
  if (!Object.hasOwn(query, "cursor") || query.cursor === undefined)
    return { limit };
  try {
    if (
      typeof query.cursor !== "string" ||
      query.cursor.length > MAX_CURSOR_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(query.cursor)
    )
      throw new Error();
    const decoded: unknown = JSON.parse(
      Buffer.from(query.cursor, "base64url").toString("utf8"),
    );
    // A single canonical representation rejects padding, duplicate JSON keys,
    // invalid UTF-8 and permissively decoded base64 aliases.
    if (!validCursor(decoded) || encode(decoded) !== query.cursor)
      throw new Error();
    return { limit, cursor: decoded };
  } catch {
    throw new ApiError("invalid_page_cursor", 400);
  }
}

/** Scope this filter to the authorized owner, then sort both keys in direction. */
export function pageQuery(cursor?: PageCursor, direction: 1 | -1 = -1) {
  if (direction !== 1 && direction !== -1)
    throw new ApiError("invalid_page_direction", 400);
  if (cursor === undefined) return {};
  if (!validCursor(cursor)) throw new ApiError("invalid_page_cursor", 400);
  const operator = direction === -1 ? "$lt" : "$gt";
  return {
    $or: [
      { created_at: { [operator]: new Date(cursor.t) } },
      { created_at: new Date(cursor.t), _id: { [operator]: cursor.i } },
    ],
  };
}

type PageRow = {
  _id?: unknown;
  id?: string;
  created_at?: Date;
  createdAt?: string;
};
function rowCursor(row: PageRow): PageCursor {
  const id = row._id ?? row.id;
  const date = row.created_at ?? row.createdAt;
  if (
    typeof id !== "string" ||
    !IDENTIFIER.test(id) ||
    (!(date instanceof Date) && typeof date !== "string") ||
    !Number.isFinite(Number(new Date(date)))
  )
    throw new ApiError("page_row_invalid", 500);
  const cursor = { t: new Date(date).toISOString(), i: id };
  if (!validCursor(cursor)) throw new ApiError("page_row_invalid", 500);
  return cursor;
}

/** Fetch limit + 1 using {created_at, _id} in the same order as pageQuery. */
export function paginateRows<T extends PageRow, R = T>(
  rows: readonly T[],
  limit: number,
  mapper: (row: T) => R = (row) => row as unknown as R,
): { items: R[]; nextCursor: string | null } {
  pageLimit(limit);
  const cursors = rows.map(rowCursor);
  let direction = 0;
  const ids = new Set<string>();
  for (let index = 0; index < cursors.length; index++) {
    const current = cursors[index]!;
    if (ids.has(current.i)) throw new ApiError("page_order_invalid", 500);
    ids.add(current.i);
    const previous = cursors[index - 1];
    if (!previous) continue;
    const order =
      previous.t === current.t
        ? previous.i < current.i
          ? 1
          : -1
        : previous.t < current.t
          ? 1
          : -1;
    if (direction !== 0 && order !== direction)
      throw new ApiError("page_order_invalid", 500);
    direction = order;
  }
  const visible = rows.slice(0, limit);
  const last = cursors[visible.length - 1];
  // Use the stored row, not the mapper's potentially lossy/renamed representation.
  return {
    items: visible.map(mapper),
    nextCursor: rows.length > limit && last ? encode(last) : null,
  };
}
