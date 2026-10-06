// Sign-in and cookie sessions on node:crypto, no auth library. Passkeys (challenges minted
// below, verified by lib/webauthn.ts) and Google.
//
// Google: OAuth 2.0 code + PKCE (S256), `state` for CSRF, `nonce` bound into the ID token. The
// code is exchanged server-to-server over TLS, so per OIDC Core §3.1.3.7 the TLS identity stands
// in for the ID token's signature; every gating claim is still checked in verifyIdToken().
//
// Sessions are `base64url(json).base64url(hmac)` in an httpOnly cookie. Only a member id and an
// expiry live inside, so signing suffices.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env.ts";
import { logger } from "./logger.ts";
import { relyingPartyFrom } from "./webauthn.ts";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

// Must match the redirect URI registered with Google.
const CALLBACK_PATH = "/api/auth/callback/google";

const SESSION_COOKIE = "souvenir_session";
const HANDSHAKE_COOKIE = "souvenir_oauth";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
const HANDSHAKE_MAX_AGE_S = 60 * 10; // long enough to pick an account, no longer

const secureCookies = env.AUTH_URL.startsWith("https://");

const cookieDefaults = {
  httpOnly: true,
  secure: secureCookies,
  // "lax": the return from Google is a top-level GET, which "strict" would strip of cookies.
  sameSite: "lax",
  path: "/",
} as const;

export const googleConfigured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

// --- signed-cookie primitives -------------------------------------------------

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hmac(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// Tamper-evident, not secret.
function seal(claims: Record<string, unknown>, maxAgeSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...claims, exp: nowSeconds() + maxAgeSeconds }),
  ).toString("base64url");
  return `${body}.${hmac(body)}`;
}

async function setSigned(
  name: string,
  claims: Record<string, unknown>,
  maxAgeSeconds: number,
): Promise<void> {
  (await cookies()).set(name, seal(claims, maxAgeSeconds), {
    ...cookieDefaults,
    maxAge: maxAgeSeconds,
  });
}

/** Single use: deleted whatever the caller makes of it. */
async function takeSigned(name: string): Promise<Record<string, unknown> | null> {
  const jar = await cookies();
  const claims = unseal(jar.get(name)?.value);
  jar.delete(name);
  return claims;
}

function unseal(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const split = token.lastIndexOf(".");
  if (split < 1) return null;
  const body = token.slice(0, split);
  if (!constantTimeEqual(token.slice(split + 1), hmac(body))) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return null;
    const { exp } = claims as { exp?: unknown };
    if (typeof exp !== "number" || exp <= nowSeconds()) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

// --- sessions -----------------------------------------------------------------

export type Session = { memberId: string };

export async function getSession(): Promise<Session | null> {
  const claims = unseal((await cookies()).get(SESSION_COOKIE)?.value);
  const memberId = claims?.memberId;
  return typeof memberId === "string" ? { memberId } : null;
}

// Writes a cookie: server actions and route handlers only.
export async function createSession(memberId: string): Promise<void> {
  await setSigned(SESSION_COOKIE, { memberId }, SESSION_MAX_AGE_S);
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// --- consent --------------------------------------------------------------------
//
// Google creates the member in the callback, where no form is, so the "18+ and agree" tick
// rides over in a short signed cookie.

const CONSENT_COOKIE = "souvenir_consent";

export async function noteSignInIntent(intent: { agreed: boolean; next: string }): Promise<void> {
  await setSigned(
    CONSENT_COOKIE,
    { agreed: intent.agreed, next: safeNext(intent.next) },
    HANDSHAKE_MAX_AGE_S,
  );
}

export async function takeSignInIntent(): Promise<{ agreed: boolean; next: string }> {
  const claims = await takeSigned(CONSENT_COOKIE);
  return {
    agreed: claims?.agreed === true,
    next: safeNext(typeof claims?.next === "string" ? claims.next : "/"),
  };
}

// Never an open redirect.
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

// --- Google OAuth -------------------------------------------------------------

export type GoogleProfile = { email: string; name: string | null };

function redirectUri(): string {
  return `${env.AUTH_URL}${CALLBACK_PATH}`;
}

/** Stashes state/nonce/verifier in a short-lived signed cookie; returns the Google URL. */
export async function startGoogleSignIn(): Promise<string> {
  if (!env.AUTH_GOOGLE_ID) throw new Error("Google sign-in is not configured");

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  await setSigned(HANDSHAKE_COOKIE, { state, nonce, verifier }, HANDSHAKE_MAX_AGE_S);

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", env.AUTH_GOOGLE_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Null on any failure; the caller never reports which step failed. */
export async function completeGoogleSignIn(params: URLSearchParams): Promise<GoogleProfile | null> {
  const handshake = await takeSigned(HANDSHAKE_COOKIE);

  const clientId = env.AUTH_GOOGLE_ID;
  const clientSecret = env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) return null;

  if (params.get("error")) {
    logger.info({ error: params.get("error") }, "google sign-in cancelled");
    return null;
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!handshake || !code || !state) {
    logger.warn("oauth callback: missing code, state, or handshake cookie");
    return null;
  }
  if (typeof handshake.state !== "string" || !constantTimeEqual(state, handshake.state)) {
    logger.warn("oauth callback: state mismatch");
    return null;
  }

  let tokens: { id_token?: unknown };
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        code_verifier: String(handshake.verifier ?? ""),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "oauth token exchange failed");
      return null;
    }
    tokens = await res.json();
  } catch (err) {
    logger.warn({ err }, "oauth token exchange errored");
    return null;
  }

  if (typeof tokens.id_token !== "string") {
    logger.warn("oauth token exchange returned no id_token");
    return null;
  }
  return verifyIdToken(tokens.id_token, String(handshake.nonce ?? ""));
}

