"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  destroySession,
  type LinkClaims,
  type PasskeyChallenge,
  type PasskeyPurpose,
  passkeysConfigured,
  RP_ID,
  RP_ORIGIN,
  safeNext,
  startPasskeyChallenge,
  takePasskeyChallenge,
} from "@/lib/auth";
import {
  type Appended,
  acceptTerms,
  addCredential,
  appendEvent,
  bumpEpoch,
  clearAvatar,
  createAccount,
  createTrip,
  DataError,
  deleteAccount,
  eventsSince,
  findCredential,
  findInvite,
  findRecovery,
  getMember,
  joinTripWithInvite,
  joinWithInvite,
  type KeyGrant,
  type KeyGrantInput,
  type KeyHandover,
  keyringWrapsOf,
  leaveTrip,
  listCredentials,
  markInboxSeen,
  mintInvite,
  mintRecovery,
  mintRekey,
  myGrant,
  noteCredentialUse,
  publishCard,
  recoverWithLink,
  removeCredential,
  removeMember,
  revokeInvite,
  revokeRecovery,
  revokeRekey,
  saveKeyringWrap,
  setAvatar,
  setLingo,
  setName,
  setRole,
  spendRekey,
  type TripUpdate,
  takeGrant,
  tripFor,
  unpublishCard,
  updateTrip,
} from "@/lib/data";
import type { EventRow, MembershipRole } from "@/lib/db/schema";
import { inviteState, inviteUrl } from "@/lib/invites";
import { isLingoKey, lingoOf } from "@/lib/lingo";
import { linkState } from "@/lib/links";
import {
  type Interpretation,
  interpret,
  llmEnabled,
  type PolishedDraft,
  polishMarketDraft,
} from "@/lib/llm";
import { logger } from "@/lib/logger";
import { recoveryUrl } from "@/lib/recovery";
import { rekeyUrl } from "@/lib/rekeys";
import { reportBudget, tidyReport } from "@/lib/report";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import {
  clampUtterance,
  type Gender,
  pairFor,
  type Side as TalkSide,
  worthSaying,
} from "@/lib/talk";
import type { TripInput } from "@/lib/trips";
import {
  type PasskeyRegistrationOptions,
  type PasskeySignInOptions,
  registrationOptions,
  signInOptions,
  type VerifiedRegistration,
  verifyAssertion,
  verifyRegistration,
  WebAuthnError,
} from "@/lib/webauthn";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Checked against the member row, not just the cookie: a session can outlive its account. */
async function requireMemberId(): Promise<string> {
  const member = await currentMember();
  if (!member) redirect(routes.signin);
  return member.id;
}

function failure(err: unknown, memberId?: string): ActionResult {
  if (err instanceof DataError) {
    logger.debug({ memberId, reason: err.message }, "action rejected");
    return { ok: false, error: err.message };
  }
  logger.error({ err, memberId }, "action failed");
  return { ok: false, error: "Something went wrong. Try again." };
}

const LAYOUT = "layout";

/** Every mutation: act as the signed-in member, turn a broken rule into a message, revalidate. */
function mutate(run: (memberId: string) => Promise<void>, paths?: string[]): Promise<ActionResult>;
function mutate<T extends object>(
  run: (memberId: string) => Promise<T>,
  paths?: string[] | ((result: T) => string[]),
): Promise<ActionResult & Partial<T>>;
async function mutate<T extends object>(
  run: (memberId: string) => Promise<unknown>,
  paths: string[] | ((result: T) => string[]) = [],
): Promise<ActionResult & Partial<T>> {
  const memberId = await requireMemberId();
  let result: T;
  try {
    result = ((await run(memberId)) ?? {}) as T;
  } catch (err) {
    return failure(err, memberId) as ActionResult & Partial<T>;
  }
  for (const path of typeof paths === "function" ? paths(result) : paths) {
    if (path === LAYOUT) revalidatePath("/", "layout");
    else revalidatePath(path);
  }
  return { ok: true, ...result };
}

