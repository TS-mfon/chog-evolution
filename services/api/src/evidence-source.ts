import { createHash } from "node:crypto";
import { ApiError } from "./config.js";
import { boundedSource, readPublicXPost, xSourceMode } from "./public-x.js";

const MAX_RESPONSE_BYTES = 192 * 1024;
const MAX_PUBLIC_TEXT = 10_000;
export const evidenceDigest = (value: string) =>
  `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;

export type ContributionSource =
  | {
      provider: "github";
      canonicalUrl: string;
      owner: string;
      repository: string;
    }
  | { provider: "x"; canonicalUrl: string; username: string; postId: string };

export function parseContributionUrl(value: unknown): ContributionSource {
  if (typeof value !== "string" || value.length > 1000)
    throw new ApiError("supported_evidence_url_required", 400);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("supported_evidence_url_required", 400);
  }
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
  let segments: string[];
  try {
    segments = value
      .split(/[?#]/, 1)[0]!
      .split("/")
      .slice(3)
      .map(decodeURIComponent);
  } catch {
    throw new ApiError("evidence_url_not_allowed", 422);
  }
  if (
    url.protocol !== "https:" ||
    !authority ||
    !/^[A-Za-z0-9.]+$/.test(authority) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    /[\\\s\u0000-\u001f\u007f]/.test(value) ||
    segments.some((part) => part === "." || part === ".." || /[\\/]/.test(part))
  ) {
    throw new ApiError("evidence_url_not_allowed", 422);
  }
  const host = url.hostname.toLowerCase();
  if (host === "github.com" || host === "www.github.com") {
    const parts = url.pathname.match(
      /^\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/,
    );
    if (
      !parts ||
      !parts[1] ||
      !parts[2] ||
      parts[2] === "." ||
      parts[2] === ".."
    )
      throw new ApiError("github_repository_url_required", 422);
    const owner = parts[1].toLowerCase();
    const repository = parts[2].replace(/\.git$/i, "").toLowerCase();
    if (!repository) throw new ApiError("github_repository_url_required", 422);
    return {
      provider: "github",
      owner,
      repository,
      canonicalUrl: `https://github.com/${owner}/${repository}`,
    };
  }
  if (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)) {
    const parts = url.pathname.match(
      /^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{0,24})\/?$/,
    );
    if (!parts || !parts[1] || !parts[2])
      throw new ApiError("x_post_url_required", 422);
    return {
      provider: "x",
      username: parts[1].toLowerCase(),
      postId: parts[2],
      canonicalUrl: `https://x.com/${parts[1].toLowerCase()}/status/${parts[2]}`,
    };
  }
  throw new ApiError("evidence_host_not_allowed", 422);
}

