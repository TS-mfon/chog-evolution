import { createHash } from "node:crypto";
import { ApiError } from "./config.js";

export const X_PARSER_VERSION = "public-x-hydration-v2";
export const MAX_PUBLIC_SOURCE_BYTES = 2 * 1024 * 1024;
const usernamePattern = /^[A-Za-z0-9_]{1,15}$/;
const idPattern = /^[1-9]\d{0,24}$/;
const record = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function xSourceMode(): "public_page" | "api" | "disabled" {
  // A leftover API credential must never silently change the public-source policy.
  const mode = process.env.X_SOURCE_MODE ?? "public_page";
  if (mode !== "public_page" && mode !== "api" && mode !== "disabled")
    throw new ApiError("x_source_configuration_invalid");
  return mode;
}

export async function boundedSource(
  url: URL,
  request: typeof fetch = fetch,
  maximum = MAX_PUBLIC_SOURCE_BYTES,
  options: {
    accept?: string;
    onBytes?: (bytes: number) => void;
    headers?: Record<string, string>;
  } = {},
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    maximum > 20 * 1024 * 1024
  )
    throw new ApiError("evidence_source_too_large", 422);
  let response: Response;
  try {
    response = await request(url, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CHOG-Public-Evidence/1.0)",
        accept: options.accept ?? "text/html,application/json;q=0.9",
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError("evidence_source_unavailable");
  }
  try {
    if (
      response.redirected ||
      (response.url && new URL(response.url).href !== url.href)
    )
      throw new ApiError("evidence_provider_redirect_rejected", 422);
    if (!response.ok)
      throw new ApiError(
        response.status === 404 || response.status === 410
          ? "evidence_source_not_found"
          : response.status === 429
            ? "evidence_provider_rate_limited"
            : "evidence_source_unavailable",
        response.status === 404 || response.status === 410 ? 422 : 503,
      );
    if (Number(response.headers.get("content-length")) > maximum)
      throw new ApiError("evidence_source_too_large", 422);
    if (!response.body) throw new ApiError("evidence_source_empty", 422);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError("evidence_provider_response_invalid");
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      options.onBytes?.(part.value.byteLength);
      if (total > maximum) throw new ApiError("evidence_source_too_large", 422);
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("evidence_source_unavailable");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!total) throw new ApiError("evidence_source_empty", 422);
  return Buffer.concat(chunks, total);
}

function stringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let position = start + 1; position < source.length; position++) {
    if (source[position] === "\\") position++;
    else if (source[position] === quote) return position + 1;
  }
  return source.length;
}

/** Read scalar JSON strings from hydration properties, never execute page JavaScript.
 * Tokenizing strings/comments prevents a post's text from impersonating a data record. */
function hydrationRecords(script: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  for (let index = 0; index < script.length;) {
    const character = script[index]!;
    if (character === "/" && script[index + 1] === "/") {
      const end = script.indexOf("\n", index + 2);
      index = end < 0 ? script.length : end + 1;
      continue;
    }
    if (character === "/" && script[index + 1] === "*") {
      const end = script.indexOf("*/", index + 2);
      index = end < 0 ? script.length : end + 2;
      continue;
    }
    let key: string | undefined;
    let end = index + 1;
    if (character === '"' || character === "'" || character === "`") {
      end = stringEnd(script, index);
      if (character === '"' && script.slice(index, end) === '"value"')
        key = "value";
    } else if (/[A-Za-z_$]/.test(character)) {
      while (end < script.length && /[A-Za-z0-9_$]/.test(script[end]!)) end++;
      key = script.slice(index, end);
    }
    if (key === "value") {
      let previous = index - 1;
      while (previous >= 0 && /\s/.test(script[previous]!)) previous--;
      if (script[previous] !== "{" && script[previous] !== ",") {
        index = end;
        continue;
      }
      let position = end;
      while (position < script.length && /\s/.test(script[position]!))
        position++;
      if (script[position] === ":") {
        position++;
        while (position < script.length && /\s/.test(script[position]!))
          position++;
        if (script[position] === '"') {
          const valueEnd = stringEnd(script, position);
          try {
            const encoded: unknown = JSON.parse(
              script.slice(position, valueEnd),
            );
            if (typeof encoded === "string") {
              const decoded: unknown = JSON.parse(encoded);
              if (record(decoded)) rows.push(decoded);
            }
          } catch {
            /* Non-JSON hydration strings carry no verification data. */
          }
          end = valueEnd;
        }
      }
    }
    index = end;
  }
  return rows;
}