// ---------- what a phone reports ----------

/** Reports a process takes per minute; past that they are dropped, not queued. */
const takeReport = reportBudget(120, 60_000);

/**
 * Where a crashed phone reports (components/error-reporter). Signed out is fine: the root
 * boundary can fire before anyone is. Nothing comes back, so nothing can be probed.
 */
export async function reportClientErrorAction(raw: unknown): Promise<void> {
  const report = tidyReport(raw);
  if (!report || !takeReport(Date.now())) return;
  const member = await currentMember();
  logger.error({ memberId: member?.id ?? null, client: report }, "client error");
}

// ---------- trips ----------

/** Returns rather than redirects: the phone still has to seal the first event with its new key. */
export async function createTripAction(
  input: TripInput & { id: string; nameEnc: string },
): Promise<ActionResult & { tripId?: string }> {
  return mutate(
    async (memberId) => ({ tripId: (await createTrip(memberId, input)).id }),
    [routes.trips],
  );
}

export async function updateTripAction(tripId: string, input: TripUpdate): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await updateTrip(memberId, tripId, input);
    },
    [routes.trip(tripId), routes.settings(tripId), routes.trips],
  );
}

/** `envelope` is the sealed `member.role` event the organiser's phone made to match. */
export async function setRoleAction(
  tripId: string,
  memberId: string,
  role: MembershipRole,
  envelope: string,
): Promise<ActionResult> {
  if (typeof envelope !== "string") return { ok: false, error: "That didn't come through right." };
  return mutate(
    (actorId) => setRole(actorId, tripId, memberId, role, envelope),
    [routes.members(tripId), routes.member(tripId, memberId)],
  );
}

export async function polishAction(
  question: string,
  criteria: string,
  feedback: string,
): Promise<ActionResult & { draft?: PolishedDraft }> {
  const memberId = await requireMemberId();
  if (!llmEnabled) return { ok: false, error: "The magic isn't switched on for this deploy." };
  if (!question.trim() && !criteria.trim()) {
    return {
      ok: false,
      error: "Write a rough draft first — the magic needs something to work with.",
    };
  }
  try {
    const member = await getMember(memberId);
    const register = lingoOf(member?.lingo ?? "english").register;
    const draft = await polishMarketDraft({ question, criteria }, feedback, register);
    return { ok: true, draft };
  } catch (err) {
    logger.error({ err }, "polish failed");
    return { ok: false, error: "The magic fizzled. Try again." };
  }
}

// ---------- the sealed log ----------
// Append an envelope, fetch what landed since. Meaning is decided on the phone (lib/replay.ts);
// the server checks seat and epoch.

export async function appendEventAction(
  tripId: string,
  envelope: string,
): Promise<ActionResult & Partial<Appended>> {
  if (typeof envelope !== "string") return { ok: false, error: "That didn't come through right." };
  return mutate((memberId) => appendEvent(memberId, tripId, envelope));
}

export async function eventsSinceAction(
  tripId: string,
  afterSeq: number,
): Promise<ActionResult & { rows?: EventRow[] }> {
  if (!Number.isInteger(afterSeq) || afterSeq < 0) return { ok: false, error: "Bad cursor." };
  return mutate(async (memberId) => ({ rows: await eventsSince(memberId, tripId, afterSeq) }));
}

export async function markInboxSeenAction(tripId: string): Promise<ActionResult> {
  return mutate((memberId) => markInboxSeen(tripId, memberId));
}

// ---------- rekey links ----------

export async function mintRekeyAction(
  tripId: string,
  forMemberId: string,
  wrappedKey: string,
  epoch: number,
): Promise<ActionResult & { url?: string; code?: string }> {
  return mutate(
    async (actorId) => {
      const code = await mintRekey(actorId, tripId, forMemberId, wrappedKey, epoch);
      return { url: rekeyUrl(RP_ORIGIN, code), code };
    },
    [routes.members(tripId)],
  );
}