// Signature deliberately unchecked: see the file header.
function verifyIdToken(idToken: string, nonce: string): GoogleProfile | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;

  let claims: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    claims = parsed as Record<string, unknown>;
  } catch {
    logger.warn("id token payload was not valid JSON");
    return null;
  }

  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (claims.aud !== env.AUTH_GOOGLE_ID) return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds()) return null;
  if (typeof claims.nonce !== "string" || !constantTimeEqual(claims.nonce, nonce)) {
    logger.warn("id token nonce mismatch");
    return null;
  }
  // Else an unverified Google account on an invited address would pass the allowlist.
  if (claims.email_verified !== true) {
    logger.warn("id token email is not verified");
    return null;
  }
  if (typeof claims.email !== "string" || !claims.email) return null;

  return {
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}

// --- passkeys -----------------------------------------------------------------
//
// The challenge rides in a short-lived signed cookie: not secret, but it must return unaltered
// and be usable once.

const rp = relyingPartyFrom(env.AUTH_URL);

export const RP_ID = rp.rpId;
export const RP_ORIGIN = rp.origin;
export const passkeysConfigured = rp.usable;

if (!passkeysConfigured) {
  logger.warn(
    { authUrl: env.AUTH_URL, rpId: RP_ID, reason: rp.reason },
    "passkeys are unavailable for this deployment",
  );
}

const PASSKEY_COOKIE = "souvenir_passkey";
const PASSKEY_MAX_AGE_S = 60 * 5;

/**
 * Which ceremony a challenge was minted for; they never cross, so a "recover" cannot be
 * finished as a "join" nor a "register" as a recovery of somebody else's seat. A "signup" is a
 * join with no link.
 */
export type PasskeyPurpose = "register" | "login" | "join" | "recover" | "signup";

/** Remembered between a link ceremony's two steps; both are re-checked against the database. */
export interface LinkClaims {
  memberId: string;
  code: string;
}

export interface PasskeyChallenge {
  challenge: string;
  link?: LinkClaims;
}

export async function startPasskeyChallenge(
  purpose: PasskeyPurpose,
  link?: LinkClaims,
): Promise<string> {
  const challenge = randomBytes(32).toString("base64url");
  await setSigned(PASSKEY_COOKIE, { ...link, challenge, purpose }, PASSKEY_MAX_AGE_S);
  return challenge;
}

export async function takePasskeyChallenge(
  purpose: PasskeyPurpose,
): Promise<PasskeyChallenge | null> {
  const claims = await takeSigned(PASSKEY_COOKIE);
  if (!claims || claims.purpose !== purpose) return null;
  if (typeof claims.challenge !== "string") return null;
  const { memberId, code } = claims;
  return {
    challenge: claims.challenge,
    link: typeof memberId === "string" && typeof code === "string" ? { memberId, code } : undefined,
  };
}
