"use client";

// The browser half of both passkey ceremonies. Everything that decides
// anything happens on the server (app/actions.ts → lib/webauthn.ts); this file
// only shuttles bytes between a server action and the authenticator.

import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/actions";
import {
  beginPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
  removePasskeyAction,
} from "@/app/actions";
import { fromBase64Url, toBase64Url } from "@/lib/crypto";
import { fmtDate, timeAgo } from "@/lib/format";
import { PRF_SALT } from "@/lib/keys";
import type { PasskeyRegistrationOptions, PasskeySignInOptions } from "@/lib/webauthn";
import { prfWithheld, rememberPrf, useKeyring } from "./keyring";
import { ActError, useAct } from "./use-act";

const toBase64url = (bytes: ArrayBuffer) => toBase64Url(new Uint8Array(bytes));
const fromBase64url = (value: string): BufferSource => fromBase64Url(value);

/**
 * The rp id comes from AUTH_URL and the browser's refusal on a mismatch is a bare SecurityError,
 * so name both addresses (127.0.0.1 vs localhost is the usual cause).
 */
function originMismatch(expected: string): string | null {
  if (window.location.origin === expected) return null;
  return `This page is ${window.location.origin}, but passkeys are set up for ${expected}. Open the app there instead.`;
}

/** What went wrong, in words a member can act on; the browser's own reason goes to the console. */
function ceremonyError(err: unknown, verb: string): string {
  console.error("passkey ceremony failed", err);
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") {
    return `Cancelled or timed out — nothing was ${verb}. If no prompt appeared, your passkey manager may be locked.`;
  }
  if (name === "InvalidStateError") return "This device already has a passkey for Souvenir.";
  if (name === "SecurityError") {
    // The server already refuses an IP or an insecure host, so this is something subtler: name it.
    return `This site can't offer passkeys from this address (${err instanceof Error ? err.message : name}).`;
  }
  if (name === "NotSupportedError")
    return "This device can't make a passkey of the kind we asked for.";
  return name ? `That didn't work (${name}). Try again.` : "That didn't work. Try again.";
}

// The PRF extension: the authenticator hands back a secret derived from this
// salt and its own, the same on every device the passkey syncs to; it backs the
// keyring up (components/keyring.tsx). Authenticators without it return nothing.
const prfExtension = () =>
  ({ prf: { eval: { first: PRF_SALT } } }) as AuthenticationExtensionsClientInputs;

/**
 * A `get()` whose only point is the PRF secret: the challenge is local and the assertion is
 * dropped, since nobody is being signed in. The authenticator evaluates the PRF on `get()`
 * where it would not on `create()`, and this phone may already hold the keys a backup wants
 * without ever having signed in here with the passkey. True when a secret was kept.
 */
export async function fetchPrf(rpId: string, credentialIds: string[]): Promise<boolean> {
  if (!window.PublicKeyCredential || credentialIds.length === 0) return false;
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        allowCredentials: credentialIds.map((id) => ({
          type: "public-key",
          id: fromBase64url(id),
        })),
        userVerification: "preferred",
        timeout: 60_000,
        extensions: prfExtension(),
      },
    });
  } catch (err) {
    console.warn("no PRF secret from this passkey", err);
    return false;
  }
  return credential ? rememberPrf(credential as PublicKeyCredential) : false;
}

type Begun<O> = ActionResult & { options?: O };

/** Either ceremony end to end: options from the server, the authenticator, keep the PRF result. */
async function ceremony<O extends { origin: string }>(
  begin: () => Promise<Begun<O>>,
  perform: (
    options: O,
    extensions: AuthenticationExtensionsClientInputs,
  ) => Promise<Credential | null>,
  verb: string,
  absent: string,
): Promise<{ credential: PublicKeyCredential; options: O } | { error: string }> {
  if (!window.PublicKeyCredential) return { error: "This browser doesn't support passkeys." };
  const begun = await begin();
  if (!begun.ok || !begun.options) return { error: begun.error ?? "Couldn't start. Try again." };
  const mismatch = originMismatch(begun.options.origin);
  if (mismatch) return { error: mismatch };
  let credential: PublicKeyCredential | null;
  try {
    credential = (await perform(begun.options, prfExtension())) as PublicKeyCredential | null;
  } catch (err) {
    return { error: ceremonyError(err, verb) };
  }
  if (!credential) return { error: absent };
  await rememberPrf(credential);
  return { credential, options: begun.options };
}

/** The wire shape a finish action expects; see lib/webauthn.ts. */
export interface RegistrationWire {
  id: string;
  clientDataJSON: string;
  attestationObject: string;
}