export async function redeemRekeyAction(
  code: string,
): Promise<ActionResult & { tripId?: string; key?: KeyHandover }> {
  return mutate(
    async (memberId) => {
      const row = await spendRekey(memberId, code);
      return { tripId: row.tripId, key: { wrappedKey: row.wrappedKey, epoch: row.epoch } };
    },
    ({ tripId }) => [routes.members(tripId)],
  );
}

export async function revokeRekeyAction(tripId: string, code: string): Promise<ActionResult> {
  return mutate((actorId) => revokeRekey(actorId, code), [routes.members(tripId)]);
}

// ---------- the card ----------

const cardLines = z
  .array(z.object({ name: z.string().max(40), profitC: z.number().int() }))
  .max(12);
const cardSchema = z.object({
  marketId: z.string().min(1).max(64),
  tripName: z.string().max(60),
  question: z.string().min(1).max(200),
  verdict: z.enum(["yes", "no", "refunded"]),
  winners: cardLines,
  losers: cardLines,
});

export async function publishCardAction(tripId: string, input: unknown): Promise<ActionResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That's not a card." };
  return mutate(
    (memberId) => publishCard(memberId, tripId, parsed.data),
    [routes.card(parsed.data.marketId)],
  );
}

export async function unpublishCardAction(marketId: string): Promise<ActionResult> {
  return mutate((memberId) => unpublishCard(memberId, marketId), [routes.card(marketId)]);
}

// ---------- talk ----------

async function pairOf(memberId: string, tripId: string) {
  const ctx = await tripFor(memberId, tripId);
  return ctx ? pairFor(ctx.trip) : null;
}

export async function interpretAction(
  tripId: string,
  text: string,
  to: TalkSide,
  speaking: Gender,
): Promise<ActionResult & { said?: Interpretation }> {
  const memberId = await requireMemberId();
  if (!llmEnabled) {
    return { ok: false, error: "Live interpreting isn't switched on for this deploy." };
  }
  const pair = await pairOf(memberId, tripId);
  if (!pair) return { ok: false, error: "Nothing to interpret on this trip." };
  const utterance = clampUtterance(text);
  if (!worthSaying(utterance)) {
    return { ok: false, error: "Nothing came through. Say that again?" };
  }
  const target = to === "them" ? pair.them : pair.us;
  const source = to === "them" ? pair.us : pair.them;
  try {
    const said = await interpret({
      text: utterance,
      to: target.language,
      from: source.language,
      place: pair.place,
      romanise: target.script !== "Latin",
      politeness: to === "them" ? pair.them.particles?.[speaking]?.prompt : undefined,
    });
    return { ok: true, said };
  } catch (err) {
    logger.error({ err, to }, "interpreting failed");
    return { ok: false, error: "That didn't come back. Try it again." };
  }
}

// ---------- keys ----------

export async function removeMemberAction(tripId: string, memberId: string): Promise<ActionResult> {
  return mutate((actorId) => removeMember(actorId, tripId, memberId), [routes.members(tripId)]);
}

export async function leaveTripAction(tripId: string): Promise<ActionResult> {
  return mutate((memberId) => leaveTrip(memberId, tripId), [routes.trips]);
}

export async function bumpEpochAction(
  tripId: string,
  input: { epoch: number; nameEnc: string; grants: KeyGrantInput[] },
): Promise<ActionResult> {
  return mutate(
    (actorId) => bumpEpoch(actorId, tripId, input),
    [routes.trip(tripId), routes.members(tripId)],
  );
}

export async function myGrantAction(
  tripId: string,
): Promise<ActionResult & { grant?: KeyGrant | null }> {
  return mutate(async (memberId) => ({ grant: await myGrant(memberId, tripId) }));
}

export async function takeGrantAction(id: string): Promise<ActionResult> {
  return mutate((memberId) => takeGrant(memberId, id));
}

