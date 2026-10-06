"use client";

import { useEffect, useState } from "react";
import { secretFromFragment, unwrapPreview } from "@/lib/keys";
import { stashSecret } from "./take-key";

export function JoinPreview({ code, sealed }: { code: string; sealed: string | null }) {
  const [preview, setPreview] = useState<{ name: string; questions: string[] } | null>(null);
  useEffect(() => {
    const secret = secretFromFragment(window.location.hash);
    if (!secret) return;
    stashSecret(code);
    if (!sealed) return;
    let cancelled = false;
    // A preview that will not open is no preview.
    unwrapPreview(secret, sealed).then(
      (p) => !cancelled && setPreview(p),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [code, sealed]);
  if (!preview) return null;
  return (
    <>
      <p className="display text-2xl font-extrabold uppercase tracking-wide">{preview.name}</p>
      {preview.questions.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {preview.questions.map((q) => (
            <li key={q} className="flex gap-2">
              <span aria-hidden className="text-gold">
                ◆
              </span>
              <span className="font-semibold">{q}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
