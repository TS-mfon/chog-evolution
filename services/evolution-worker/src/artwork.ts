import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { composeDemoChog } from "@chog/art-composition";
import { stageForXp, legacyEquipment } from "@chog/evolution-rules";
import { measureOperation, recordOperationalMetric } from "@chog/api/metrics";

const promptVersion = "chog-evolution-v2";
export const REFERENCE_COMMIT = "b1b273b58c37a09d96ff98de08a552df6623bd78";
const references = [
  [
    "reference-01.png",
    "5b8267dda4b26554b1a982cc6e062e10220de24388baab29330b85895d3d8bd5",
  ],
  [
    "reference-02.png",
    "bd8abab50b8a32c693ded910ee1d40838a31f2d4e2c2774c37a89ca184602b2c",
  ],
  [
    "reference-03.png",
    "17b00cdff7f4170fb3ca9962dd28eaa55ec4d8db6a39a39afe3dad8bc55770a0",
  ],
  [
    "reference-04.png",
    "e775c3245b2d14ba95542c817b6126040cce4bf04d0a7a4573062d701f2d18a2",
  ],
  [
    "reference-05.png",
    "d5fd0b1eb6ed0583b41e72610e705c90aed29f95012992a0915fbff88367fb64",
  ],
] as const;
const digest = (data: Buffer) =>
  `0x${createHash("sha256").update(data).digest("hex")}`;

export function artifactUrl(id: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new Error("invalid_artifact_id");
  const explicit = env.PUBLIC_API_URL?.trim() || undefined;
  const base =
    explicit?.replace(/\/$/, "") ??
    (env.PUBLIC_API_PATH ?? "/api").replace(/\/$/, "");
  return `${base}/v1/artifacts/${id}`;
}

export function artworkVersionFilter(profileId: string, version: number) {
  if (!Number.isSafeInteger(version) || version < 0)
    throw new Error("invalid_artwork_version");
  return { _id: profileId, version };
}
const readStream = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

async function store(
  bucket: GridFSBucket,
  buffer: Buffer,
  filename: string,
  contentType: string,
  metadata: Record<string, unknown>,
) {
  const id = new ObjectId();
  await new Promise<void>((resolvePromise, reject) => {
    const stream = bucket.openUploadStreamWithId(id, filename, {
      metadata: { ...metadata, contentType, sha256: digest(buffer) },
    });
    stream.once("error", reject);
    stream.once("finish", () => resolvePromise());
    stream.end(buffer);
  });
  return {
    id: id.toHexString(),
    sha256: digest(buffer),
    size: buffer.byteLength,
  };
}

export function verifyReferenceAssets() {
  const refDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../assets/chog-references",
  );
  return references.map(([filename, expectedHash]) => {
    const buffer = readFileSync(resolve(refDir, filename));
    if (digest(buffer).slice(2) !== expectedHash)
      throw new Error("reference_hash_mismatch");
    return { filename, buffer, sha256: `0x${expectedHash}` };
  });
}

export async function validateGeneratedImage(raw: Buffer) {
  if (raw.length > 10 * 1024 * 1024 || raw.length < 1024)
    throw new Error("generated_image_size_invalid");
  const image = await sharp(raw, {
    failOn: "error",
    limitInputPixels: 16_000_000,
  })
    .png()
    .toBuffer();
  const info = await sharp(image).metadata();
  if (
    info.format !== "png" ||
    !info.width ||
    !info.height ||
    info.width < 512 ||
    info.height < 512 ||
    info.width > 4096 ||
    info.height > 4096 ||
    info.width !== info.height
  )
    throw new Error("generated_image_dimensions_invalid");
  return image;
}

export type ArtworkOptions = {
  generateImage?: (input: {
    prompt: string;
    continuity: Buffer;
    references: ReturnType<typeof verifyReferenceAssets>;
  }) => Promise<Buffer>;
};

export async function generateGeminiArtwork(
  input: Parameters<NonNullable<ArtworkOptions["generateImage"]>>[0],
) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    httpOptions: { timeout: 120000 },
  });
  const result = await ai.interactions.create({
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
    input: [
      { type: "text", text: input.prompt },
      {
        type: "image",
        mime_type: "image/png",
        data: input.continuity.toString("base64"),
      },
      ...input.references.map((ref) => ({
        type: "image" as const,
        mime_type: "image/png" as const,
        data: ref.buffer.toString("base64"),
      })),
    ],
    response_modalities: ["image"],
    response_format: { type: "image", aspect_ratio: "1:1", image_size: "1K" },
  });
  const output = result.output_image;
  if (!output?.data) throw new Error("gemini_image_output_missing");
  return Buffer.from(output.data, "base64");
}