export async function saveKeyringWrapAction(
  credentialId: string,
  blob: string,
): Promise<ActionResult> {
  return mutate((memberId) => saveKeyringWrap(memberId, credentialId, blob));
}

export async function keyringWrapsAction(): Promise<
  ActionResult & { wraps?: { credentialId: string; blob: string }[] }
> {
  return mutate(async (memberId) => ({ wraps: await keyringWrapsOf(memberId) }));
}

// ---------- account ----------

export async function setLingoAction(lingo: string): Promise<ActionResult> {
  if (!isLingoKey(lingo)) return { ok: false, error: "Pick a lingo from the list." };
  return mutate((memberId) => setLingo(memberId, lingo), [LAYOUT]);
}

export async function setNameAction(name: string): Promise<ActionResult> {
  return mutate((memberId) => setName(memberId, name), [LAYOUT]);
}

export async function acceptTermsAction(): Promise<ActionResult> {
  return mutate((memberId) => acceptTerms(memberId), [LAYOUT]);
}

export async function deleteAccountAction(confirm: string): Promise<ActionResult> {
  if (confirm.trim().toUpperCase() !== "DELETE") {
    return { ok: false, error: "Type DELETE to confirm." };
  }
  const result = await mutate((memberId) => deleteAccount(memberId));
  if (!result.ok) return result;
  await destroySession();
  redirect(routes.home);
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect(routes.home);
}

export async function setAvatarAction(formData: FormData): Promise<ActionResult> {
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick an image first." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return mutate((memberId) => setAvatar(memberId, bytes), [LAYOUT]);
}

export async function clearAvatarAction(): Promise<ActionResult> {
  return mutate((memberId) => clearAvatar(memberId), [LAYOUT]);
}

// ---------- invites ----------

/** The link comes back without its fragment: the secret never reaches the server. */
export async function mintInviteAction(
  tripId: string,
  label: string,
  opts: { isOpen?: boolean; wrappedKey: string; epoch: number; preview: string },
): Promise<ActionResult & { url?: string; code?: string }> {
  return mutate(
    async (memberId) => {
      const code = await mintInvite(tripId, memberId, label, opts);
      return { url: inviteUrl(RP_ORIGIN, code), code };
    },
    [routes.members(tripId)],
  );
}

export async function revokeInviteAction(code: string): Promise<ActionResult> {
  const invite = await findInvite(code);
  return mutate(
    (memberId) => revokeInvite(memberId, code),
    invite ? [routes.members(invite.tripId)] : [],
  );
}

export async function joinAsMemberAction(
  code: string,
): Promise<ActionResult & { tripId?: string; key?: KeyHandover | null }> {
  return mutate(
    (memberId) => joinTripWithInvite(memberId, code),
    ({ tripId }) => [routes.trips, routes.members(tripId)],
  );
}

// ---------- passkeys ----------
// Two round trips; the challenge lives in a signed cookie between them (lib/auth.ts), the
// checking is lib/webauthn.ts. Every field a finish action receives is untrusted.

const RP = { id: RP_ID, name: "Souvenir" } as const;
const RP_CHECK = { rpId: RP_ID, origin: RP_ORIGIN } as const;

const NOT_CONFIGURED =
  "Passkeys need this server to be reachable by hostname over HTTPS (or localhost) — " +
  "AUTH_URL is currently an IP address.";
const NOT_VERIFIED = "That passkey didn't check out. Try again.";

/** A refused ceremony is the authenticator disagreeing with us, not a fault. */
function ceremonyFailure(err: unknown, message = NOT_VERIFIED, context: object = {}): ActionResult {
  if (!(err instanceof WebAuthnError)) return failure(err);
  logger.warn({ ...context, reason: err.message }, "passkey ceremony rejected");
  return { ok: false, error: message };
}

const registrationSchema = z.object({
  id: z.string().min(1).max(512),
  clientDataJSON: z.string().min(1).max(4096),
  attestationObject: z.string().min(1).max(16_384),
});

