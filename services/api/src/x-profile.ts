export type PublicXProfile = { id: string; username: string; description: string };

export async function lookupPublicXProfile(
  requestedUsername: string,
  bearerToken: string,
  request: typeof fetch = fetch,
): Promise<PublicXProfile | null> {
  const response = await request(`https://api.x.com/2/users/by/username/${encodeURIComponent(requestedUsername)}?user.fields=description,username`, {
    headers: { authorization: `Bearer ${bearerToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`x_api_http_${response.status}`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("data" in payload)) throw new Error("x_api_invalid_profile_response");
  const data = payload.data;
  if (typeof data !== "object" || data === null || !("id" in data) || !("username" in data) || !("description" in data)) {
    throw new Error("x_api_invalid_profile_response");
  }
  const { id, username, description } = data;
  if (typeof id !== "string" || !/^\d+$/.test(id) || typeof username !== "string" || typeof description !== "string") {
    throw new Error("x_api_invalid_profile_response");
  }
  if (username.toLowerCase() !== requestedUsername.toLowerCase()) return null;
  return { id, username, description };
}
