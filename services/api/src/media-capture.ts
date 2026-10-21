import { createHash, randomUUID } from "node:crypto";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import sharp from "sharp";
import type { SourceSnapshot } from "./evidence-source.js";
import { boundedSource } from "./public-x.js";
import { ApiError, publicApiBase } from "./config.js";

export const MAX_SOURCE_IMAGES = 4;
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_PIXELS = 16_000_000;
const BUCKET = "chog_source_media";
const LEASE_MS = 120_000;
type SourceMedia = NonNullable<SourceSnapshot["media"]>[number];
type ImageInfo = {
  width: number;
  height: number;
  mimeType: string;
  sha256: string;
  bytes: number;
};

export async function validateSourceImage(raw: Buffer): Promise<ImageInfo> {
  if (raw.length > MAX_SOURCE_IMAGE_BYTES)
    throw new ApiError("source_image_too_large", 422);
  if (!raw.length) throw new ApiError("source_image_invalid", 422);
  try {
    const options = {
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      animated: false,
      failOn: "warning" as const,
    };
    const meta = await sharp(raw, options).timeout({ seconds: 8 }).metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > MAX_SOURCE_IMAGE_PIXELS ||
      (meta.pages ?? 1) !== 1
    )
      throw new Error("Unsupported or oversized image");
    // Decode every pixel. The saved bytes remain the source, without interpreting its contents.
    await sharp(raw, options).timeout({ seconds: 8 }).raw().toBuffer();
    return {
      width: meta.width,
      height: meta.height,
      mimeType: `image/${meta.format}`,
      sha256: createHash("sha256").update(raw).digest("hex"),
      bytes: raw.length,
    };
  } catch {
    throw new ApiError("source_image_invalid", 422);
  }
}

export function sourceMediaUrl(id: string) {
  return `${publicApiBase()}/v1/evidence/media/${encodeURIComponent(id)}`;
}