const assertionSchema = z.object({
  id: z.string().min(1).max(512),
  clientDataJSON: z.string().min(1).max(4096),
  authenticatorData: z.string().min(1).max(4096),
  signature: z.string().min(1).max(4096),
});

async function beginRegistration(
  purpose: PasskeyPurpose,
  memberId: string,
  displayName: string,
  opts: { link?: LinkClaims; exclude?: string[] } = {},
): Promise<ActionResult & { options?: PasskeyRegistrationOptions }> {
  return {
    ok: true,
    options: registrationOptions({
      rp: RP,
      origin: RP_ORIGIN,
      challenge: await startPasskeyChallenge(purpose, opts.link),
      memberId,
      displayName,
      exclude: opts.exclude,
    }),
  };
}

/** Step two's preamble: the posted body and the cookie the ceremony left, or null for either missing. */
async function takeCeremony<S extends z.ZodType>(
  schema: S,
  input: unknown,
  purpose: PasskeyPurpose,
): Promise<{ data: z.infer<S>; pending: PasskeyChallenge } | null> {
  const parsed = schema.safeParse(input);
  const pending = await takePasskeyChallenge(purpose);
  if (!parsed.success || !pending) {
    logger.warn({ purpose }, "passkey ceremony: malformed response or expired challenge");
    return null;
  }
  return { data: parsed.data, pending };
}

async function verifyNewPasskey(
  response: z.infer<typeof registrationSchema>,
  challenge: string,
  duplicateMessage: string,
): Promise<VerifiedRegistration> {
  const verified = verifyRegistration(response, { ...RP_CHECK, challenge });
  if (await findCredential(verified.credentialId)) throw new DataError(duplicateMessage);
  return verified;
}

