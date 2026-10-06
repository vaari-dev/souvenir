"use client";

// The root layout itself threw: this renders its own document with no stylesheet, so the
// globals.css palette is inline. Reported like any other boundary.

import { useEffect } from "react";
import { sendReport } from "@/components/error-reporter";
import { routes } from "@/lib/routes";

const paper = "#f1eee4";
const surface = "#fbfaf4";
const ink = "#21261f";
const soft = "#6b7365";
const line = "#d9d4c2";
const felt = "#1f4a38";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    sendReport("global", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: paper,
          color: ink,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>Something went wrong · Souvenir</title>
        <main
          style={{
            maxWidth: "28rem",
            padding: "1.5rem",
            border: `1px solid ${line}`,
            borderRadius: "0.5rem",
            background: surface,
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.5rem", textTransform: "uppercase" }}>
            Something went wrong
          </h1>
          <p style={{ color: soft, fontSize: "0.875rem" }}>
            It has been noted. Trying again usually works.
          </p>
          {error.digest && (
            <p style={{ color: soft, fontSize: "0.75rem", fontFamily: "ui-monospace, monospace" }}>
              ref {error.digest}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button
              type="button"
              onClick={retry}
              style={{
                padding: "0.5rem 1rem",
                border: 0,
                borderRadius: "0.375rem",
                background: felt,
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.875rem",
              }}
            >
              Try again
            </button>
            <a
              href={routes.trips}
              style={{
                padding: "0.5rem 1rem",
                border: `1px solid ${line}`,
                borderRadius: "0.375rem",
                color: ink,
                fontWeight: 600,
                fontSize: "0.875rem",
                textDecoration: "none",
              }}
            >
              Your trips
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