/** Render from an immutable source event, then publish only to that profile version. */
export async function processOneArtwork(
  db: Db,
  options: ArtworkOptions = {},
): Promise<boolean> {
  const now = new Date(),
    workerToken = randomUUID();
  const jobs = db.collection<any>("evolution_jobs");
  const job = await jobs.findOneAndUpdate(
    {
      status: { $in: ["queued", "generating"] },
      $or: [{ lease_until: null }, { lease_until: { $lt: now } }],
      $and: [
        {
          $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
        },
      ],
    },
    {
      $set: {
        status: "generating",
        lease_token: workerToken,
        lease_until: new Date(now.getTime() + 8 * 60000),
        updated_at: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { created_at: 1, _id: 1 }, returnDocument: "after" },
  );
  if (!job) return false;
  try {
    const [profile, history] = await Promise.all([
      db.collection<any>("nft_profiles").findOne({ _id: job.profile_id }),
      db.collection<any>("evolution_history").findOne({
        ...(job.source_event_id
          ? { source_event_id: job.source_event_id }
          : { claim_id: job.claim_id }),
        profile_id: job.profile_id,
        finalized: true,
        outcome: "accepted",
      }),
    ]);
    if (!profile || !history)
      throw new Error("trusted_evolution_event_required");
    const cosmetic = job.kind === "trait_change";
    if (cosmetic && history.kind !== "trait_change")
      throw new Error("trusted_trait_event_required");
    const sourceEventId =
      job.source_event_id ?? history.source_event_id ?? history._id;
    const version = Number(job.evolution_version ?? history.new_version);
    const authoritative = history.after ?? job.snapshot;
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version !== history.new_version ||
      !authoritative
    )
      throw new Error("evolution_snapshot_invalid");
    const xp = Number(authoritative.xp ?? history.xp_total);
    const stage = stageForXp(xp);
    const equipped = authoritative.equippedTraitIds ?? legacyEquipment(xp);
    if (
      (authoritative.stage && authoritative.stage !== stage) ||
      (job.snapshot?.xp !== undefined && job.snapshot.xp !== xp) ||
      (job.snapshot?.equippedTraitIds &&
        JSON.stringify(job.snapshot.equippedTraitIds) !==
          JSON.stringify(equipped))
    )
      throw new Error("evolution_snapshot_invalid");
    const level =
      ["hatchling", "curious", "explorer", "veteran", "legend"].indexOf(stage) +
      1;
    let decision: any;
    if (!cosmetic) {
      const claim = await db
        .collection<any>("claims")
        .findOne({ _id: job.claim_id, status: "accepted" });
      decision = await db.collection<any>("decisions").findOne({
        claim_id: job.claim_id,
        finalized: true,
        outcome: "accepted",
      });
      const ledger = await db
        .collection<any>("xp_ledger")
        .findOne({ claim_id: job.claim_id, amount: { $gt: 0 } });
      if (!claim || !decision || !ledger || decision.xp_award < 1)
        throw new Error("finalized_reward_required");
    }
    const composition = composeDemoChog(String(profile.token_id), stage, {
      equippedTraitIds: equipped,
      mode: profile.mode ?? "demo",
    });
    const identity = job.source_event_id
      ? { source_event_id: sourceEventId }
      : { claim_id: job.claim_id };
    let artifact = await db.collection<any>("artifacts").findOne(identity);
    if (
      artifact &&
      (artifact.profile_id !== profile._id ||
        artifact.evolution_version !== version)
    )
      throw new Error("artifact_event_binding_invalid");
    if (!artifact) {
      const refs = verifyReferenceAssets();
      const bucket = new GridFSBucket(db, { bucketName: "chog_artifacts" });
      const imageId = new ObjectId(job.image_gridfs_id ?? undefined);
      const metadataId = new ObjectId(job.metadata_gridfs_id ?? undefined);
      const reserved = await jobs.updateOne(
        { _id: job._id, lease_token: workerToken, status: "generating" },
        {
          $set: {
            image_gridfs_id: imageId.toHexString(),
            metadata_gridfs_id: metadataId.toHexString(),
            source_event_id: sourceEventId,
          },
        },
      );
      if (!reserved.matchedCount) throw new Error("evolution_lease_lost");
      let storedImage = await bucket.find({ _id: imageId }).limit(1).next();
      if (!storedImage) {
        // A prior crashed upload can leave chunks without a completed GridFS file.
        await db
          .collection("chog_artifacts.chunks")
          .deleteMany({ files_id: imageId });
        const model =
          !cosmetic && (process.env.GEMINI_API_KEY || options.generateImage)
            ? process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image"
            : "chog-trait-renderer-v2";
        let raw: Buffer;
        if (
          !cosmetic &&
          (process.env.GEMINI_API_KEY || options.generateImage)
        ) {
          const prior = await db
            .collection<any>("artifacts")
            .find({
              profile_id: profile._id,
              evolution_version: { $lt: version },
            })
            .sort({ evolution_version: -1 })
            .limit(1)
            .next();
          const continuity = prior?.gridfs_id
            ? await readStream(
                bucket.openDownloadStream(new ObjectId(prior.gridfs_id)),
              )
            : await sharp(Buffer.from(composition.svg)).png().toBuffer();
          const prompt = `Evolve this Chog to ${stage}. Keep its recognizable face, silhouette, quills, colors and framing. Render only the authoritative traits ${JSON.stringify(composition.traits)}. Preserve its identity. Reference images establish Chog's visual language. Produce one square character illustration. The image never decides eligibility, XP or ownership. ${promptVersion}.`;
          raw = await measureOperation(
            db,
            {
              kind: "provider",
              name: "gemini",
              operation: "render",
              attempt: job.attempts,
            },
            async () => {
              if (options.generateImage)
                return options.generateImage({
                  prompt,
                  continuity,
                  references: refs,
                });
              return generateGeminiArtwork({
                prompt,
                continuity,
                references: refs,
              });
            },
          );
        } else
          raw = await sharp(Buffer.from(composition.svg))
            .resize(1024, 1024)
            .png()
            .toBuffer();
        const image = await validateGeneratedImage(raw);
        const provenance = {
          model,
          promptVersion,
          referenceCommit: REFERENCE_COMMIT,
          referenceHashes: refs.map((ref) => ref.sha256),
          generatedAt: new Date().toISOString(),
        };
        await new Promise<void>((resolveUpload, reject) => {
          const stream = bucket.openUploadStreamWithId(
            imageId,
            `${profile._id}-evolution-${version}.png`,
            {
              metadata: {
                profile_id: profile._id,
                source_event_id: sourceEventId,
                evolution_version: version,
                contentType: "image/png",
                sha256: digest(image),
                provenance,
              },
            },
          );
          stream.once("error", reject);
          stream.once("finish", () => resolveUpload());
          stream.end(image);
        });
        storedImage = await bucket.find({ _id: imageId }).limit(1).next();
      }
      if (
        !storedImage ||
        storedImage.metadata?.source_event_id !== sourceEventId ||
        storedImage.metadata?.evolution_version !== version ||
        !/^0x[0-9a-f]{64}$/.test(storedImage.metadata?.sha256 ?? "")
      )
        throw new Error("stored_artwork_binding_invalid");
      const publicUrl = artifactUrl(imageId.toHexString());
      const metadata = {
        schema: "chog-artifact-v2",
        profileId: profile._id,
        sourceEventId,
        kind: cosmetic ? "trait_change" : "claim",
        ...(!cosmetic
          ? {
              claimId: job.claim_id,
              decisionReference: decision.decision_reference,
            }
          : {}),
        evolutionVersion: version,
        xp,
        level,
        stage,
        equippedTraitIds: equipped,
        traits: composition.traits,
        image: {
          url: publicUrl,
          sha256: storedImage.metadata.sha256,
          bytes: storedImage.length,
          mimeType: "image/png",
        },
        provenance: storedImage.metadata.provenance,
      };
      const metadataBytes = Buffer.from(JSON.stringify(metadata));
      const storedMetadata = await bucket
        .find({ _id: metadataId })
        .limit(1)
        .next();
      if (!storedMetadata) {
        await db
          .collection("chog_artifacts.chunks")
          .deleteMany({ files_id: metadataId });
        await new Promise<void>((resolveUpload, reject) => {
          const stream = bucket.openUploadStreamWithId(
            metadataId,
            `${profile._id}-evolution-${version}.json`,
            {
              metadata: {
                profile_id: profile._id,
                source_event_id: sourceEventId,
                contentType: "application/json",
                sha256: digest(metadataBytes),
              },
            },
          );
          stream.once("error", reject);
          stream.once("finish", () => resolveUpload());
          stream.end(metadataBytes);
        });
      } else if (storedMetadata.metadata?.sha256 !== digest(metadataBytes))
        throw new Error("stored_artifact_metadata_invalid");
      artifact = {
        _id: randomUUID(),
        profile_id: profile._id,
        source_event_id: sourceEventId,
        kind: cosmetic ? "trait_change" : "claim",
        ...(!cosmetic ? { claim_id: job.claim_id } : {}),
        evolution_version: version,
        gridfs_id: imageId.toHexString(),
        metadata_gridfs_id: metadataId.toHexString(),
        image_hash: storedImage.metadata.sha256,
        metadata_hash: digest(metadataBytes),
        mime_type: "image/png",
        public_url: publicUrl,
        metadata_url: artifactUrl(metadataId.toHexString()),
        provenance: metadata.provenance,
        created_at: new Date(),
      };
    }
    const session = db.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          const held = await jobs.findOne(
            { _id: job._id, lease_token: workerToken, status: "generating" },
            { session },
          );
          if (!held) throw new Error("evolution_lease_lost");
          const existing = await db
            .collection<any>("artifacts")
            .findOne(identity, { session });
          if (existing) artifact = existing;
          else
            await db
              .collection<any>("artifacts")
              .insertOne(artifact, { session });
          await db.collection<any>("nft_profiles").updateOne(
            artworkVersionFilter(profile._id, version),
            {
              $set: {
                artwork_artifact_id: artifact._id,
                artwork_url: artifact.public_url,
                artwork_version: version,
                updated_at: new Date(),
              },
            },
            { session },
          );
          // Only publication fields are filled after the immutable event snapshot is saved.
          await db
            .collection<any>("evolution_history")
            .updateOne(
              { _id: history._id, new_version: version },
              { $set: { "after.artworkUrl": artifact.public_url } },
              { session },
            );
          await db.collection<any>("evolution_history").updateOne(
            {
              profile_id: profile._id,
              previous_version: version,
              "before.artworkUrl": null,
            },
            { $set: { "before.artworkUrl": artifact.public_url } },
            { session },
          );
          await jobs.updateOne(
            { _id: job._id, lease_token: workerToken },
            {
              $set: {
                status: "completed",
                artifact_id: artifact._id,
                lease_token: null,
                lease_until: null,
                completed_at: new Date(),
                updated_at: new Date(),
              },
            },
            { session },
          );
          await db.collection<any>("audit_events").insertOne(
            {
              _id: randomUUID(),
              entity_type: "evolution",
              entity_id: sourceEventId,
              action: "artwork_published",
              details: {
                artifact_id: artifact._id,
                image_hash: artifact.image_hash,
                version,
              },
              created_at: new Date(),
            },
            { session },
          );
        },
        { writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    await recordOperationalMetric(db, {
      kind: "job",
      name: "artwork",
      operation: "render",
      outcome: "success",
      durationMs: Date.now() - now.getTime(),
      attempt: job.attempts,
    });
    console.info(
      JSON.stringify({
        event: "evolution_artwork_published",
        jobId: job._id,
        sourceEventId,
        profileId: profile._id,
        artifactId: artifact._id,
        version,
      }),
    );
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z][a-z0-9_]{0,100}$/.test(error.message)
        ? error.message
        : "artwork_provider_unavailable";
    const retry = Number(job.attempts) < 3;
    await jobs.updateOne(
      { _id: job._id, lease_token: workerToken },
      {
        $set: {
          status: retry ? "queued" : "manual_review",
          last_error_code: code,
          next_attempt_at: retry
            ? new Date(Date.now() + 30000 * 2 ** Number(job.attempts))
            : null,
          lease_token: null,
          lease_until: null,
          updated_at: new Date(),
        },
      },
    );
    await recordOperationalMetric(db, {
      kind: "job",
      name: "artwork",
      operation: "render",
      outcome: "failure",
      durationMs: Date.now() - now.getTime(),
      attempt: job.attempts,
    });
    console.error(
      JSON.stringify({
        event: retry ? "artwork_retry_scheduled" : "artwork_manual_review",
        jobId: job._id,
        code,
      }),
    );
  }
  return true;
}