/** Ceremonies that make an account or take a seat are for the signed-out only. */
async function refuseSignedIn(): Promise<ActionResult | null> {
  if (!passkeysConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (await currentMember()) return { ok: false, error: "You're already signed in." };
  return null;
}

export async function beginPasskeyRegistrationAction(): Promise<
  ActionResult & { options?: PasskeyRegistrationOptions }
> {
  const memberId = await requireMemberId();
  if (!passkeysConfigured) return { ok: false, error: NOT_CONFIGURED };
  const member = await getMember(memberId);
  if (!member) redirect(routes.signin);
  const held = await listCredentials(memberId);
  return beginRegistration("register", memberId, member.name, {
    exclude: held.map((c) => c.id),
  });
}

export async function finishPasskeyRegistrationAction(response: unknown): Promise<ActionResult> {
  const memberId = await requireMemberId();
  const ceremony = await takeCeremony(registrationSchema, response, "register");
  if (!ceremony) return { ok: false, error: "That took too long. Try adding the passkey again." };
  try {
    const verified = await verifyNewPasskey(
      ceremony.data,
      ceremony.pending.challenge,
      "That passkey is already on the list.",
    );
    await addCredential(memberId, verified);
  } catch (err) {
    return ceremonyFailure(err, NOT_VERIFIED, { memberId });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Unauthenticated, and without an allowCredentials list: nobody types an identifier. */
export async function beginPasskeySignInAction(): Promise<
  ActionResult & { options?: PasskeySignInOptions }
> {
  if (!passkeysConfigured) return { ok: false, error: NOT_CONFIGURED };
  return {
    ok: true,
    options: signInOptions({ ...RP_CHECK, challenge: await startPasskeyChallenge("login") }),
  };
}

export async function finishPasskeySignInAction(
  response: unknown,
  next?: string,
): Promise<ActionResult> {
  const ceremony = await takeCeremony(assertionSchema, response, "login");
  if (!ceremony) return { ok: false, error: "That took too long. Try signing in again." };

  // One message for both failures: an unauthenticated caller must not learn which.
  const rejected: ActionResult = { ok: false, error: "That passkey didn't work. Try again." };
  const credential = await findCredential(ceremony.data.id);
  if (!credential) {
    logger.warn("passkey sign-in: unknown credential");
    return rejected;
  }
  let memberId: string;
  try {
    const verified = verifyAssertion(
      ceremony.data,
      { ...RP_CHECK, challenge: ceremony.pending.challenge },
      credential,
    );
    const member = await getMember(credential.memberId);
    if (!member) {
      logger.warn({ memberId: credential.memberId }, "passkey sign-in: member is gone");
      return rejected;
    }
    await noteCredentialUse(credential.id, verified.signCount, verified.backedUp);
    memberId = member.id;
  } catch (err) {
    return ceremonyFailure(err, rejected.error);
  }
  await createSession(memberId);
  logger.info({ memberId, provider: "passkey" }, "member signed in");
  redirect(safeNext(next));
}

export async function removePasskeyAction(credentialId: string): Promise<ActionResult> {
  return mutate((memberId) => removeCredential(memberId, credentialId), [routes.account]);
}

// ---------- an account from nothing ----------
// The join ceremony without an invite. The member id is minted at step one and carried in the
// sealed challenge, so passkey and row agree on who this is.

const signupSchema = z.object({
  name: z.string().min(1).max(64),
  lingo: z.string().max(32).optional(),
  agreed: z.literal(true),
  response: registrationSchema,
});

const lingoOrDefault = (lingo: string | undefined) => (isLingoKey(lingo ?? "") ? lingo : undefined);

export async function beginSignupAction(
  name: string,
): Promise<ActionResult & { options?: PasskeyRegistrationOptions }> {
  const refused = await refuseSignedIn();
  if (refused) return refused;
  const memberId = randomUUID();
  return beginRegistration("signup", memberId, name.trim() || "New member", {
    link: { memberId, code: "signup" },
  });
}

export async function finishSignupAction(input: unknown): Promise<ActionResult> {
  const ceremony = await takeCeremony(signupSchema, input, "signup");
  if (!ceremony?.pending.link) {
    return { ok: false, error: "That took too long, or the box wasn't ticked. Try again." };
  }
  let memberId: string;
  try {
    const verified = await verifyNewPasskey(
      ceremony.data.response,
      ceremony.pending.challenge,
      "That passkey already belongs to an account. Sign in instead.",
    );
    const member = await createAccount({
      memberId: ceremony.pending.link.memberId,
      name: ceremony.data.name,
      lingo: lingoOrDefault(ceremony.data.lingo),
      credential: verified,
    });
    memberId = member.id;
  } catch (err) {
    return ceremonyFailure(err);
  }
  await createSession(memberId);
  logger.info({ memberId }, "member signed in");
  redirect(routes.newTrip);
}

// ---------- joining by invite link ----------

const joinSchema = signupSchema.extend({ code: z.string().min(1).max(128) });

export async function beginJoinAction(
  code: string,
  name: string,
): Promise<ActionResult & { options?: PasskeyRegistrationOptions }> {
  const refused = await refuseSignedIn();
  if (refused) return refused;
  const invite = await findInvite(code);
  if (!invite || inviteState(invite, new Date()) !== "live") {
    return { ok: false, error: "That invite link has already been used or has expired." };
  }
  const memberId = randomUUID();
  return beginRegistration("join", memberId, name.trim() || invite.label, {
    link: { memberId, code },
  });
}

export async function finishJoinAction(
  input: unknown,
): Promise<ActionResult & { tripId?: string; key?: KeyHandover | null }> {
  const ceremony = await takeCeremony(joinSchema, input, "join");
  if (!ceremony?.pending.link) {
    return {
      ok: false,
      error: "That took too long, or the box wasn't ticked. Open the link again.",
    };
  }
  // The link finished with must be the one the ceremony started for.
  if (ceremony.pending.link.code !== ceremony.data.code) {
    logger.warn("join: challenge belongs to a different invite");
    return { ok: false, error: "That didn't work. Open the link again." };
  }
  let joined: Awaited<ReturnType<typeof joinWithInvite>>;
  try {
    const verified = await verifyNewPasskey(
      ceremony.data.response,
      ceremony.pending.challenge,
      "That passkey already belongs to an account. Sign in instead.",
    );
    joined = await joinWithInvite({
      code: ceremony.data.code,
      memberId: ceremony.pending.link.memberId,
      name: ceremony.data.name,
      lingo: lingoOrDefault(ceremony.data.lingo),
      credential: verified,
    });
  } catch (err) {
    return ceremonyFailure(err);
  }
  await createSession(joined.member.id);
  logger.info({ memberId: joined.member.id }, "member signed in");
  revalidatePath(routes.members(joined.tripId));
  return { ok: true, tripId: joined.tripId, key: joined.key };
}

// ---------- recovering a seat ----------
// The one flow that hands over an account with history: its own challenge purpose, the member id
// pinned at step one and re-checked at step two, the link spent in the transaction that stores
// the key (lib/data.ts).

const recoverSchema = z.object({
  code: z.string().min(1).max(128),
  response: registrationSchema,
});

/** `key` is a shared trip's key under the link's secret, sealed on the organiser's phone; null when it has none. */
export async function mintRecoveryAction(
  tripId: string,
  memberId: string,
): Promise<ActionResult & { url?: string; code?: string }> {
  return mutate(
    async (actorId) => {
      const code = await mintRecovery(actorId, memberId);
      return { url: recoveryUrl(RP_ORIGIN, code), code };
    },
    [routes.members(tripId), routes.member(tripId, memberId)],
  );
}

export async function shutOwnRecoveryAction(code: string): Promise<ActionResult> {
  return mutate((memberId) => revokeRecovery(memberId, code));
}

export async function revokeRecoveryAction(tripId: string, code: string): Promise<ActionResult> {
  return mutate((memberId) => revokeRecovery(memberId, code), [routes.members(tripId)]);
}

export async function beginRecoveryAction(
  code: string,
): Promise<ActionResult & { options?: PasskeyRegistrationOptions }> {
  const refused = await refuseSignedIn();
  if (refused) return refused;
  const row = await findRecovery(code);
  if (!row || linkState(row, new Date()) !== "live") {
    return { ok: false, error: "That recovery link has already been used or has expired." };
  }
  const member = await getMember(row.memberId);
  if (!member) return { ok: false, error: "That seat is gone." };
  // Excluding keys already on the seat lets a device that can still sign in say so.
  const held = await listCredentials(member.id);
  return beginRegistration("recover", member.id, member.name, {
    link: { memberId: member.id, code },
    exclude: held.map((c) => c.id),
  });
}

export async function finishRecoveryAction(input: unknown): Promise<ActionResult> {
  const ceremony = await takeCeremony(recoverSchema, input, "recover");
  if (!ceremony?.pending.link) {
    return { ok: false, error: "That took too long. Open the link again." };
  }
  if (ceremony.pending.link.code !== ceremony.data.code) {
    logger.warn("recovery: challenge belongs to a different link");
    return { ok: false, error: "That didn't work. Open the link again." };
  }
  let recovered: Awaited<ReturnType<typeof recoverWithLink>>;
  try {
    const verified = await verifyNewPasskey(
      ceremony.data.response,
      ceremony.pending.challenge,
      "That passkey is already on the list.",
    );
    recovered = await recoverWithLink({
      code: ceremony.data.code,
      memberId: ceremony.pending.link.memberId,
      credential: verified,
    });
  } catch (err) {
    return ceremonyFailure(err);
  }
  await createSession(recovered.member.id);
  logger.warn(
    { memberId: recovered.member.id, provider: "recovery" },
    "member signed in after a recovery",
  );
  // Their own page lists every key that can sign in as them.
  return { ok: true };
}
