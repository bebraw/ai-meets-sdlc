import * as v from "valibot";

const digestPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const digestSchema = v.pipe(v.string(), v.regex(digestPattern));
const idSchema = v.pipe(v.string(), v.regex(idPattern));
const promotionAssetSchema = v.object({
  height: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  path: v.string(),
  presetId: v.picklist(["bluesky", "linkedin", "x"]),
  version: digestSchema,
  width: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});
const promotionTalkSchema = v.object({
  assets: v.pipe(v.array(promotionAssetSchema), v.minLength(1)),
  id: idSchema,
  slideId: idSchema,
  title: v.string(),
});
const promotionSpeakerSchema = v.object({
  id: idSchema,
  name: v.string(),
  photo: v.string(),
  talks: v.pipe(v.array(promotionTalkSchema), v.minLength(1)),
});
const promotionManifestSourceSchema = v.object({
  schemaVersion: v.literal(1),
  speakers: v.pipe(v.array(promotionSpeakerSchema), v.minLength(1)),
  version: digestSchema,
});

export type PromotionManifestSource = v.InferOutput<
  typeof promotionManifestSourceSchema
>;

export function parsePromotionManifestSource(
  value: unknown,
): PromotionManifestSource {
  const result = v.safeParse(promotionManifestSourceSchema, value);

  if (!result.success) {
    throw new Error("Promotion manifest has an invalid contract.");
  }

  const manifest = result.output;
  const speakerIds = new Set<string>();

  for (const speaker of manifest.speakers) {
    if (speakerIds.has(speaker.id)) {
      throw new Error("Promotion manifest has duplicate speaker IDs.");
    }
    speakerIds.add(speaker.id);

    const talkIds = new Set<string>();

    for (const talk of speaker.talks) {
      if (talkIds.has(talk.id) || talk.slideId !== `talk-${talk.id}`) {
        throw new Error("Promotion manifest has invalid talk references.");
      }
      talkIds.add(talk.id);

      const assetPaths = new Set<string>();

      for (const asset of talk.assets) {
        if (assetPaths.has(asset.path)) {
          throw new Error("Promotion manifest has duplicate asset paths.");
        }
        assetPaths.add(asset.path);
      }
    }
  }

  return manifest;
}
