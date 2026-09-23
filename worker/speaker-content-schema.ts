import * as v from "valibot";

export const speakerProfileContentSchema = v.object({
  bio: v.string(),
  devto: v.string(),
  github: v.string(),
  linkedin: v.string(),
  name: v.string(),
  role: v.string(),
  scholar: v.string(),
  website: v.string(),
  x: v.string(),
});

export const speakerTalkContentSchema = v.object({
  abstract: v.string(),
  id: v.string(),
  title: v.string(),
});

export const speakerWorkspaceContentSchema = v.object({
  profile: speakerProfileContentSchema,
  talks: v.array(speakerTalkContentSchema),
});

export const speakerStoredRevisionSchema = v.object({
  profile: v.object({
    bio: v.string(),
    devto: v.optional(v.string()),
    github: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    name: v.string(),
    role: v.string(),
    scholar: v.optional(v.string()),
    website: v.optional(v.string()),
    x: v.optional(v.string()),
  }),
  talks: v.array(speakerTalkContentSchema),
});

export type SpeakerProfileContent = v.InferOutput<
  typeof speakerProfileContentSchema
>;
export type SpeakerTalkContent = v.InferOutput<typeof speakerTalkContentSchema>;
export type SpeakerWorkspaceContent = v.InferOutput<
  typeof speakerWorkspaceContentSchema
>;
