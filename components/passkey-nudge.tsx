import Link from "next/link";
import { AddPasskeyButton } from "@/components/passkeys";
import { routes } from "@/lib/routes";

/**
 * For every member who hasn't enrolled a passkey, on every page: Google sign-in is a fallback,
 * so the button is here, not a page away. Plain language in every lingo: a notice, not flavour.
 */
export function PasskeyNudge({ needsPicture }: { memberId?: string; needsPicture: boolean }) {
  return (
    <div className="mx-auto mt-4 max-w-5xl px-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-gold/40 bg-gold/10 px-4 py-3">
        <div className="min-w-64 flex-1">
          <p className="font-semibold">Add a passkey so this phone can sign you in.</p>
          <p className="text-sm text-soft">
            One tap with Face ID, a fingerprint, or your phone. No password, no email, nothing about
            you stored.
            {needsPicture && (
              <>
                {" "}
                While you're at it,{" "}
                <Link href={routes.account} className="text-felt hover:underline">
                  upload a picture
                </Link>{" "}
                — your Google photo is gone, and initials are standing in.
              </>
            )}
          </p>
        </div>
        <AddPasskeyButton />
      </div>
    </div>
  );
}
