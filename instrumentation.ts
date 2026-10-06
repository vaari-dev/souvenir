import type { Instrumentation } from "next";

// Importing lib/env here validates the environment at boot, not on the first request. In
// production it also routes console through lib/logger, so Next's own errors are JSON lines.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    if (env.NODE_ENV === "production") {
      const { consoleToLogger } = await import("@/lib/logger");
      consoleToLogger();
    }
  }
}

/**
 * One record per failed request, with its route; shares the digest with Next's own line. The
 * path is masked and headers omitted: a link's code is a path segment, a session a cookie.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/lib/logger");
  const { maskPath } = await import("@/lib/report");
  const digest =
    typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  logger.error(
    {
      err,
      digest,
      method: request.method,
      path: maskPath(request.path),
      route: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
    },
    "request failed",
  );
};