// User URLs are identifiers only. Requests always use these exact provider hosts and never
// follow redirects, fetch embedded links, or accept a user-supplied API host/IP/port.
async function providerJson(
  url: URL,
  headers: Record<string, string>,
  request: typeof fetch,
): Promise<any> {
  if (
    url.protocol !== "https:" ||
    !["api.github.com", "api.x.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new ApiError("evidence_provider_not_allowed", 422);
  const raw = await boundedSource(url, request, MAX_RESPONSE_BYTES, {
    accept: "application/json",
    headers,
  });
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError("evidence_provider_response_invalid");
  }
}

export type SourceSnapshot = {
  provider: "github" | "x";
  source_id: string;
  canonical_url: string;
  fetched_at: string;
  content_hash: string;
  public_content: Record<string, unknown>;
  identity_binding: {
    verified: boolean;
    method: string;
    provider_user_id?: string;
  };
  media?: {
    sourceUrl: string;
    type?: string;
    postId?: string;
    mediaId?: string;
    sha256?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    bytes?: number;
    status?: string;
    errorCode?: string;
  }[];
};

export async function captureContribution(
  source: ContributionSource,
  wallet: string,
  xLink: { provider_user_id: string; username: string } | null,
  request: typeof fetch = fetch,
): Promise<SourceSnapshot> {
  const parsedSource = parseContributionUrl(source.canonicalUrl);
  if (
    parsedSource.provider !== source.provider ||
    (source.provider === "x" &&
      (parsedSource.provider !== "x" ||
        parsedSource.postId !== source.postId ||
        parsedSource.username !== source.username.toLowerCase())) ||
    (source.provider === "github" &&
      (parsedSource.provider !== "github" ||
        parsedSource.owner !== source.owner ||
        parsedSource.repository !== source.repository))
  )
    throw new ApiError("evidence_source_identity_mismatch", 422);
  const fetched_at = new Date().toISOString();
  if (source.provider === "x") {
    const mode = xSourceMode();
    if (mode === "disabled") throw new ApiError("x_source_disabled");
    if (mode === "public_page") {
      if (!xLink || !/^[1-9]\d{0,24}$/.test(xLink.provider_user_id))
        throw new ApiError("x_profile_link_required", 422);
      const post = await readPublicXPost(
        source.username,
        source.postId,
        request,
      );
      if (post.author_id !== xLink.provider_user_id)
        throw new ApiError("evidence_author_not_linked_to_wallet", 422);
      const public_content = {
        id: post.id,
        text: post.text,
        author_id: post.author_id,
        username: post.username,
        created_at: post.created_at,
        parser_version: post.parserVersion,
        media: post.media,
      };
      return {
        provider: "x",
        source_id: post.id,
        canonical_url: `https://x.com/${post.username.toLowerCase()}/status/${post.id}`,
        fetched_at,
        content_hash: evidenceDigest(JSON.stringify(public_content)),
        public_content,
        media: post.media,
        identity_binding: {
          verified: true,
          method: "public_x_provider_identity",
          provider_user_id: post.author_id,
        },
      };
    }
    const token = process.env.X_API_BEARER_TOKEN;
    if (!token) throw new ApiError("x_evidence_provider_unconfigured");
    if (!xLink || !/^[1-9]\d{0,24}$/.test(xLink.provider_user_id))
      throw new ApiError("x_profile_link_required", 422);
    const payload = await providerJson(
      new URL(
        `https://api.x.com/2/tweets/${source.postId}?tweet.fields=author_id,created_at,attachments&expansions=author_id,attachments.media_keys&user.fields=username&media.fields=url,type`,
      ),
      { authorization: `Bearer ${token}` },
      request,
    );
    const data = payload?.data;
    const authors = Array.isArray(payload?.includes?.users)
      ? payload.includes.users.filter(
          (user: any) => user?.id === data?.author_id,
        )
      : [];
    const author = authors[0];
    if (
      data?.id !== source.postId ||
      typeof data?.text !== "string" ||
      data.text.length > MAX_PUBLIC_TEXT ||
      typeof data.author_id !== "string" ||
      !/^[1-9]\d{0,24}$/.test(data.author_id) ||
      !author ||
      typeof author.username !== "string" ||
      !/^[A-Za-z0-9_]{1,15}$/.test(author.username) ||
      authors.some((row: any) => row.username !== author.username)
    )
      throw new ApiError("evidence_provider_response_invalid");
    if (
      author.username.toLowerCase() !== source.username.toLowerCase() ||
      data.author_id !== xLink.provider_user_id
    )
      throw new ApiError("evidence_author_not_linked_to_wallet", 422);
    const mediaKeys = data.attachments?.media_keys ?? [];
    if (!Array.isArray(mediaKeys))
      throw new ApiError("evidence_provider_response_invalid");
    const media = mediaKeys.slice(0, 4).map((key: unknown) => {
      const matches =
        typeof key === "string" && Array.isArray(payload?.includes?.media)
          ? payload.includes.media.filter(
              (item: any) => item?.media_key === key,
            )
          : [];
      const item = matches[0];
      if (
        matches.some(
          (row: any) => row.url !== item.url || row.type !== item.type,
        )
      )
        throw new ApiError("evidence_provider_response_invalid");
      return {
        sourceUrl: typeof item?.url === "string" ? item.url : "",
        type: typeof item?.type === "string" ? item.type : "unsupported",
        postId: source.postId,
      };
    });
    const public_content = {
      id: data.id,
      text: data.text,
      author_id: data.author_id,
      username: author.username,
      created_at: typeof data.created_at === "string" ? data.created_at : null,
      media,
    };
    return {
      provider: "x",
      source_id: source.postId,
      canonical_url: source.canonicalUrl,
      fetched_at,
      content_hash: evidenceDigest(JSON.stringify(public_content)),
      public_content,
      media,
      identity_binding: {
        verified: true,
        method: "verified_x_provider_identity",
        provider_user_id: data.author_id,
      },
    };
  }
  const headers: Record<string, string> = {
    "user-agent": "CHOG-Evolution-Evidence",
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_PUBLIC_READ_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_PUBLIC_READ_TOKEN}`;
  const api = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}`;
  const repo = await providerJson(new URL(api), headers, request);
  if (
    !Number.isSafeInteger(repo?.id) ||
    repo.id < 1 ||
    repo.private !== false ||
    typeof repo.default_branch !== "string" ||
    !repo.default_branch ||
    repo.default_branch.length > 255 ||
    typeof repo.full_name !== "string" ||
    repo.full_name.toLowerCase() !== `${source.owner}/${source.repository}`
  )
    throw new ApiError("github_public_repository_required", 422);
  const reference = await providerJson(
    new URL(`${api}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`),
    headers,
    request,
  );
  const commit = reference?.object;
  if (
    commit?.type !== "commit" ||
    typeof commit?.sha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(commit.sha)
  )
    throw new ApiError("evidence_provider_response_invalid");
  const readme = await providerJson(
    new URL(`${api}/readme?ref=${commit.sha}`),
    headers,
    request,
  );
  if (
    readme?.encoding !== "base64" ||
    typeof readme.content !== "string" ||
    readme.content.length > MAX_RESPONSE_BYTES ||
    typeof readme.sha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(readme.sha)
  )
    throw new ApiError("github_readme_required", 422);
  const encoded = readme.content.replace(/\s/g, "");
  const decoded = Buffer.from(encoded, "base64");
  if (
    decoded.toString("base64") !== encoded ||
    !/^0x[0-9a-fA-F]{40}$/.test(wallet)
  )
    throw new ApiError("github_readme_required", 422);
  const fullText = decoded.toString("utf8");
  if (!fullText.trim()) throw new ApiError("github_readme_required", 422);
  const readmePath =
    typeof readme.path === "string" ? readme.path : "README.md";
  if (
    !readmePath ||
    readmePath.length > 1000 ||
    readmePath
      .split("/")
      .some(
        (part: string) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[\\\u0000-\u001f\u007f]/.test(part),
      )
  )
    throw new ApiError("github_readme_required", 422);
  const text = fullText.slice(0, MAX_PUBLIC_TEXT);
  // Binding must occur within the exact captured content, not an omitted oversized suffix.
  const walletReferenced = text.toLowerCase().includes(wallet.toLowerCase());
  const public_content = {
    repository_id: repo.id,
    full_name: repo.full_name,
    description:
      typeof repo.description === "string"
        ? repo.description.slice(0, 2000)
        : null,
    owner_login:
      typeof repo.owner?.login === "string" ? repo.owner.login : null,
    fork: repo.fork === true,
    archived: repo.archived === true,
    commit_sha: commit.sha,
    readme_blob_sha: readme.sha,
    immutable_readme_url: `https://github.com/${source.owner}/${source.repository}/blob/${commit.sha}/${readmePath.split("/").map(encodeURIComponent).join("/")}`,
    readme: text,
    readme_truncated: fullText.length > MAX_PUBLIC_TEXT,
  };
  return {
    provider: "github",
    source_id: String(repo.id),
    canonical_url: source.canonicalUrl,
    fetched_at,
    content_hash: evidenceDigest(JSON.stringify(public_content)),
    public_content,
    identity_binding: {
      verified: walletReferenced,
      method: walletReferenced
        ? "wallet_address_in_pinned_public_readme"
        : "wallet_reference_missing",
    },
  };
}
