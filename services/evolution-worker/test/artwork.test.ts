import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  validateGeneratedImage,
  verifyReferenceAssets,
} from "../src/artwork.js";

test("approved Chog references match all five pinned content hashes", () => {
  const refs = verifyReferenceAssets();
  assert.equal(refs.length, 5);
  assert.ok(refs.every((ref) => ref.sha256.startsWith("0x")));
});

test("generated image validation accepts a decodable square PNG at the minimum dimensions", async () => {
  const png = await sharp({
    create: { width: 512, height: 512, channels: 4, background: "#6540a0" },
  })
    .png()
    .toBuffer();
  const result = await validateGeneratedImage(png);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test("generated image validation rejects malformed bytes and a non-square image", async () => {
  await assert.rejects(validateGeneratedImage(Buffer.alloc(2048, 7)));
  const png = await sharp({
    create: { width: 512, height: 640, channels: 4, background: "#6540a0" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    validateGeneratedImage(png),
    /generated_image_dimensions_invalid/,
  );
});
