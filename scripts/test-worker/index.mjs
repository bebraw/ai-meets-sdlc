import worker from "../../worker/index.ts";
export * from "../../worker/index.ts";

// Wrangler normally injects this in dev builds. A precompiled production bundle
// lacks it, so early 401/403/405 responses can reset the local request transport.
// Keep this test-only facade equivalent to Wrangler's request-body middleware.
export default {
  ...worker,
  async fetch(request, env, ctx) {
    try {
      return await worker.fetch(request, env, ctx);
    } finally {
      if (request.body && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {}
      }
    }
  },
};