export interface SignInWire {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** The registration ceremony; adding a passkey, joining and recovering differ only in `begin`. */
export async function createCredential(
  begin: () => Promise<Begun<PasskeyRegistrationOptions>>,
  verb: string,
): Promise<{ wire: RegistrationWire } | { error: string }> {
  const made = await ceremony(
    begin,
    (options, extensions) =>
      navigator.credentials.create({
        publicKey: {
          challenge: fromBase64url(options.challenge),
          rp: options.rp,
          user: {
            id: fromBase64url(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          excludeCredentials: options.excludeCredentials.map((c) => ({
            type: c.type,
            id: fromBase64url(c.id),
          })),
          authenticatorSelection: options.authenticatorSelection,
          attestation: options.attestation,
          timeout: options.timeout,
          extensions,
        },
      }),
    verb,
    `No passkey was ${verb}.`,
  );
  if ("error" in made) return made;
  const { credential, options } = made;
  // Chrome enables the PRF on create() and evaluates it only on get(): ask once more, now, so
  // the phone that enrolled the passkey — the one with the keys — is the one that backs them up.
  // A refusal here costs the backup, never the passkey.
  if (prfWithheld(credential)) await fetchPrf(options.rp.id, [credential.id]);
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    wire: {
      id: credential.id,
      clientDataJSON: toBase64url(response.clientDataJSON),
      attestationObject: toBase64url(response.attestationObject),
    },
  };
}

/** The sign-in ceremony: no credential list, so the browser offers whichever passkey it holds for this site. */
export async function getCredential(
  begin: () => Promise<Begun<PasskeySignInOptions>>,
): Promise<{ wire: SignInWire } | { error: string }> {
  const got = await ceremony(
    begin,
    (options, extensions) =>
      navigator.credentials.get({
        publicKey: {
          challenge: fromBase64url(options.challenge),
          rpId: options.rpId,
          userVerification: options.userVerification,
          timeout: options.timeout,
          extensions,
        },
      }),
    "signed in",
    "No passkey was offered.",
  );
  if ("error" in got) return got;
  const { credential } = got;
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    wire: {
      id: credential.id,
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature),
    },
  };
}

async function enrolPasskey(): Promise<ActionResult> {
  const made = await createCredential(beginPasskeyRegistrationAction, "added");
  if ("error" in made) return { ok: false, error: made.error };
  return finishPasskeyRegistrationAction(made.wire);
}

export function AddPasskeyButton({
  className,
  label = "Add a passkey",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const { pending, error, act } = useAct();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          act(async () => {
            const res = await enrolPasskey();
            if (res.ok) router.refresh();
            return res;
          })
        }
        className={
          className ??
          "rounded-md bg-felt px-3 py-2 text-sm font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
        }
      >
        {pending ? "Waiting for your device…" : label}
      </button>
      <ActError error={error} />
    </span>
  );
}

export interface PasskeySummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  backedUp: boolean;
  /** A keyring backup exists under this passkey's secret. */
  wrapped: boolean;
}

/**
 * Whether this passkey backs the keys up, and the one thing to do about it when it does not:
 * hand over its secret here, on a phone that holds keys. Sealed under a passkey this phone has
 * no secret for, a backup cannot be refreshed from here either — the same tap fixes that.
 */
function KeyBackup({ passkey, rpId }: { passkey: PasskeySummary; rpId: string }) {
  const router = useRouter();
  const { status, keyring, passkeys, backUpNow } = useKeyring();
  const { pending, error, act } = useAct();
  const holdsKeys = status === "ready" && Object.keys(keyring.trips).length > 0;
  const secretHere = passkeys.includes(passkey.id);
  const label = passkey.wrapped ? "Backs up your keys" : "No key backup yet";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-soft">
      <span>{label}</span>
      {holdsKeys && !secretHere && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act(async () => {
              if (!(await fetchPrf(rpId, [passkey.id]))) {
                return { ok: false, error: "This passkey didn't hand over its secret here." };
              }
              const written = await backUpNow();
              if (!written.includes(passkey.id)) {
                return { ok: false, error: "The backup didn't go through. Try again." };
              }
              router.refresh();
              return { ok: true };
            })
          }
          className="btn btn-link px-1 py-0 text-xs text-felt"
        >
          {pending ? "Waiting for your device…" : "Back up keys here"}
        </button>
      )}
      <ActError error={error} />
    </span>
  );
}

export function PasskeyManager({ passkeys, rpId }: { passkeys: PasskeySummary[]; rpId: string }) {
  const router = useRouter();
  const { pending, error, act } = useAct();

  return (
    <div>
      {passkeys.length === 0 ? (
        <p className="text-sm text-soft">
          No passkeys yet. Adding one takes a tap — your device makes a key, and nothing about you
          is stored.
        </p>
      ) : (
        <ul className="card list">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {passkey.backedUp ? "Synced passkey" : "This device only"}
                </p>
                <p className="truncate text-xs text-soft">
                  Added {fmtDate(passkey.createdAt)}
                  {passkey.lastUsedAt
                    ? ` · last used ${timeAgo(passkey.lastUsedAt)}`
                    : " · not used yet"}
                </p>
                <KeyBackup passkey={passkey} rpId={rpId} />
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  act(async () => {
                    const res = await removePasskeyAction(passkey.id);
                    if (res.ok) router.refresh();
                    return res;
                  })
                }
                className="btn btn-link px-2 py-1 text-xs text-soft"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      <div className="mt-3">
        <AddPasskeyButton label={passkeys.length === 0 ? "Add a passkey" : "Add another device"} />
      </div>
    </div>
  );
}
