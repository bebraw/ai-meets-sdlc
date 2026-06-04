import { backupInterests } from "./domain/backups";
import { handleAdminDashboard } from "./routes/admin-dashboard";
import { handleAdminFeatureFlagMutation } from "./routes/admin-feature-flag";
import { handleAdminRegister } from "./routes/admin-register";
import { handleAdminScheduleMutation } from "./routes/admin-schedule";
import { handleAdminTicketTierMutation } from "./routes/admin-ticket-tier";
import { handleCfpProposal } from "./routes/cfp";
import { handleCheckout } from "./routes/checkout";
import { handleInterest } from "./routes/interest";
import { handleOrderStatus } from "./routes/order";
import { handlePublicSchedule } from "./routes/schedule";
import { handleStripeWebhook } from "./routes/stripe-webhook";
import { handleTicketTiers } from "./routes/ticket-tiers";
import {
  requireAdminAuth,
  requireAdminMutationRequest,
} from "./utils/admin-auth";
import { jsonResponse } from "./utils/response";
import { injectRuntimeConfig } from "./utils/runtime-config";

type RouteHandler = (request: Request, env: Env) => Promise<Response>;

type Route = {
  action?: string;
  admin?: boolean;
  handler: RouteHandler;
  method: string;
  pathname: string;
};

const routes: Route[] = [
  {
    admin: true,
    handler: handleAdminDashboard,
    method: "GET",
    pathname: "/api/admin/dashboard",
  },
  {
    action: "register",
    admin: true,
    handler: handleAdminRegister,
    method: "POST",
    pathname: "/api/admin/register",
  },
  {
    action: "schedule",
    admin: true,
    handler: handleAdminScheduleMutation,
    method: "POST",
    pathname: "/api/admin/schedule",
  },
  {
    action: "ticket-tier",
    admin: true,
    handler: handleAdminTicketTierMutation,
    method: "POST",
    pathname: "/api/admin/ticket-tier",
  },
  {
    action: "feature-flag",
    admin: true,
    handler: handleAdminFeatureFlagMutation,
    method: "POST",
    pathname: "/api/admin/feature-flag",
  },
  {
    handler: (_request, env) => handlePublicSchedule(env),
    method: "GET",
    pathname: "/api/schedule",
  },
  {
    handler: (_request, env) => handleTicketTiers(env),
    method: "GET",
    pathname: "/api/ticket-tiers",
  },
  {
    handler: handleCheckout,
    method: "POST",
    pathname: "/api/checkout",
  },
  {
    handler: handleCfpProposal,
    method: "POST",
    pathname: "/api/cfp",
  },
  {
    handler: handleOrderStatus,
    method: "GET",
    pathname: "/api/order",
  },
  {
    handler: handleStripeWebhook,
    method: "POST",
    pathname: "/api/stripe-webhook",
  },
  {
    handler: handleInterest,
    method: "POST",
    pathname: "/api/interest",
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = routes.find(
      (candidate) => candidate.pathname === url.pathname,
    );

    if (route) {
      return handleRoute(route, request, env);
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      const authResponse = await requireAdminAuth(request, env);
      if (authResponse) return authResponse;
    }

    const response = await env.ASSETS.fetch(request);

    if (response.headers.get("content-type")?.includes("text/html")) {
      return injectRuntimeConfig(response, env);
    }

    return response;
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.INTEREST_BACKUPS) return;

    ctx.waitUntil(backupInterests(env));
  },
} satisfies ExportedHandler<Env>;

async function handleRoute(
  route: Route,
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== route.method) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (route.admin) {
    const authResponse = await requireAdminAuth(request, env);
    if (authResponse) return authResponse;
  }

  if (route.action) {
    const mutationAuthResponse = requireAdminMutationRequest(
      request,
      route.action,
    );
    if (mutationAuthResponse) return mutationAuthResponse;
  }

  return route.handler(request, env);
}