export function xRecords(html: string): Record<string, any>[] {
  if (Buffer.byteLength(html) > MAX_PUBLIC_SOURCE_BYTES)
    throw new ApiError("evidence_source_too_large", 422);
  const records: Record<string, any>[] = [];
  // Some anonymous provider responses expose the same GraphQL object as JSON.
  if (html.trimStart().startsWith("{")) {
    try {
      const value: unknown = JSON.parse(html);
      if (record(value)) records.push(value);
    } catch {
      /* HTML follows below. */
    }
  }
  // Advance past each entire script once; unclosed tags cannot cause quadratic rescans.
  const openings = /<script\b/gi;
  const closings = /<\/script\s*>/gi;
  for (let match = openings.exec(html); match; match = openings.exec(html)) {
    const start = html.indexOf(">", openings.lastIndex);
    if (start < 0) break;
    closings.lastIndex = start + 1;
    const closing = closings.exec(html);
    if (!closing) break;
    const attributes = html.slice(openings.lastIndex, start);
    const script = html.slice(start + 1, closing.index);
    openings.lastIndex = closings.lastIndex;
    if (
      /\btype\s*=\s*(?:["']application\/json["']|application\/json(?:\s|$))/i.test(
        attributes,
      )
    ) {
      try {
        const value: unknown = JSON.parse(script);
        if (record(value)) records.push(value);
      } catch {
        /* Fail closed for invalid data. */
      }
    } else {
      records.push(...hydrationRecords(script));
    }
  }
  return records;
}

function rootResults(html: string, roots: string[]): Record<string, any>[] {
  return xRecords(html).flatMap((row) =>
    roots.flatMap((root) => {
      const value = row.data?.[root]?.result;
      return record(value) ? [value] : [];
    }),
  );
}

function userIdentity(user: any, additionalIds: unknown[] = []) {
  if (
    !record(user) ||
    (user.__typename !== undefined && user.__typename !== "User")
  )
    return null;
  const ids = [user.rest_id, user.legacy?.id_str, ...additionalIds].filter(
    (id) => id !== undefined,
  );
  const names = [user.core?.screen_name, user.legacy?.screen_name].filter(
    (name) => name !== undefined,
  );
  if (
    !ids.length ||
    ids.some(
      (id) => typeof id !== "string" || !idPattern.test(id) || id !== ids[0],
    ) ||
    !names.length ||
    names.some(
      (name) =>
        typeof name !== "string" ||
        !usernamePattern.test(name) ||
        name.toLowerCase() !== String(names[0]).toLowerCase(),
    )
  )
    return null;
  return { id: ids[0] as string, username: names[0] as string };
}

const digest = (value: string) =>
  `0x${createHash("sha256").update(value).digest("hex")}`;
export function parseXProfile(html: string, username: string) {
  if (typeof username !== "string" || !usernamePattern.test(username))
    throw new ApiError("valid_x_username_required", 400);
  const profiles = rootResults(html, [
    "user_result_by_screen_name",
    "user",
  ]).flatMap((row) => {
    const targetsUsername = [
      row.core?.screen_name,
      row.legacy?.screen_name,
    ].some(
      (name) =>
        typeof name === "string" &&
        name.toLowerCase() === username.toLowerCase(),
    );
    if (!targetsUsername) return [];
    const identity = userIdentity(row);
    const description = row.profile_bio?.description ?? row.legacy?.description;
    if (
      !identity ||
      identity.username.toLowerCase() !== username.toLowerCase() ||
      typeof description !== "string" ||
      description.length > 2048 ||
      (row.profile_bio?.description !== undefined &&
        row.legacy?.description !== undefined &&
        row.profile_bio.description !== row.legacy.description)
    )
      throw new ApiError("x_public_profile_unreadable");
    return [{ ...identity, description }];
  });
  if (
    !profiles.length ||
    profiles.some(
      (profile) =>
        profile.id !== profiles[0]!.id ||
        profile.username.toLowerCase() !==
          profiles[0]!.username.toLowerCase() ||
        profile.description !== profiles[0]!.description,
    )
  )
    throw new ApiError("x_public_profile_unreadable");
  return profiles[0]!;
}

export async function readPublicXProfile(
  username: string,
  request: typeof fetch = fetch,
) {
  if (typeof username !== "string" || !usernamePattern.test(username))
    throw new ApiError("valid_x_username_required", 400);
  const url = new URL(`https://x.com/${username}`);
  try {
    const profile = parseXProfile(
      (await boundedSource(url, request)).toString("utf8"),
      username,
    );
    return {
      ...profile,
      source: {
        method: "public_x_profile_snapshot",
        url: url.toString(),
        fetchedAt: new Date().toISOString(),
        contentHash: digest(JSON.stringify(profile)),
        parserVersion: X_PARSER_VERSION,
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === "evidence_source_not_found")
      return null;
    throw error;
  }
}

export type PublicXMedia = {
  sourceUrl: string;
  type: string;
  postId: string;
  status?: string;
  errorCode?: string;
};

function postMedia(
  post: Record<string, any>,
  postId: string,
  authorId: string,
): PublicXMedia[] {
  const rows =
    post.media_entities2 ?? post.legacy?.extended_entities?.media ?? [];
  if (!Array.isArray(rows)) throw new ApiError("x_public_post_unreadable");
  return rows.slice(0, 4).map((value): PublicXMedia => {
    const item = record(value) ? value : {};
    const declaredAuthor = item.source_user_id_str ?? item.source_user_id;
    const declaredPost =
      declaredAuthor !== undefined && declaredAuthor !== authorId
        ? ""
        : (item.source_status_id_str ?? item.source_status_id ?? postId);
    const image =
      item.media_info?.__typename === "ApiImage" ? item.media_info : null;
    const sourceUrl = item.media_url_https ?? image?.original_img_url;
    const type =
      typeof item.type === "string"
        ? item.type
        : image
          ? "photo"
          : "unsupported";
    return {
      sourceUrl:
        typeof sourceUrl === "string" && sourceUrl.length <= 2048
          ? sourceUrl
          : "",
      type,
      postId: typeof declaredPost === "string" ? declaredPost : "",
      ...(declaredPost !== postId
        ? { status: "unavailable", errorCode: "source_image_post_mismatch" }
        : {}),
    };
  });
}

function parsePost(row: Record<string, any>, postId: string) {
  if (row.__typename === "TweetWithVisibilityResults") row = row.tweet;
  if (
    !record(row) ||
    row.rest_id !== postId ||
    (row.__typename !== undefined && row.__typename !== "Tweet") ||
    (row.legacy?.id_str !== undefined && row.legacy.id_str !== postId)
  )
    return null;
  const author = row.core?.user_results;
  const identity = userIdentity(author?.result, [
    author?.rest_id,
    row.legacy?.user_id_str,
  ]);
  const text =
    row.note_tweet?.note_tweet_results?.result?.text ??
    row.details?.full_text ??
    row.legacy?.full_text;
  if (!identity || typeof text !== "string" || text.length > 10_000)
    throw new ApiError("x_public_post_unreadable");
  const timestamp = row.details?.created_at_ms ?? row.legacy?.created_at;
  let created_at: string | null = null;
  if (timestamp !== undefined && timestamp !== null) {
    if (
      (typeof timestamp !== "number" && typeof timestamp !== "string") ||
      (typeof timestamp === "number" &&
        (!Number.isSafeInteger(timestamp) || timestamp < 0)) ||
      (typeof timestamp === "string" && timestamp.length > 100)
    )
      throw new ApiError("x_public_post_unreadable");
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime()))
      throw new ApiError("x_public_post_unreadable");
    created_at = date.toISOString();
  }
  return {
    id: postId,
    text,
    author_id: identity.id,
    username: identity.username,
    created_at,
    media: postMedia(row, postId, identity.id),
  };
}

export function parseXPost(html: string, postId: string) {
  if (typeof postId !== "string" || !idPattern.test(postId))
    throw new ApiError("x_post_url_required", 422);
  const posts = rootResults(html, ["tweet_result_by_rest_id", "tweetResult"])
    .map((row) => parsePost(row, postId))
    .filter((post) => post !== null);
  if (
    !posts.length ||
    posts.some((post) => JSON.stringify(post) !== JSON.stringify(posts[0]))
  )
    throw new ApiError("x_public_post_unreadable");
  return posts[0]!;
}

export async function readPublicXPost(
  username: string,
  postId: string,
  request: typeof fetch = fetch,
) {
  if (
    typeof username !== "string" ||
    !usernamePattern.test(username) ||
    typeof postId !== "string" ||
    !idPattern.test(postId)
  )
    throw new ApiError("x_post_url_required", 422);
  const url = new URL(`https://x.com/${username}/status/${postId}`);
  const post = parseXPost(
    (await boundedSource(url, request)).toString("utf8"),
    postId,
  );
  if (post.username.toLowerCase() !== username.toLowerCase())
    throw new ApiError("x_public_post_author_mismatch", 422);
  return { ...post, parserVersion: X_PARSER_VERSION };
}
