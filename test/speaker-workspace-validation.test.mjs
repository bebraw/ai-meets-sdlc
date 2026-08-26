import assert from "node:assert/strict";
import test from "node:test";

import { validateSpeakerWorkspaceContent } from "../worker/speaker-workspace.ts";

function validContent() {
  return {
    profile: {
      bio: "A practical speaker biography with enough detail for the public event programme.",
      devto: "",
      github: "https://github.com/example",
      linkedin: "https://www.linkedin.com/in/example/",
      name: "Example Speaker",
      role: "Principal Engineer",
      scholar: "",
      website: "https://example.com",
      x: "https://x.com/example",
    },
    talks: [
      {
        abstract:
          "A concrete description of the session and what attendees will learn from it.",
        id: "assigned-talk",
        title: "A useful talk title",
      },
    ],
  };
}

test("speaker content validation accepts assigned talks and HTTPS profiles", () => {
  const result = validateSpeakerWorkspaceContent(validContent(), [
    "assigned-talk",
  ]);

  assert.deepEqual(result.errors, {});
  assert.equal(result.content?.talks[0]?.id, "assigned-talk");
  assert.equal(result.content?.profile.website, "https://example.com/");
});

test("speaker content validation rejects changes to talk ownership", () => {
  const content = validContent();
  content.talks[0].id = "somebody-elses-talk";

  const result = validateSpeakerWorkspaceContent(content, ["assigned-talk"]);

  assert.equal(
    result.errors["talks.0.id"],
    "Talk assignment was not recognized.",
  );
  assert.equal(result.errors.talks, "Every assigned talk must be included.");
  assert.equal(result.content, undefined);
});

test("speaker content validation rejects unsafe Markdown and social URLs", () => {
  const content = validContent();
  content.profile.bio =
    "A biography with unsafe markup that should never reach the public site. <script>alert(1)</script>";
  content.profile.linkedin = "https://example.com/not-linkedin";
  content.profile.github = "http://github.com/example";

  const result = validateSpeakerWorkspaceContent(content, ["assigned-talk"]);

  assert.equal(
    result.errors["profile.bio"],
    "HTML and embedded images are not supported.",
  );
  assert.equal(
    result.errors["profile.linkedin"],
    "Enter a LinkedIn profile URL.",
  );
  assert.equal(result.errors["profile.github"], "Enter a complete HTTPS URL.");
  assert.equal(result.content, undefined);
});
