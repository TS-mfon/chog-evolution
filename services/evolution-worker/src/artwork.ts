import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { composeDemoChog } from "@chog/art-composition";

const promptVersion = "chog-evolution-v1";
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

export async function processOneArtwork(db: Db): Promise<boolean> {
  const now = new Date();
  const workerToken = randomUUID();
  const jobs = db.collection<any>("evolution_jobs");
  const job = await jobs.findOneAndUpdate(
    {
      status: { $in: ["queued", "generating"] },
      $or: [{ lease_until: null }, { lease_until: { $lt: now } }],
    },
    {
      $set: {
        status: "generating",
        lease_token: workerToken,
        lease_until: new Date(now.getTime() + 8 * 60_000),
        updated_at: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { created_at: 1 }, returnDocument: "after" },
  );
  if (!job) return false;
  const [claim, decision, profile] = await Promise.all([
    db.collection<any>("claims").findOne({ _id: job.claim_id }),
    db.collection<any>("decisions").findOne({ claim_id: job.claim_id }),
    db.collection<any>("nft_profiles").findOne({ _id: job.profile_id }),
  ]);
  if (
    !claim ||
    claim.status !== "accepted" ||
    !decision?.finalized ||
    decision.outcome !== "accepted" ||
    !profile
  ) {
    await jobs.updateOne(
      { _id: job._id, lease_token: workerToken },
      {
        $set: {
          status: "manual_review",
          last_error_code: "finalized_accepted_decision_required",
          lease_token: null,
          lease_until: null,
          updated_at: new Date(),
        },
      },
    );
    return true;
  }
  const storedArtifact = await db
    .collection<any>("artifacts")
    .findOne({ claim_id: claim._id });
  if (storedArtifact) {
    const session = db.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          await db.collection<any>("nft_profiles").updateOne(
            { _id: profile._id },
            {
              $set: {
                artwork_artifact_id: storedArtifact._id,
                artwork_url: storedArtifact.public_url,
                updated_at: new Date(),
              },
            },
            { session },
          );
          await jobs.updateOne(
            { _id: job._id, lease_token: workerToken },
            {
              $set: {
                status: "completed",
                artifact_id: storedArtifact._id,
                lease_token: null,
                lease_until: null,
                completed_at: new Date(),
                updated_at: new Date(),
              },
            },
            { session },
          );
        },
        { writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    return true;
  }
  if (!process.env.GEMINI_API_KEY) {
    await jobs.updateOne(
      { _id: job._id, lease_token: workerToken },
      {
        $set: {
          status: "manual_review",
          last_error_code: "gemini_not_configured",
          lease_token: null,
          lease_until: null,
          updated_at: new Date(),
        },
      },
    );
    return true;
  }
  try {
    const verifiedReferences = verifyReferenceAssets();
    const priorArtifact = profile.artwork_artifact_id
      ? await db
          .collection<any>("artifacts")
          .findOne({ _id: profile.artwork_artifact_id })
      : null;
    let continuityImage: Buffer;
    let continuityMime = "image/png";
    if (priorArtifact?.gridfs_id) {
      continuityImage = await readStream(
        new GridFSBucket(db, {
          bucketName: "chog_artifacts",
        }).openDownloadStream(new ObjectId(priorArtifact.gridfs_id)),
      );
      continuityMime = priorArtifact.mime_type;
    } else {
      const composition = composeDemoChog(
        String(profile.token_id),
        String(profile.stage),
      );
      continuityImage = await sharp(Buffer.from(composition.svg))
        .png()
        .toBuffer();
    }
    const stage = String(profile.stage);
    const composition = composeDemoChog(String(profile.token_id), stage);
    const prompt = `Edit the Chog character in the continuity image into its ${stage} evolution. Keep the same recognizable face, eye placement, silhouette, quills, palette, and framing. Approved stage traits: ${JSON.stringify(composition.traits)}. Add only these approved traits while retaining identity. Use the other attached images solely as approved visual references for Chog's silhouette and style. Output one centered square character illustration, no text, no watermark, clean background. This is artwork only; do not infer eligibility, XP, ownership, or authoritative traits. Prompt ${promptVersion}.`;
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const input = [
      { type: "text" as const, text: prompt },
      {
        type: "image" as const,
        mime_type: continuityMime,
        data: continuityImage.toString("base64"),
      },
      ...verifiedReferences.map(({ buffer }) => ({
        type: "image" as const,
        mime_type: "image/png",
        data: buffer.toString("base64"),
      })),
    ];
    const result = await ai.interactions.create({
      model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
      input,
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: "1:1",
        image_size: "1K",
      },
    });
    if (!result.output_image?.data)
      throw new Error("gemini_image_output_missing");
    const raw = Buffer.from(result.output_image.data, "base64");
    const image = await validateGeneratedImage(raw);
    const bucket = new GridFSBucket(db, { bucketName: "chog_artifacts" });
    const version = Number(profile.version ?? 0);
    const imageFile = await store(
      bucket,
      image,
      `${profile._id}-evolution-${version}.png`,
      "image/png",
      {
        profile_id: profile._id,
        claim_id: claim._id,
        decision_reference: decision.decision_reference,
        kind: "evolution_artwork",
      },
    );
    const artifactId = randomUUID();
    const artifact = {
      schema: "chog-artifact-v1",
      profileId: profile._id,
      claimId: claim._id,
      decisionReference: decision.decision_reference,
      evolutionVersion: version,
      xp: profile.xp,
      level: profile.level,
      stage,
      traits: composition.traits,
      image: {
        url: `/v1/artifacts/${imageFile.id}`,
        sha256: imageFile.sha256,
        bytes: imageFile.size,
        mimeType: "image/png",
      },
      provenance: {
        model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
        promptVersion,
        referenceHashes: verifiedReferences.map((ref) => ref.sha256),
        generatedAt: new Date().toISOString(),
      },
    };
    const metadataFile = await store(
      bucket,
      Buffer.from(JSON.stringify(artifact)),
      `${profile._id}-evolution-${version}.json`,
      "application/json",
      {
        profile_id: profile._id,
        claim_id: claim._id,
        kind: "evolution_metadata",
      },
    );
    await db.collection<any>("artifacts").insertOne({
      _id: artifactId,
      profile_id: profile._id,
      claim_id: claim._id,
      gridfs_id: imageFile.id,
      metadata_gridfs_id: metadataFile.id,
      image_hash: imageFile.sha256,
      metadata_hash: metadataFile.sha256,
      mime_type: "image/png",
      public_url: `/v1/artifacts/${imageFile.id}`,
      metadata_url: `/v1/artifacts/${metadataFile.id}`,
      provenance: artifact.provenance,
      created_at: new Date(),
    });
    const session = db.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          const currentJob = await jobs.findOne(
            { _id: job._id, lease_token: workerToken, status: "generating" },
            { session },
          );
          if (!currentJob) throw new Error("evolution_lease_lost");
          await db.collection<any>("nft_profiles").updateOne(
            { _id: profile._id },
            {
              $set: {
                artwork_artifact_id: artifactId,
                artwork_url: `/v1/artifacts/${imageFile.id}`,
                updated_at: new Date(),
              },
            },
            { session },
          );
          await db.collection<any>("audit_events").insertOne(
            {
              _id: randomUUID(),
              entity_type: "claim",
              entity_id: claim._id,
              action: "artwork_published",
              request_id: decision.decision_reference,
              details: {
                artifact_id: artifactId,
                image_hash: imageFile.sha256,
                metadata_hash: metadataFile.sha256,
              },
              created_at: new Date(),
            },
            { session },
          );
          await jobs.updateOne(
            { _id: job._id, lease_token: workerToken },
            {
              $set: {
                status: "completed",
                artifact_id: artifactId,
                lease_token: null,
                lease_until: null,
                completed_at: new Date(),
                updated_at: new Date(),
              },
            },
            { session },
          );
        },
        { writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    console.info(
      JSON.stringify({
        event: "evolution_artwork_published",
        jobId: job._id,
        profileId: profile._id,
        artifactId,
        imageHash: imageFile.sha256,
      }),
    );
  } catch (error) {
    const attempts = Number(job.attempts ?? 1);
    const retry = attempts < 3;
    await jobs.updateOne(
      { _id: job._id, lease_token: workerToken },
      {
        $set: {
          status: retry ? "queued" : "manual_review",
          last_error_code:
            error instanceof Error
              ? error.message.slice(0, 120)
              : "artwork_generation_failed",
          next_attempt_at: retry
            ? new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** attempts))
            : null,
          lease_token: null,
          lease_until: null,
          updated_at: new Date(),
        },
      },
    );
    console.error(
      JSON.stringify({
        event: retry ? "artwork_retry_scheduled" : "artwork_manual_review",
        jobId: job._id,
        code: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
  return true;
}
