import Link from "next/link";
import { redirect } from "next/navigation";
import { PasskeySignIn } from "@/components/passkey-sign-in";
import { SignedOutCard } from "@/components/signed-out-card";
import { createSession, googleConfigured, safeNext } from "@/lib/auth";
import { ensureMember } from "@/lib/data";
import { env } from "@/lib/env";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  // The member, not just the cookie: a session for a member absent from this database (deleted,
  // or minted against another on the same host) would bounce /signin -> /trips -> /signin
  // forever. Signing in overwrites the stale cookie.
  const me = await currentMember();
  if (me) redirect(next === "/" ? routes.trips : next);

  return (
    <SignedOutCard eyebrow="Welcome back">
      <p className="mt-3 text-sm text-soft">The app for the trip that actually happens.</p>

      {error === "AccessDenied" && (
        <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
          That account was deleted. Start again with a new one if you like.
        </p>
      )}
      {error && error !== "AccessDenied" && (
        <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
          Sign-in failed. Try again.
        </p>
      )}

      <div className="mt-6">
        <PasskeySignIn next={next} />
      </div>
      <p className="mt-3 text-xs text-soft">
        Lost every device you had a passkey on? An organiser on one of your trips can send you a
        link back in.
      </p>

      {googleConfigured && (
        <>
          <p className="mt-4 text-xs uppercase tracking-wider text-soft">or</p>
          <form action="/api/auth/google" method="get" className="mt-2 text-left">
            <input type="hidden" name="next" value={next} />
            <label className="flex items-start gap-2 text-xs text-soft">
              <input type="checkbox" name="agree" value="1" className="mt-0.5" />
              <span>
                New here? Tick to confirm you're 18+ and agree to the{" "}
                <Link href={routes.terms} className="text-felt hover:underline">
                  terms
                </Link>
                .
              </span>
            </label>
            <button type="submit" className="btn btn-line mt-2 block w-full py-3">
              Continue with Google
            </button>
          </form>
        </>
      )}

      <p className="mt-5 text-sm">
        No account?{" "}
        <Link href={routes.home} className="font-semibold text-felt hover:underline">
          Start a trip
        </Link>
      </p>

      {env.AUTH_DEV_LOGIN && (
        <form
          className="mt-4 space-y-2 border-t border-line pt-4 text-left"
          action={async (formData: FormData) => {
            "use server";
            // Re-checked on the server: the only guard against passwordless login in production.
            if (!env.AUTH_DEV_LOGIN) redirect(routes.signin);
            const email = String(formData.get("email") ?? "")
              .trim()
              .toLowerCase();
            if (!email.includes("@")) redirect("/signin?error=DevLogin");
            const name = String(formData.get("name") ?? "").trim() || email.split("@")[0];
            const { member } = await ensureMember(email, name, { termsAccepted: true });
            await createSession(member.id);
            redirect(safeNext(String(formData.get("next") ?? "/")));
          }}
        >
          <input type="hidden" name="next" value={next} />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gold">
            Dev login — local only
          </p>
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
          />
          <input
            name="name"
            type="text"
            placeholder="Display name"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
          />
          <button type="submit" className="btn btn-line w-full py-2 text-sm">
            Sign in as this person
          </button>
        </form>
      )}

      {!googleConfigured && !env.AUTH_DEV_LOGIN && (
        <p className="mt-4 text-xs text-soft">
          Passkeys only — Google sign-in isn't configured here.
        </p>
      )}
    </SignedOutCard>
  );
}
