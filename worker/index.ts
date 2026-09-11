import {
  isSpeakerDinnerPath,
  readSpeakerDinnerAdminItems,
  readSpeakerDinnerSharedAdminItems,
  readSpeakerDinnerSharedInvite,
  formatSpeakerDinnerCsv,
  handleSpeakerDinnerInvite,
  handleSpeakerDinnerSharedInvite,
  handleSpeakerDinnerPurge,
  withSpeakerDinnerSecurityHeaders,
  handleSpeakerDinnerStatus,
  handleSpeakerDinnerResponse,
  handleSpeakerDinnerSharedStatus,
  handleSpeakerDinnerSharedResponse,
  shouldPurgeSpeakerDinnerData,
  purgeSpeakerDinnerData,
} from "./speaker-dinner.ts";
import {
  isInternalAdminSlidesPath,
  getAdminSlideRedirect,
  calendarResponse,
  getAssetRequest,
  acceptsHtml,
  serveNotFound,
  injectRuntimeConfig,
  withStaticAssetCache,
} from "./static-responses.ts";
import { jsonResponse, requireAdminAction } from "./form-utils.ts";
import {
  readInterestContacts,
  formatContactsCsv,
  handleInterest,
} from "./interests.ts";
import {
  readPosterProposals,
  formatPosterProposalsCsv,
  handlePosterProposalStatus,
  handlePosterProposal,
} from "./poster-proposals.ts";
import {
  backupInterests,
  backupPosterProposals,
  backupCanonicalSpeakerContent,
} from "./backups.ts";
import {
  isAdminProtectedPath,
  handleAdminAuthRequest,
  requireAdmin,
  withAdminSecurityHeaders,
} from "./admin-auth.ts";
import {
  isSpeakerWorkspacePath,
  withSpeakerWorkspaceSecurityHeaders,
  handleSpeakerWorkspaceRequest,
  purgeExpiredSpeakerWorkspaceData,
} from "./speaker-workspace.ts";
import {
  serveCanonicalSpeakerPhoto,
  isCanonicalPublicHtmlPath,
  applyCanonicalContentToResponse,
} from "./public-content.ts";
import {
  handleSocialRenderRequest,
  handleSpeakerPromotionManifestRequest,
} from "./social-renderer.ts";
import { readPublicCanonicalSpeakers } from "./canonical-content.ts";
import { backupSpeakerReceipts } from "./receipt-backups.ts";
import { handleEventFeed } from "./event-feed.ts";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === "/event.json" ||
      url.pathname === "/event.schema.json"
    ) {
      return handleEventFeed(request, env);
    }
    const isAdminProtected = isAdminProtectedPath(url.pathname);
    const isSpeakerDinnerPrivate = isSpeakerDinnerPath(url.pathname);
    const isSpeakerWorkspacePrivate = isSpeakerWorkspacePath(url.pathname);

    try {
      const canonicalPhotoResponse = await serveCanonicalSpeakerPhoto(
        request,
        env,
      );

      if (canonicalPhotoResponse) return canonicalPhotoResponse;
    } catch (error) {
      console.error("canonical_speaker_photo_error", {
        error: error instanceof Error ? error.message : String(error),
        pathname: url.pathname,
      });
      return new Response("Speaker photo temporarily unavailable.", {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "60" },
      });
    }

    const socialRenderResponse = await handleSocialRenderRequest(
      request,
      env,
      ctx,
    );

    if (socialRenderResponse) return socialRenderResponse;

    const promotionManifestResponse =
      await handleSpeakerPromotionManifestRequest(request, env);

    if (promotionManifestResponse) return promotionManifestResponse;

    if (isInternalAdminSlidesPath(url.pathname)) {
      return new Response("Not found.", {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      });
    }

    if (url.pathname === "/admin") {
      return Response.redirect(`${url.origin}/admin/`, 308);
    }

    if (url.pathname === "/speaker") {
      return withSpeakerWorkspaceSecurityHeaders(
        Response.redirect(`${url.origin}/speaker/`, 308),
      );
    }

    const adminAuthResponse = await handleAdminAuthRequest(request, env);

    if (adminAuthResponse) return adminAuthResponse;

    if (isAdminProtected) {
      const unauthorizedResponse = await requireAdmin(request, env);

      if (unauthorizedResponse) return unauthorizedResponse;
    }

    const speakerWorkspaceResponse = await handleSpeakerWorkspaceRequest(
      request,
      env,
      ctx,
    );

    if (speakerWorkspaceResponse) return speakerWorkspaceResponse;

    const adminSlideRedirect = getAdminSlideRedirect(url);

    if (adminSlideRedirect) {
      return withAdminSecurityHeaders(
        Response.redirect(adminSlideRedirect, 308),
      );
    }

    if (url.pathname === "/api/admin/interests") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const contacts = await readInterestContacts(env);

      return jsonResponse({ contacts, count: contacts.length }, 200, {
        "cache-control": "no-store",
      });
    }

    if (url.pathname === "/api/admin/interests.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const contacts = await readInterestContacts(env);

      return new Response(formatContactsCsv(contacts), {
        headers: {
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="sdlcai-interests.csv"',
          "content-type": "text/csv; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/admin/poster-proposals") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const proposals = await readPosterProposals(env);

      return jsonResponse({ proposals, count: proposals.length }, 200, {
        "cache-control": "no-store",
      });
    }

    if (url.pathname === "/api/admin/poster-proposals.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const proposals = await readPosterProposals(env);

      return new Response(formatPosterProposalsCsv(proposals), {
        headers: {
          "cache-control": "no-store",
          "content-disposition":
            'attachment; filename="sdlcai-poster-proposals.csv"',
          "content-type": "text/csv; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/admin/poster-proposals/status") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "update-poster-status",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return handlePosterProposalStatus(request, env);
    }

    if (url.pathname === "/api/admin/speaker-dinner") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const [speakers, sharedResponses, sharedInvite] = await Promise.all([
        readSpeakerDinnerAdminItems(env),
        readSpeakerDinnerSharedAdminItems(env),
        readSpeakerDinnerSharedInvite(request, env),
      ]);

      return withAdminSecurityHeaders(
        jsonResponse({
          count: speakers.length + sharedResponses.length,
          shared_invite_active: sharedInvite.active,
          shared_invite_url: sharedInvite.invite_url,
          shared_responses: sharedResponses,
          speakers,
        }),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const [speakers, sharedResponses] = await Promise.all([
        readSpeakerDinnerAdminItems(env),
        readSpeakerDinnerSharedAdminItems(env),
      ]);

      return withAdminSecurityHeaders(
        new Response(formatSpeakerDinnerCsv(speakers, sharedResponses), {
          headers: {
            "content-disposition":
              'attachment; filename="sdlcai-speaker-dinner-caterer.csv"',
            "content-type": "text/csv; charset=utf-8",
          },
        }),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner/invite") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "rotate-speaker-dinner-invite",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return withAdminSecurityHeaders(
        await handleSpeakerDinnerInvite(request, env),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner/shared-invite") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "rotate-speaker-dinner-shared-invite",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return withAdminSecurityHeaders(
        await handleSpeakerDinnerSharedInvite(request, env),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner/purge") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "purge-speaker-dinner-data",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return withAdminSecurityHeaders(
        await handleSpeakerDinnerPurge(request, env),
      );
    }

    if (url.pathname === "/api/interest") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleInterest(request, env);
    }

    if (url.pathname === "/api/poster-proposals") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handlePosterProposal(request, env);
    }

    if (url.pathname === "/api/speaker-dinner") {
      if (request.method === "GET") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerStatus(request, env),
        );
      }

      if (request.method === "POST") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerResponse(request, env),
        );
      }

      return withSpeakerDinnerSecurityHeaders(
        jsonResponse({ error: "Method not allowed" }, 405),
      );
    }

    if (url.pathname === "/api/speaker-dinner/shared") {
      if (request.method === "GET") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerSharedStatus(request, env),
        );
      }

      if (request.method === "POST") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerSharedResponse(request, env),
        );
      }

      return withSpeakerDinnerSecurityHeaders(
        jsonResponse({ error: "Method not allowed" }, 405),
      );
    }

    if (url.pathname === "/calendar.ics") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return calendarResponse();
    }

    const assetRequest = getAssetRequest(request, url);
    let response = await env.ASSETS.fetch(assetRequest);

    if (response.status === 404 && acceptsHtml(request)) {
      response = await serveNotFound(request, env, response);
    } else if (response.headers.get("content-type")?.includes("text/html")) {
      response = await injectRuntimeConfig(response, env);
    }

    if (
      response.ok &&
      request.method !== "HEAD" &&
      isCanonicalPublicHtmlPath(url.pathname)
    ) {
      try {
        response = await applyCanonicalContentToResponse(
          response,
          await readPublicCanonicalSpeakers(env),
          { private: isAdminProtected },
        );
      } catch (error) {
        console.error("canonical_public_content_fallback", {
          error: error instanceof Error ? error.message : String(error),
          pathname: url.pathname,
        });
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store");
        headers.set("x-sdlcai-content-source", "bundled-fallback");
        response = new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        });
      }
    }

    if (isAdminProtected) return withAdminSecurityHeaders(response);

    if (isSpeakerDinnerPrivate) {
      return withSpeakerDinnerSecurityHeaders(response);
    }

    if (isSpeakerWorkspacePrivate) {
      return withSpeakerWorkspaceSecurityHeaders(response);
    }

    return withStaticAssetCache(response, url);
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (env.INTEREST_BACKUPS) {
      ctx.waitUntil(backupInterests(env));
      ctx.waitUntil(backupPosterProposals(env));
      ctx.waitUntil(backupCanonicalSpeakerContent(env));
      ctx.waitUntil(backupSpeakerReceipts(env));
    }

    if (shouldPurgeSpeakerDinnerData(env)) {
      ctx.waitUntil(purgeSpeakerDinnerData(env));
    }

    ctx.waitUntil(purgeExpiredSpeakerWorkspaceData(env));
  },
} satisfies ExportedHandler<Env>;
