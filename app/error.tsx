"use client";

// The boundary under the root layout. The server gets a report (components/error-reporter);
// the member gets the digest, which finds it in the log.
//
// A stale build is not a break and not reported: a deploy renamed an action while the page sat
// open. Retrying reruns the same stale bundle, so the button must reload (see stale-build).

import Link from "next/link";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect } from "react";
import { sendReport } from "@/components/error-reporter";
import { routes } from "@/lib/routes";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Before the narrowing below: past the type guard `error` has no digest to read.
  const digest = error.digest;
  const stale = unstable_isUnrecognizedActionError(error);

  useEffect(() => {
    console.error(error);
    // The server already logged a stale build, and a deploy can hit every phone at once.
    if (!stale) sendReport("boundary", error);
  }, [error, stale]);

  return (
    <div className="card mx-auto max-w-md p-6">
      <p className="eyebrow">{stale ? "New version" : "Something went wrong"}</p>
      <h1 className="display text-3xl font-extrabold uppercase tracking-wide">
        {stale ? "Souvenir updated" : "This page broke"}
      </h1>
      <p className="mt-2 text-sm text-soft">
        {stale
          ? "A new version went out while this page was open, so the server stopped answering this tab. Reload and carry on — everything already posted is on the log."
          : "It has been noted. Trying again usually works; if it keeps happening, your trips are safe ground."}
      </p>
      {!stale && digest && <p className="mono mt-2 text-xs text-soft">ref {digest}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={stale ? () => window.location.reload() : retry}
          className="btn btn-felt px-4 py-2 text-sm"
        >
          {stale ? "Reload" : "Try again"}
        </button>
        <Link href={routes.trips} className="btn btn-line px-4 py-2 text-sm">
          Your trips
        </Link>
      </div>
    </div>
  );
}