/** Only image objects belonging to the submitted post may reach the X image CDN. */
export function sourceImageUrl(
  item: SourceMedia,
  snapshot: Pick<SourceSnapshot, "provider" | "source_id" | "identity_binding">,
): URL {
  if (
    snapshot.provider !== "x" ||
    !snapshot.identity_binding.verified ||
    !/^[1-9]\d{0,24}$/.test(snapshot.source_id)
  )
    throw new ApiError("source_image_not_allowed", 422);
  if (item.postId !== snapshot.source_id)
    throw new ApiError("source_image_post_mismatch", 422);
  if (item.type !== "photo")
    throw new ApiError("source_image_unsupported", 422);
  let url: URL;
  try {
    url = new URL(item.sourceUrl);
  } catch {
    throw new ApiError("source_image_not_allowed", 422);
  }
  const path = item.sourceUrl
    .split(/[?#]/, 1)[0]!
    .replace(/^https:\/\/pbs\.twimg\.com/i, "");
  const imagePath =
    /^\/media\/[A-Za-z0-9_-]{1,256}(?:\.(?:jpe?g|png|webp)(?::(?:orig|large|medium|small|thumb))?)?$/;
  if (
    item.sourceUrl.length > 2048 ||
    !/^https:\/\/pbs\.twimg\.com\//i.test(item.sourceUrl) ||
    /[\\\s\u0000-\u001f\u007f]/.test(item.sourceUrl) ||
    url.protocol !== "https:" ||
    url.hostname !== "pbs.twimg.com" ||
    !imagePath.test(path) ||
    !imagePath.test(url.pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new ApiError("source_image_not_allowed", 422);
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (
      seen.has(key) ||
      (key !== "format" && key !== "name") ||
      (key === "format" && !/^(?:jpe?g|png|webp)$/.test(value)) ||
      (key === "name" &&
        !/^(?:orig|large|medium|small|thumb|\d{1,4}x\d{1,4})$/.test(value))
    )
      throw new ApiError("source_image_not_allowed", 422);
    seen.add(key);
  }
  url.searchParams.sort();
  return url;
}

function imageInfo(row: any): ImageInfo | null {
  if (
    !Number.isSafeInteger(row?.width) ||
    row.width < 1 ||
    !Number.isSafeInteger(row.height) ||
    row.height < 1 ||
    row.width * row.height > MAX_SOURCE_IMAGE_PIXELS ||
    !Number.isSafeInteger(row.bytes) ||
    row.bytes < 1 ||
    row.bytes > MAX_SOURCE_IMAGE_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(row.mime_type) ||
    typeof row.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(row.sha256)
  )
    return null;
  return {
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    sha256: row.sha256,
    mimeType: row.mime_type,
  };
}

async function completedFile(db: Db, row: any): Promise<ImageInfo | null> {
  const info = imageInfo(row);
  if (
    !info ||
    typeof row.gridfs_id !== "string" ||
    !/^[0-9a-f]{24}$/.test(row.gridfs_id)
  )
    return null;
  const file = await db
    .collection<any>(`${BUCKET}.files`)
    .findOne({ _id: new ObjectId(row.gridfs_id) });
  if (!file) return null;
  if (
    file.length !== info.bytes ||
    file.metadata?.sha256 !== info.sha256 ||
    file.metadata?.width !== info.width ||
    file.metadata?.height !== info.height ||
    file.metadata?.mimeType !== info.mimeType ||
    file.metadata?.sourceUrl !== row.source_url ||
    file.metadata?.postId !== row.source_id ||
    (file.metadata?.jobId !== undefined &&
      file.metadata.jobId !== row.job_id) ||
    (file.metadata?.mediaId !== undefined && file.metadata.mediaId !== row._id)
  )
    throw new ApiError("source_media_checkpoint_invalid");
  return info;
}

const failureCode = (error: unknown) =>
  error instanceof ApiError ? error.code : "source_image_unavailable";
const unavailable = (item: SourceMedia, error: unknown): SourceMedia => ({
  ...item,
  status: "unavailable",
  errorCode: failureCode(error),
});

export async function captureSourceMedia(
  db: Db,
  snapshot: SourceSnapshot,
  request: typeof fetch = fetch,
  jobId = snapshot.content_hash,
): Promise<SourceMedia[]> {
  const sources = (snapshot.media ?? [])
    .slice(0, MAX_SOURCE_IMAGES)
    .map((item) => {
      // Never accept a caller-provided captured id, hash, dimensions or status.
      const base: SourceMedia = {
        sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
        ...(typeof item.type === "string" ? { type: item.type } : {}),
        ...(typeof item.postId === "string" ? { postId: item.postId } : {}),
      };
      try {
        return { base, url: sourceImageUrl(base, snapshot), error: null };
      } catch (error) {
        return { base, url: null, error };
      }
    });
  if (!sources.some((source) => source.url))
    return sources.map((source) => unavailable(source.base, source.error));
  const checkpoints = db.collection<any>("source_media");
  const jobs = db.collection<any>("source_media_jobs");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        provider: snapshot.provider,
        sourceId: snapshot.source_id,
        sources: sources.map(({ base, url }) => ({
          ...base,
          sourceUrl: url?.href ?? base.sourceUrl,
        })),
      }),
    )
    .digest("hex");
  const token = randomUUID();
  const captured = new Map<string, { row: any; info: ImageInfo }>();
  const rows = new Map<string, any>();
  const failures = new Map<string, unknown>();
  let held = false;
  let result: SourceMedia[] = [];
  let total = 0;
  const renew = async () => {
    const updated = await jobs.updateOne(
      { _id: jobId, lease_token: token },
      {
        $set: {
          lease_until: new Date(Date.now() + LEASE_MS),
          updated_at: new Date(),
        },
      },
    );
    if (updated.matchedCount !== 1)
      throw new ApiError("source_media_lease_lost");
  };
  try {
    if (typeof jobId !== "string" || !jobId || jobId.length > 256)
      throw new ApiError("source_media_checkpoint_conflict", 409);
    try {
      await jobs.updateOne(
        { _id: jobId },
        {
          $setOnInsert: {
            source_fingerprint: fingerprint,
            provider: snapshot.provider,
            source_id: snapshot.source_id,
            lease_token: null,
            lease_until: null,
            created_at: new Date(),
            updated_at: new Date(),
            status: "pending",
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if ((error as any)?.code !== 11000) throw error;
    }
    const job = await jobs.findOne({ _id: jobId });
    if (job?.source_fingerprint !== fingerprint)
      throw new ApiError("source_media_checkpoint_conflict", 409);
    const lease = await jobs.updateOne(
      {
        _id: jobId,
        source_fingerprint: fingerprint,
        $or: [{ lease_until: null }, { lease_until: { $lte: new Date() } }],
      },
      {
        $set: {
          lease_token: token,
          lease_until: new Date(Date.now() + LEASE_MS),
          status: "capturing",
          updated_at: new Date(),
        },
      },
    );
    held = lease.modifiedCount === 1;
    if (!held) throw new ApiError("source_media_capture_in_progress");

    // Count every completed image before fetching missing ones, including later slots on a retry.
    for (const { url } of sources) {
      if (!url || rows.has(url.href)) continue;
      await renew();
      let row = await checkpoints.findOne({
        job_id: jobId,
        source_url: url.href,
      });
      if (!row) {
        row = {
          _id: randomUUID(),
          job_id: jobId,
          source_url: url.href,
          provider: snapshot.provider,
          source_id: snapshot.source_id,
          source_content_hash: snapshot.content_hash,
          status: "pending",
          attempts: 0,
          created_at: new Date(),
          updated_at: new Date(),
        };
        try {
          await checkpoints.insertOne(row);
        } catch (error) {
          if ((error as any)?.code !== 11000) throw error;
          row = await checkpoints.findOne({
            job_id: jobId,
            source_url: url.href,
          });
        }
      }
      if (
        !row ||
        row.provider !== snapshot.provider ||
        row.source_id !== snapshot.source_id
      )
        throw new ApiError("source_media_checkpoint_conflict", 409);
      rows.set(url.href, row);
      const info = await completedFile(db, row);
      if (info) {
        total += info.bytes;
        if (total > MAX_SOURCE_MEDIA_BYTES)
          throw new ApiError("source_media_budget_exceeded", 422);
        await checkpoints.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "captured",
              capture_token: token,
              error_code: null,
              updated_at: new Date(),
            },
          },
        );
        captured.set(url.href, { row, info });
      }
    }
    for (const { base, url, error: invalid } of sources) {
      if (!url) {
        result.push(unavailable(base, invalid));
        continue;
      }
      const saved = captured.get(url.href);
      if (saved) {
        result.push({
          ...base,
          mediaId: String(saved.row._id),
          status: "captured",
          ...saved.info,
        });
        continue;
      }
      if (failures.has(url.href)) {
        result.push(unavailable(base, failures.get(url.href)));
        continue;
      }
      const row = rows.get(url.href)!;
      try {
        await renew();
        if (total >= MAX_SOURCE_MEDIA_BYTES)
          throw new ApiError("source_media_budget_exceeded", 422);
        await checkpoints.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "capturing",
              capture_token: token,
              error_code: null,
              updated_at: new Date(),
            },
            $inc: { attempts: 1 },
          },
        );
        const maximum = Math.min(
          MAX_SOURCE_IMAGE_BYTES,
          MAX_SOURCE_MEDIA_BYTES - total,
        );
        let raw: Buffer;
        try {
          raw = await boundedSource(url, request, maximum, {
            accept: "image/jpeg,image/png,image/webp",
            onBytes(bytes) {
              total += bytes;
              if (total > MAX_SOURCE_MEDIA_BYTES)
                throw new ApiError("source_media_budget_exceeded", 422);
            },
          });
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.code === "evidence_source_too_large"
          )
            throw new ApiError(
              maximum < MAX_SOURCE_IMAGE_BYTES
                ? "source_media_budget_exceeded"
                : "source_image_too_large",
              422,
            );
          throw error;
        }
        const info = await validateSourceImage(raw);
        // Once staged, a public media id always denotes the same validated source bytes.
        if (row.sha256 && row.sha256 !== info.sha256)
          throw new ApiError("source_image_changed", 422);
        await renew();
        if (
          typeof row.gridfs_id === "string" &&
          /^[0-9a-f]{24}$/.test(row.gridfs_id)
        ) {
          // An interrupted upload has chunks but no completed files record.
          const previous = new ObjectId(row.gridfs_id);
          if (
            await db
              .collection<any>(`${BUCKET}.files`)
              .findOne({ _id: previous })
          )
            throw new ApiError("source_media_checkpoint_invalid");
          await db
            .collection<any>(`${BUCKET}.chunks`)
            .deleteMany({ files_id: previous });
        }
        const gridfsId = new ObjectId();
        const staged = await checkpoints.updateOne(
          { _id: row._id, capture_token: token },
          {
            $set: {
              ...info,
              mime_type: info.mimeType,
              gridfs_id: gridfsId.toHexString(),
              updated_at: new Date(),
            },
          },
        );
        if (staged.matchedCount !== 1)
          throw new ApiError("source_media_lease_lost");
        row.gridfs_id = gridfsId.toHexString();
        const upload = new GridFSBucket(db, {
          bucketName: BUCKET,
        }).openUploadStreamWithId(
          gridfsId,
          `${snapshot.source_id}-${info.sha256}`,
          {
            timeoutMS: 20_000,
            metadata: {
              ...info,
              sourceUrl: url.href,
              postId: snapshot.source_id,
              provider: snapshot.provider,
              jobId,
              mediaId: row._id,
            },
          },
        );
        await new Promise<void>((resolve, reject) => {
          upload.once("finish", resolve);
          upload.once("error", reject);
          upload.end(raw);
        });
        await renew();
        const finalized = await checkpoints.updateOne(
          { _id: row._id, capture_token: token },
          {
            $set: {
              status: "captured",
              error_code: null,
              updated_at: new Date(),
            },
          },
        );
        if (finalized.matchedCount !== 1)
          throw new ApiError("source_media_lease_lost");
        captured.set(url.href, { row, info });
        result.push({
          ...base,
          mediaId: String(row._id),
          status: "captured",
          ...info,
        });
      } catch (error) {
        failures.set(url.href, error);
        await checkpoints
          .updateOne(
            { _id: row._id, capture_token: token },
            {
              $set: {
                status: "unavailable",
                error_code: failureCode(error),
                updated_at: new Date(),
              },
            },
          )
          .catch(() => undefined);
        result.push(unavailable(base, error));
      }
    }
    return result;
  } catch (error) {
    result = sources.map(({ base, url, error: invalid }) => {
      const saved = url ? captured.get(url.href) : undefined;
      return saved
        ? {
            ...base,
            mediaId: String(saved.row._id),
            status: "captured",
            ...saved.info,
          }
        : unavailable(base, invalid ?? error);
    });
    return result;
  } finally {
    if (held)
      await jobs
        .updateOne(
          { _id: jobId, lease_token: token },
          {
            $set: {
              lease_token: null,
              lease_until: null,
              updated_at: new Date(),
              status:
                result.length > 0 &&
                result.every((item) => item.status === "captured")
                  ? "captured"
                  : "partial",
            },
          },
        )
        .catch(() => undefined);
  }
}

export async function readSourceMedia(db: Db, id: string) {
  const media = await db
    .collection<any>("source_media")
    .findOne({ _id: id, status: "captured" });
  if (!media || !(await completedFile(db, media))) return null;
  return {
    media,
    stream: new GridFSBucket(db, { bucketName: BUCKET }).openDownloadStream(
      new ObjectId(media.gridfs_id),
    ),
  };
}
