import { createHash } from "node:crypto";
import { boundedSource, readPublicXProfile, xSourceMode } from "./public-x.js";
import { ApiError } from "./config.js";

export type PublicXProfile = {
  id: string;
  username: string;
  description: string;
};

export async function lookupXProfile(
  username: string,
  request: typeof fetch = fetch,
) {
  const mode = xSourceMode();
  if (mode === "disabled") throw new ApiError("x_source_disabled");
  if (mode === "public_page") return readPublicXProfile(username, request);
  if (!process.env.X_API_BEARER_TOKEN) throw new ApiError("x_api_unconfigured");
  const profile = await lookupPublicXProfile(
    username,
    process.env.X_API_BEARER_TOKEN,
    request,
  );
  return profile
    ? {
        ...profile,
        source: {
          method: "official_x_profile_snapshot",
          url: `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`,
          fetchedAt: new Date().toISOString(),
          contentHash: `0x${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`,
          parserVersion: "x-api-v2",
        },
      }
    : null;
}

/** Explicit compatibility API; anonymous lookupXProfile never calls this implicitly. */
export async function lookupPublicXProfile(
  requestedUsername: string,
  bearerToken: string,
  request: typeof fetch = fetch,
): Promise<PublicXProfile | null> {
  if (
    typeof requestedUsername !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/.test(requestedUsername)
  )
    throw new ApiError("valid_x_username_required", 400);
  let raw: Buffer;
  try {
    raw = await boundedSource(
      new URL(
        `https://api.x.com/2/users/by/username/${requestedUsername}?user.fields=description,username`,
      ),
      request,
      192 * 1024,
      {
        accept: "application/json",
        headers: { authorization: `Bearer ${bearerToken}` },
      },
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "evidence_source_not_found")
      return null;
    throw error;
  }
  let payload: any;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError("x_api_invalid_profile_response");
  }
  const data = payload?.data;
  if (
    !data ||
    Array.isArray(data) ||
    typeof data.id !== "string" ||
    !/^[1-9]\d{0,24}$/.test(data.id) ||
    typeof data.username !== "string" ||
    !/^[A-Za-z0-9_]{1,15}$/.test(data.username) ||
    typeof data.description !== "string" ||
    data.description.length > 2048
  )
    throw new ApiError("x_api_invalid_profile_response");
  if (data.username.toLowerCase() !== requestedUsername.toLowerCase())
    return null;
  return {
    id: data.id,
    username: data.username,
    description: data.description,
  };
}
