import {
  requireAdminMutation,
  adminSecure,
  isSameOriginMutation,
  secure,
  json,
} from "./speaker-workspace-utils.ts";
import {
  authenticateSpeaker,
  requestSpeakerLogin,
  redeemSpeakerInvitation,
  endSpeakerSession,
} from "./speaker-login.ts";
import {
  getAdminSpeakers,
  sendSpeakerInvitation,
  saveSpeakerContact,
  saveAdminSpeakerContent,
  reviewSpeakerRevision,
} from "./speaker-admin.ts";
import {
  getSpeakerAnnouncements,
  previewSpeakerAnnouncement,
  testSpeakerAnnouncement,
  sendSpeakerAnnouncement,
  retrySpeakerAnnouncement,
} from "./speaker-announcements.ts";
import {
  getSpeakerDinner,
  updateSpeakerDinner,
  getSpeakerPresentation,
  updateSpeakerPresentation,
} from "./speaker-responses.ts";
import {
  getSpeakerWorkspace,
  updateSpeakerWorkspace,
} from "./speaker-content.ts";
import {
  handleStreamWebhookRequest,
  handleAdminSpeakerVideoRequest,
  handleSpeakerVideoRequest,
} from "./speaker-videos.ts";
import {
  handleAdminReceiptRequest,
  handleSpeakerReceiptRequest,
} from "./speaker-receipts.ts";
import {
  handleAdminSpeakerPhotoRequest,
  handleSpeakerPhotoRequest,
} from "./speaker-photos.ts";
import {
  canonicalSpeakerIds,
  readCanonicalSpeaker,
} from "./canonical-content.ts";

export { withSpeakerWorkspaceSecurityHeaders } from "./speaker-workspace-utils.ts";
export { validateSpeakerWorkspaceContent } from "./speaker-content-validation.ts";
export { purgeExpiredSpeakerWorkspaceData } from "./speaker-cleanup.ts";

export function isSpeakerWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/speaker" ||
    pathname.startsWith("/speaker/") ||
    pathname.startsWith("/api/speaker/")
  );
}

export async function handleSpeakerWorkspaceRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/stream/webhook") {
    return handleStreamWebhookRequest(request, env);
  }

  if (
    url.pathname === "/api/admin/receipts" ||
    url.pathname === "/api/admin/receipts.csv" ||
    url.pathname.startsWith("/api/admin/receipts/")
  ) {
    if (!["GET", "HEAD"].includes(request.method)) {
      const forbidden = requireAdminMutation(
        request,
        "manage-speaker-receipts",
      );
      if (forbidden) return adminSecure(forbidden);
    }
    return adminSecure(await handleAdminReceiptRequest(request, env));
  }

  if (
    url.pathname === "/api/speaker/receipts" ||
    url.pathname.startsWith("/api/speaker/receipts/")
  ) {
    if (
      !["GET", "HEAD"].includes(request.method) &&
      !isSameOriginMutation(request)
    ) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }
    const session = await authenticateSpeaker(request, env);
    if (session instanceof Response) return secure(session);
    return secure(
      await handleSpeakerReceiptRequest(request, env, session.speaker_id),
    );
  }

  if (url.pathname.startsWith("/api/admin/speakers/videos/")) {
    if (url.pathname === "/api/admin/speakers/videos/review") {
      const forbidden = requireAdminMutation(request, "review-speaker-video");

      if (forbidden) return adminSecure(forbidden);
    }

    return adminSecure(await handleAdminSpeakerVideoRequest(request, env));
  }

  if (url.pathname.startsWith("/api/admin/speakers/photos/")) {
    const action =
      url.pathname === "/api/admin/speakers/photos/review"
        ? "review-speaker-photo"
        : url.pathname === "/api/admin/speakers/photos/upload"
          ? "upload-speaker-photo"
          : null;

    if (action) {
      const forbidden = requireAdminMutation(request, action);

      if (forbidden) return adminSecure(forbidden);
    }

    return adminSecure(
      await handleAdminSpeakerPhotoRequest(request, env, canonicalSpeakerIds),
    );
  }

  if (url.pathname === "/api/admin/speakers") {
    if (request.method !== "GET") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    return adminSecure(await getAdminSpeakers(env));
  }

  if (url.pathname === "/api/admin/speakers/invite") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "send-speaker-invite");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await sendSpeakerInvitation(request, env));
  }

  if (url.pathname === "/api/admin/speakers/contact") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "save-speaker-contact");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await saveSpeakerContact(request, env));
  }

  if (url.pathname === "/api/admin/speakers/content") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "save-speaker-content");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await saveAdminSpeakerContent(request, env));
  }

  if (url.pathname === "/api/admin/speakers/review") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "review-speaker-revision");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await reviewSpeakerRevision(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements") {
    if (request.method !== "GET") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    return adminSecure(await getSpeakerAnnouncements(env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/preview") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "preview-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await previewSpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/test") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "test-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await testSpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/send") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "send-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await sendSpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/retry") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "retry-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await retrySpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/speaker/login") {
    if (request.method !== "POST") {
      return secure(json({ error: "Method not allowed" }, 405));
    }

    return secure(await requestSpeakerLogin(request, env, ctx));
  }

  if (url.pathname === "/api/speaker/session") {
    if (request.method === "POST") {
      return secure(await redeemSpeakerInvitation(request, env));
    }

    if (request.method === "DELETE") {
      return secure(await endSpeakerSession(request, env));
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  if (url.pathname === "/api/speaker/dinner") {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    if (request.method === "GET") {
      return secure(await getSpeakerDinner(session.speaker_id, env));
    }

    if (request.method === "POST") {
      return secure(
        await updateSpeakerDinner(request, session.speaker_id, env),
      );
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  if (url.pathname === "/api/speaker/presentation") {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    if (request.method === "GET") {
      return secure(await getSpeakerPresentation(session.speaker_id, env));
    }

    if (request.method === "POST") {
      return secure(
        await updateSpeakerPresentation(request, session.speaker_id, env),
      );
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  if (
    url.pathname === "/api/speaker/photo" ||
    url.pathname === "/api/speaker/photo/image"
  ) {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    return secure(
      await handleSpeakerPhotoRequest(request, env, session.speaker_id),
    );
  }

  if (
    url.pathname === "/api/speaker/videos" ||
    url.pathname === "/api/speaker/videos/upload" ||
    /^\/api\/speaker\/videos\/[0-9a-f-]{36}\/preview$/iu.test(url.pathname)
  ) {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    const canonicalRecord = await readCanonicalSpeaker(env, session.speaker_id);

    if (!canonicalRecord) {
      return secure(json({ error: "Speaker profile was not found." }, 404));
    }

    return secure(
      await handleSpeakerVideoRequest(
        request,
        env,
        session.speaker_id,
        canonicalRecord.content.talks.map(({ id }) => id),
      ),
    );
  }

  if (url.pathname === "/api/speaker/workspace") {
    if (request.method === "GET") {
      return secure(await getSpeakerWorkspace(request, env));
    }

    if (request.method === "POST") {
      return secure(await updateSpeakerWorkspace(request, env));
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  return null;
}
