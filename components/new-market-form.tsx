"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { polishAction } from "@/app/actions";
import { lingoOf } from "@/lib/lingo";
import type { PolishedDraft } from "@/lib/llm";
import { routes } from "@/lib/routes";
import { draftError } from "@/lib/views";
import { useTrip } from "./trip-store";
import { useAct } from "./use-act";

export function NewMarketForm({
  tripId,
  polishAvailable,
  lingo = "english",
  initial,
}: {
  tripId: string;
  polishAvailable: boolean;
  lingo?: string;
  initial?: { question: string; criteria: string };
}) {
  const t = lingoOf(lingo);
  const router = useRouter();
  const { append } = useTrip();
  const { pending: publishing, error, setError, act } = useAct("Couldn't publish.");
  const [polishing, startPolish] = useTransition();

  const [question, setQuestion] = useState(initial?.question ?? "");
  const [criteria, setCriteria] = useState(initial?.criteria ?? "");
  const [suggestion, setSuggestion] = useState<PolishedDraft | null>(null);
  const [feedback, setFeedback] = useState("");

  const polish = () =>
    startPolish(async () => {
      setError(null);
      const res = await polishAction(question, criteria, feedback);
      if (!res.ok || !res.draft) {
        setError(res.error ?? "The magic fizzled. Try again.");
      } else {
        setSuggestion(res.draft);
        setFeedback("");
      }
    });

  const publish = () =>
    act(async () => {
      const refused = draftError(question, criteria);
      if (refused) return { ok: false, error: refused };
      const id = crypto.randomUUID();
      const res = await append({
        t: "market.create",
        id,
        question: question.trim(),
        criteria: criteria.trim(),
      });
      if (res.ok) router.push(routes.market(tripId, id));
      return res;
    });

  const busy = publishing || polishing;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-soft">
          The prediction
        </span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          placeholder={t.questionPlaceholder}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-lg!"
        />
      </label>

      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-soft">
          How you'll resolve it
        </span>
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder={t.criteriaPlaceholder}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm"
        />
      </label>

      {polishAvailable && (
        <div className="rounded-lg border border-dashed border-felt/40 bg-felt-tint/40 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              <span className="font-semibold">✨ Sprinkle some AI magic?</span>{" "}
              <span className="text-soft">{t.magicPitch}</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={polish}
              className="shrink-0 rounded-md border border-felt px-3 py-1.5 text-sm font-semibold text-felt hover:bg-felt hover:text-white disabled:opacity-40"
            >
              {polishing ? "Working magic…" : suggestion ? "Try again" : "Work some magic"}
            </button>
          </div>

          {suggestion && (
            <div className="mt-3 min-w-0 rounded-md border border-line bg-surface p-3">
              <p className="display break-words text-lg font-bold leading-snug">
                {suggestion.question}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{suggestion.criteria}</p>
              <p className="mt-2 break-words text-xs italic text-soft">{suggestion.rationale}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setQuestion(suggestion.question);
                    setCriteria(suggestion.criteria);
                    setSuggestion(null);
                  }}
                  className="btn btn-felt px-3 py-1.5 text-sm"
                >
                  Use this version
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSuggestion(null)}
                  className="btn btn-line px-3 py-1.5 text-sm"
                >
                  Keep mine
                </button>
                <input
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Say what to change, then try again"
                  className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={publish}
        className="btn btn-felt display w-full py-3 text-xl font-bold uppercase"
      >
        {publishing ? "Publishing…" : "Publish to the group"}
      </button>

      {error && <p className="text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
