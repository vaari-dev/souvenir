// All reads and writes. Every read takes a `tripId` or finds one through an id; every write checks
// the caller's seat here, not in the UI — every action is reachable by anyone who can POST.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import { MAX_AVATAR_BYTES, sniffImageType } from "./avatar.ts";
import { type EnvelopeHeader, parseEnvelope } from "./crypto.ts";
import { db } from "./db/index.ts";
import {
  avatars,
  type CredentialRow,
  cards,
  credentials,
  type EventRow,
  events,
  type InviteRow,
  invites,
  keyGrants,
  keyringWraps,
  type Member,
  type MembershipRole,
  type MembershipRow,
  members,
  memberships,
  type RecoveryRow,
  type RekeyRow,
  recoveries,
  rekeys,
  type Trip,
  trips,
} from "./db/schema.ts";
import { normalizeEmail } from "./email.ts";
import { expiresAtFrom, inviteState } from "./invites.ts";
import { expiresAfter, linkState, newLinkCode } from "./links.ts";
import { logger } from "./logger.ts";
import { RECOVERY_TTL_MS, visibleRecoveries } from "./recovery.ts";
import { CONSOLE_REKEY_TTL_MS, liveRekeys, REKEY_TTL_MS } from "./rekeys.ts";
import { TripError, type TripInput, tripConfig } from "./trips.ts";
import { DEPARTED_NAME } from "./views.ts";
import type { VerifiedRegistration } from "./webauthn.ts";

/** User-facing failures (closed market, not on the trip, …). */
export class DataError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const STALE_KEY = "This phone's key is out of date. Reload and try again.";
const GARBLED_KEY = "That key didn't come through right. Reload and try again.";
const LAST_ORGANISER = "Someone has to be able to invite. Make another member an organiser first.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function first<T>(query: PromiseLike<T[]>): Promise<T | null> {
  const [row] = await query;
  return row ?? null;
}

/** A sealed blob is opaque here, but it has a shape (`v1` and `parts` base64url pieces) and a size that is not a payload. */
function checkBlob(blob: string, parts: number, maxBytes: number, message: string): void {
  const shape = new RegExp(`^v1(\\.[A-Za-z0-9_-]+){${parts}}$`);
  if (blob.length > maxBytes || !shape.test(blob)) throw new DataError(message);
}

/** A key or a name under a link's secret or the trip key: `v1.<iv>.<ct>`. */
function checkWrapped(blob: string): void {
  checkBlob(blob, 2, 8192, GARBLED_KEY);
}

function checkEpoch(trip: { keyEpoch: number }, epoch: number): void {
  if (epoch !== trip.keyEpoch) throw new DataError(STALE_KEY);
}

// ---------- trips ----------

export interface TripContext {
  trip: Trip;
  membership: MembershipRow;
}

export async function getTrip(id: string): Promise<Trip | null> {
  return first(db.select().from(trips).where(eq(trips.id, id)));
}

export async function tripFor(memberId: string, tripId: string): Promise<TripContext | null> {
  return first(
    db
      .select({ trip: trips, membership: memberships })
      .from(memberships)
      .innerJoin(trips, eq(trips.id, memberships.tripId))
      .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId))),
  );
}

async function requireMembership(tripId: string, memberId: string): Promise<TripContext> {
  const ctx = await tripFor(memberId, tripId);
  if (!ctx) throw new DataError("You're not on this trip.");
  return ctx;
}

async function requireOrganiser(tripId: string, memberId: string): Promise<TripContext> {
  const ctx = await requireMembership(tripId, memberId);
  if (!isOrganiser(ctx)) throw new DataError("Only an organiser of this trip can do that.");
  return ctx;
}

export function isOrganiser(ctx: { membership: { role: MembershipRole } }): boolean {
  return ctx.membership.role === "organiser";
}

export interface TripSummary {
  trip: Trip;
  role: MembershipRole;
  memberCount: number;
}

/** Newest first. What is open on each is sealed; only the roster counts. */
export async function listTrips(memberId: string): Promise<TripSummary[]> {
  const rows = await db
    .select({ trip: trips, role: memberships.role })
    .from(memberships)
    .innerJoin(trips, eq(trips.id, memberships.tripId))
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(trips.createdAt));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ tripId: memberships.tripId, n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      inArray(
        memberships.tripId,
        rows.map((r) => r.trip.id),
      ),
    )
    .groupBy(memberships.tripId);
  const countBy = new Map(counts.map((c) => [c.tripId, c.n]));
  return rows.map((r) => ({
    trip: r.trip,
    role: r.role,
    memberCount: countBy.get(r.trip.id) ?? 0,
  }));
}

function configOf(input: TripInput): ReturnType<typeof tripConfig> {
  try {
    return tripConfig(input);
  } catch (err) {
    if (err instanceof TripError) throw new DataError(err.message);
    throw err;
  }
}

/** Whoever creates a trip is its first organiser. The name arrives sealed under the trip's key. */
export async function createTrip(
  creatorId: string,
  input: TripInput & { id: string; nameEnc: string },
): Promise<Trip> {
  const config = configOf(input);
  const { id, nameEnc } = input;
  if (!UUID.test(id)) throw new DataError("That didn't come through right. Try again.");
  checkWrapped(nameEnc);
  const trip = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(trips)
      .values({ id, createdBy: creatorId, keyEpoch: 0, nameEnc, ...config })
      .returning();
    await tx.insert(memberships).values({ tripId: id, memberId: creatorId, role: "organiser" });
    return created;
  });
  logger.info({ tripId: id, creatorId, destination: config.destination }, "trip created");
  return trip;
}

export type TripUpdate = Omit<TripInput, "destination" | "homeLanguage" | "homeCurrency"> & {
  /** A new name, sealed; absent leaves the name alone. */
  nameEnc?: string;
};

/** Organisers only; the language pair is fixed. */
export async function updateTrip(
  actorId: string,
  tripId: string,
  input: TripUpdate,
): Promise<Trip> {
  const { trip } = await requireOrganiser(tripId, actorId);
  const { startsOn, endsOn, maxStakePies } = configOf({
    ...input,
    destination: trip.destination,
    homeLanguage: trip.homeLanguage,
    homeCurrency: trip.homeCurrency,
  });
  if (input.nameEnc) checkWrapped(input.nameEnc);
  // Every phone applies the cap to the whole log on replay, so lowering it would refuse calls
  // already accepted and re-settle predictions. The server cannot see which rows are calls; any
  // row at all is the line.
  if (maxStakePies < trip.maxStakePies && (await hasEvents(tripId))) {
    throw new DataError("The cap can't be lowered once the game has started. Raising it is fine.");
  }
  const [updated] = await db
    .update(trips)
    .set({ startsOn, endsOn, maxStakePies, ...(input.nameEnc ? { nameEnc: input.nameEnc } : {}) })
    .where(eq(trips.id, tripId))
    .returning();
  logger.info({ tripId, actorId }, "trip updated");
  return updated;
}

/** In join order; `joinedAt` is the seat's, not the account's. */
export async function membersOf(tripId: string): Promise<(Member & { role: MembershipRole })[]> {
  const rows = await db
    .select({ member: members, role: memberships.role, joinedAt: memberships.joinedAt })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId))
    .where(and(eq(memberships.tripId, tripId), isNull(members.deletedAt)))
    .orderBy(asc(memberships.joinedAt));
  return rows.map((r) => ({ ...r.member, role: r.role, joinedAt: r.joinedAt }));
}

/** Everyone ever seated, plus log authors whose seat is gone. */
async function membersById(tripId: string): Promise<Map<string, Member>> {
  const onRecord = union(
    db.select({ id: memberships.memberId }).from(memberships).where(eq(memberships.tripId, tripId)),
    db.select({ id: events.authorId }).from(events).where(eq(events.tripId, tripId)),
  );
  const rows = await db.select().from(members).where(inArray(members.id, onRecord));
  return new Map(rows.map((m) => [m.id, m]));
}

/**
 * Never down to no organiser: nobody could then invite or recover. The organiser rows are locked
 * for the check, so two people stepping each other down at once cannot both pass it.
 */
async function requireAnotherOrganiser(
  tx: Tx,
  tripId: string,
  memberId: string,
  message = LAST_ORGANISER,
): Promise<void> {
  const organisers = await tx
    .select({ memberId: memberships.memberId })
    .from(memberships)
    .where(and(eq(memberships.tripId, tripId), eq(memberships.role, "organiser")))
    .for("update");
  if (organisers.length <= 1 && organisers.some((o) => o.memberId === memberId)) {
    throw new DataError(message);
  }
}

/**
 * Who organises is two records that must agree: the membership row, which gates invites and
 * recovery here, and a `member.role` event, which gates reopening and rotation on every phone.
 * The organiser's phone seals the event and both land in one transaction.
 */
export async function setRole(
  actorId: string,
  tripId: string,
  memberId: string,
  role: MembershipRole,
  envelope: string,
): Promise<void> {
  await requireOrganiser(tripId, actorId);
  await db.transaction(async (tx) => {
    if (role === "member") await requireAnotherOrganiser(tx, tripId, memberId);
    const updated = await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId)))
      .returning({ memberId: memberships.memberId });
    if (updated.length === 0) throw new DataError("No such member on this trip.");
    await insertEvent(tx, actorId, tripId, envelope);
    logger.warn({ actorId, tripId, memberId, role }, "role changed");
  });
}

/**
 * A seat goes: the member's live key links and the invites they minted go with it (each carries
 * the trip's key), and the trip's key is due a rotation. The last organiser may only go when
 * nobody is left behind.
 */
async function dropSeat(
  tx: Tx,
  tripId: string,
  memberId: string,
  lastOrganiserMessage = LAST_ORGANISER,
): Promise<void> {
  const [others] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.tripId, tripId), ne(memberships.memberId, memberId)));
  if (others.n > 0) await requireAnotherOrganiser(tx, tripId, memberId, lastOrganiserMessage);
  const gone = await tx
    .delete(memberships)
    .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId)))
    .returning({ memberId: memberships.memberId });
  if (gone.length === 0) throw new DataError("No such member on this trip.");
  await tx.delete(rekeys).where(and(eq(rekeys.tripId, tripId), eq(rekeys.forMemberId, memberId)));
  await tx.delete(invites).where(and(eq(invites.tripId, tripId), eq(invites.invitedBy, memberId)));
  await tx
    .update(trips)
    .set({ keyStaleSince: sql`coalesce(${trips.keyStaleSince}, now())` })
    .where(eq(trips.id, tripId));
}

export async function removeMember(actorId: string, tripId: string, memberId: string) {
  await requireOrganiser(tripId, actorId);
  if (actorId === memberId) throw new DataError("Leave the trip instead.");
  await db.transaction((tx) => dropSeat(tx, tripId, memberId));
  logger.warn({ actorId, tripId, memberId }, "member removed");
}

export async function leaveTrip(memberId: string, tripId: string): Promise<void> {
  await requireMembership(tripId, memberId);
  await db.transaction((tx) => dropSeat(tx, tripId, memberId));
  logger.warn({ tripId, memberId }, "member left");
}

// ---------- key rotation ----------
// The organiser's phone makes TK[e+1], wraps it to every seat's member key, and hands the lot
// over in one call; the server accepts only a complete set for the next epoch. Live invites and
// key links carried TK[e] and go with it.

export interface KeyGrantInput {
  memberId: string;
  wrapped: string;
}

export async function bumpEpoch(
  actorId: string,
  tripId: string,
  input: { epoch: number; nameEnc: string; grants: KeyGrantInput[] },
): Promise<void> {
  await requireOrganiser(tripId, actorId);
  checkWrapped(input.nameEnc);
  for (const g of input.grants) checkBlob(g.wrapped, 3, 8192, GARBLED_KEY);
  await db.transaction(async (tx) => {
    const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).for("update");
    if (!trip || input.epoch !== trip.keyEpoch + 1) throw new DataError(STALE_KEY);
    const seats = await tx
      .select({ memberId: memberships.memberId })
      .from(memberships)
      .where(eq(memberships.tripId, tripId));
    const granted = new Set(input.grants.map((g) => g.memberId));
    const missing = seats.filter((s) => s.memberId !== actorId && !granted.has(s.memberId));
    if (missing.length > 0)
      throw new DataError("Somebody on the trip would be left without a key.");
    const seatIds = new Set(seats.map((s) => s.memberId));
    await tx.insert(keyGrants).values(
      input.grants
        .filter((g) => seatIds.has(g.memberId))
        .map((g) => ({
          id: randomUUID(),
          tripId,
          epoch: input.epoch,
          toMemberId: g.memberId,
          fromMemberId: actorId,
          wrapped: g.wrapped,
        })),
    );
    await tx
      .update(trips)
      .set({ keyEpoch: input.epoch, nameEnc: input.nameEnc, keyStaleSince: null })
      .where(eq(trips.id, tripId));
    await tx.delete(invites).where(eq(invites.tripId, tripId));
    await tx.delete(rekeys).where(and(eq(rekeys.tripId, tripId), isNull(rekeys.usedAt)));
  });
  logger.warn({ actorId, tripId, epoch: input.epoch, grants: input.grants.length }, "key rotated");
}

export interface KeyGrant {
  id: string;
  epoch: number;
  wrapped: string;
}

/** For the trip's current epoch. */
export async function myGrant(memberId: string, tripId: string): Promise<KeyGrant | null> {
  const { trip } = await requireMembership(tripId, memberId);
  const [row] = await db
    .select({ id: keyGrants.id, epoch: keyGrants.epoch, wrapped: keyGrants.wrapped })
    .from(keyGrants)
    .where(
      and(
        eq(keyGrants.tripId, tripId),
        eq(keyGrants.toMemberId, memberId),
        eq(keyGrants.epoch, trip.keyEpoch),
      ),
    )
    .orderBy(desc(keyGrants.at))
    .limit(1);
  return row ?? null;
}

export async function takeGrant(memberId: string, id: string): Promise<void> {
  await db
    .update(keyGrants)
    .set({ takenAt: new Date() })
    .where(and(eq(keyGrants.id, id), eq(keyGrants.toMemberId, memberId)));
}

// ---------- accounts ----------

/** Creates the member on first arrival. No allowlist, no starting grant. */
export async function ensureMember(
  email: string,
  name: string | null,
  opts?: { termsAccepted?: boolean },
): Promise<{ member: Member; created: boolean }> {
  const normalized = normalizeEmail(email);
  const [existing] = await db.select().from(members).where(eq(members.email, normalized));
  if (existing) {
    if (existing.deletedAt) throw new DataError("That account was deleted.");
    return { member: existing, created: false };
  }
  try {
    const [created] = await db
      .insert(members)
      .values({
        id: randomUUID(),
        email: normalized,
        name: name ?? normalized,
        termsAcceptedAt: opts?.termsAccepted ? new Date() : null,
      })
      .returning();
    logger.info({ memberId: created.id }, "member joined");
    return { member: created, created: true };
  } catch {
    // Concurrent first sign-in: the unique email constraint fired; re-read.
    logger.debug("concurrent first sign-in, re-reading member");
    const [raced] = await db.select().from(members).where(eq(members.email, normalized));
    if (!raced) throw new DataError("Something went wrong signing you in. Try again.");
    return { member: raced, created: false };
  }
}

function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new DataError("Pick a name with at least two characters.");
  if (name.length > 40) throw new DataError("Keep the name under 40 characters.");
  return name;
}

/** Member row and credential in one transaction. */
async function insertMember(
  tx: Tx,
  input: { memberId: string; name: string; lingo?: string; credential: VerifiedRegistration },
): Promise<Member> {
  const [member] = await tx
    .insert(members)
    .values({
      id: input.memberId,
      email: null,
      name: input.name,
      lingo: input.lingo ?? "english",
      termsAcceptedAt: new Date(),
    })
    .returning();
  await tx.insert(credentials).values(credentialRow(member.id, input.credential));
  return member;
}

/** The member id was minted at step one of the ceremony (lib/auth.ts), so key and row agree. */
export async function createAccount(input: {
  memberId: string;
  name: string;
  lingo?: string;
  credential: VerifiedRegistration;
}): Promise<Member> {
  const name = checkName(input.name);
  return db.transaction(async (tx) => {
    const member = await insertMember(tx, { ...input, name });
    logger.info({ memberId: member.id }, "account created with a passkey");
    return member;
  });
}

export async function acceptTerms(memberId: string): Promise<void> {
  await db
    .update(members)
    .set({ termsAcceptedAt: new Date() })
    .where(and(eq(members.id, memberId), isNull(members.termsAcceptedAt)));
}

/** Names are how @mentions find people, so they stay distinct on every trip the member is on. */
export async function setName(memberId: string, raw: string): Promise<void> {
  const name = checkName(raw);
  const mine = await db
    .select({ tripId: memberships.tripId })
    .from(memberships)
    .where(eq(memberships.memberId, memberId));
  if (mine.length > 0) {
    const [clash] = await db
      .select({ id: members.id })
      .from(memberships)
      .innerJoin(members, eq(members.id, memberships.memberId))
      .where(
        and(
          inArray(
            memberships.tripId,
            mine.map((m) => m.tripId),
          ),
          sql`lower(${members.name}) = lower(${name})`,
          sql`${members.id} <> ${memberId}`,
        ),
      )
      .limit(1);
    if (clash) throw new DataError("Someone on one of your trips already goes by that name.");
  }
  await db.update(members).set({ name }).where(eq(members.id, memberId));
  logger.info({ memberId }, "member renamed");
}

/**
 * The row stays — the ledger is append-only and a payout to a departed member is still a payout —
 * but everything that identified them goes in one transaction, every seat vacated as a removal
 * would be, so no trip is left without an organiser or with a key they still hold.
 */
export async function deleteAccount(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const seats = await tx
      .select({ tripId: memberships.tripId })
      .from(memberships)
      .where(eq(memberships.memberId, memberId))
      .for("update");
    for (const { tripId } of seats) {
      await dropSeat(
        tx,
        tripId,
        memberId,
        "You're the only organiser of a trip that still has members. Make someone else an organiser first.",
      );
    }
    await tx.delete(credentials).where(eq(credentials.memberId, memberId));
    await tx.delete(avatars).where(eq(avatars.memberId, memberId));
    await tx.delete(keyringWraps).where(eq(keyringWraps.memberId, memberId));
    // Console-minted recovery links name no trip, so no seat took them.
    await tx.delete(recoveries).where(eq(recoveries.memberId, memberId));
    await tx.delete(rekeys).where(eq(rekeys.forMemberId, memberId));
    await tx
      .update(members)
      .set({
        name: DEPARTED_NAME,
        email: null,
        image: null,
        lingo: "english",
        avatarUpdatedAt: null,
        deletedAt: new Date(),
      })
      .where(eq(members.id, memberId));
  });
  logger.warn({ memberId }, "account deleted");
}

// ---------- passkeys ----------
// Verification is lib/webauthn.ts; everything here is storage.

export async function listCredentials(memberId: string): Promise<CredentialRow[]> {
  return db
    .select()
    .from(credentials)
    .where(eq(credentials.memberId, memberId))
    .orderBy(asc(credentials.createdAt));
}

export async function findCredential(id: string): Promise<CredentialRow | null> {
  return first(db.select().from(credentials).where(eq(credentials.id, id)));
}

function credentialRow(memberId: string, credential: VerifiedRegistration) {
  return {
    id: credential.credentialId,
    memberId,
    publicKey: credential.publicKey,
    alg: credential.alg,
    signCount: credential.signCount,
    backedUp: credential.backedUp,
  };
}

export async function addCredential(
  memberId: string,
  credential: VerifiedRegistration,
): Promise<void> {
  await db.insert(credentials).values(credentialRow(memberId, credential));
  logger.info({ memberId, backedUp: credential.backedUp }, "passkey registered");
}

export async function noteCredentialUse(
  id: string,
  signCount: number,
  backedUp: boolean,
): Promise<void> {
  await db
    .update(credentials)
    .set({ signCount, backedUp, lastUsedAt: new Date() })
    .where(eq(credentials.id, id));
}

/** A link-joined member has no Google fallback, so their last passkey stays. */
export async function removeCredential(memberId: string, id: string): Promise<void> {
  const member = await getMember(memberId);
  if (member && member.email == null && (await listCredentials(memberId)).length <= 1) {
    throw new DataError("That's your only way in. Add another passkey before removing this one.");
  }
  await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.memberId, memberId)));
  logger.info({ memberId }, "passkey removed");
}

export async function hasPasskey(memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.memberId, memberId))
    .limit(1);
  return Boolean(row);
}

export async function passkeyHolders(tripId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ memberId: credentials.memberId })
    .from(credentials)
    .innerJoin(memberships, eq(memberships.memberId, credentials.memberId))
    .where(eq(memberships.tripId, tripId));
  return new Set(rows.map((r) => r.memberId));
}

/** What the passkey manager renders. Key material never leaves this module. */
export async function listPasskeySummaries(memberId: string) {
  const [held, wrapped] = await Promise.all([listCredentials(memberId), passkeyBackups(memberId)]);
  const wraps = new Set(wrapped.filter((p) => p.wrapped).map((p) => p.id));
  return held.map(({ id, createdAt, lastUsedAt, backedUp }) => ({
    id,
    createdAt,
    lastUsedAt,
    backedUp,
    wrapped: wraps.has(id),
  }));
}

/** With whether a keyring backup exists under each; one query, for the layout. */
export async function passkeyBackups(
  memberId: string,
): Promise<{ id: string; wrapped: boolean }[]> {
  const rows = await db
    .select({ id: credentials.id, wrap: keyringWraps.credentialId })
    .from(credentials)
    .leftJoin(keyringWraps, eq(keyringWraps.credentialId, credentials.id))
    .where(eq(credentials.memberId, memberId))
    .orderBy(asc(credentials.createdAt));
  return rows.map((r) => ({ id: r.id, wrapped: r.wrap != null }));
}

/** Null once they have deleted their account. */
export async function getMember(id: string): Promise<Member | null> {
  const [m] = await db.select().from(members).where(eq(members.id, id));
  return m && !m.deletedAt ? m : null;
}

/** The type is sniffed from the bytes, never the upload's claim: they are served back to browsers. */
export async function setAvatar(memberId: string, bytes: Buffer): Promise<void> {
  if (bytes.byteLength === 0) throw new DataError("That file looks empty.");
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new DataError("Keep the picture under 512 KB.");
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new DataError("Use a JPEG, PNG, or WebP image.");

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(avatars)
      .values({ memberId, contentType, data: bytes, updatedAt: now })
      .onConflictDoUpdate({
        target: avatars.memberId,
        set: { contentType, data: bytes, updatedAt: now },
      });
    await tx.update(members).set({ avatarUpdatedAt: now }).where(eq(members.id, memberId));
  });
  logger.info({ memberId, contentType, bytes: bytes.byteLength }, "avatar uploaded");
}

export async function clearAvatar(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(avatars).where(eq(avatars.memberId, memberId));
    await tx.update(members).set({ avatarUpdatedAt: null }).where(eq(members.id, memberId));
  });
  logger.info({ memberId }, "avatar removed");
}

export async function getAvatar(
  memberId: string,
): Promise<{ contentType: string; data: Buffer } | null> {
  return first(db.select().from(avatars).where(eq(avatars.memberId, memberId)));
}

// ---------- invite links ----------

/** Returns the code; the link is shown once, on the minting phone. */
export async function mintInvite(
  tripId: string,
  inviterId: string,
  label: string,
  opts: {
    isOpen?: boolean;
    /** The trip key under the link's secret, and the epoch it is — sealed on the organiser's phone. */
    wrappedKey: string;
    epoch: number;
    /** The join page's peek at the table, under the same secret. */
    preview: string;
  },
): Promise<string> {
  const { trip } = await requireOrganiser(tripId, inviterId);
  const trimmed = label.trim();
  if (!trimmed) throw new DataError("Say who the invite is for.");
  if (trimmed.length > 40) throw new DataError("Keep the name under 40 characters.");
  checkEpoch(trip, opts.epoch);
  checkWrapped(opts.wrappedKey);
  checkWrapped(opts.preview);

  const isOpen = opts.isOpen ?? false;
  const code = newLinkCode();
  await db.insert(invites).values({
    code,
    tripId,
    label: trimmed,
    isOpen,
    invitedBy: inviterId,
    expiresAt: expiresAtFrom(new Date()),
    wrappedKey: opts.wrappedKey,
    epoch: opts.epoch,
    preview: opts.preview,
  });
  logger.info({ tripId, invitedBy: inviterId, label: trimmed, isOpen }, "invite link minted");
  return code;
}

export async function listInvites(tripId: string): Promise<InviteRow[]> {
  return db
    .select()
    .from(invites)
    .where(eq(invites.tripId, tripId))
    .orderBy(desc(invites.createdAt));
}

/** Callers check its state. */
export async function findInvite(code: string): Promise<InviteRow | null> {
  return first(db.select().from(invites).where(eq(invites.code, code)));
}

/** Spent personal invites stay on the record; an open link is shut whether or not anyone used it. */
export async function revokeInvite(actorId: string, code: string): Promise<void> {
  const invite = await findInvite(code);
  if (!invite) return;
  await requireOrganiser(invite.tripId, actorId);
  await db
    .delete(invites)
    .where(and(eq(invites.code, code), or(eq(invites.useCount, 0), eq(invites.isOpen, true))));
  logger.info({ actorId, tripId: invite.tripId }, "invite link revoked");
}

/** What a link holder sees before deciding. Public by design; the taste of the board rides in the link, sealed. */
export interface TripPreview {
  trip: Trip;
  memberCount: number;
  organiser: Member | null;
  names: string[];
}

export async function tripPreview(tripId: string): Promise<TripPreview | null> {
  const trip = await getTrip(tripId);
  if (!trip) return null;
  const roster = await membersOf(tripId);
  return {
    trip,
    memberCount: roster.length,
    organiser: roster.find((m) => m.role === "organiser") ?? roster[0] ?? null,
    names: roster.slice(0, 6).map((m) => m.name),
  };
}

async function requireDistinctName(tx: Tx, tripId: string, name: string) {
  const [clash] = await tx
    .select({ id: members.id })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId))
    .where(and(eq(memberships.tripId, tripId), sql`lower(${members.name}) = lower(${name})`));
  if (clash) throw new DataError("Someone on this trip already goes by that name.");
}

/**
 * The invite, its trip's row locked first and then its own — the order bumpEpoch takes, so a
 * join and a rotation serialise instead of seating somebody at an epoch that is being retired.
 * A rotation that got there first deleted the invite, and the second read finds nothing.
 */
async function lockInvite(tx: Tx, code: string): Promise<InviteRow> {
  const peek = await first(
    tx.select({ tripId: invites.tripId }).from(invites).where(eq(invites.code, code)),
  );
  if (!peek) throw new DataError("That invite link isn't valid.");
  await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, peek.tripId)).for("update");
  const [invite] = await tx.select().from(invites).where(eq(invites.code, code)).for("update");
  if (!invite) throw new DataError("That invite link isn't valid.");
  return invite;
}

async function spendInvite(tx: Tx, invite: InviteRow): Promise<void> {
  if (inviteState(invite, new Date()) !== "live") {
    throw new DataError("That invite link has already been used or has expired.");
  }
  await tx
    .update(invites)
    .set({ useCount: invite.useCount + 1 })
    .where(eq(invites.code, invite.code));
}

/** Member, passkey, seat, and the spent link in one transaction: two openers race safely. */
export async function joinWithInvite(input: {
  code: string;
  memberId: string;
  name: string;
  lingo?: string;
  credential: VerifiedRegistration;
}): Promise<{ member: Member; tripId: string; key: KeyHandover | null }> {
  const name = checkName(input.name);
  return db.transaction(async (tx) => {
    const invite = await lockInvite(tx, input.code);
    await spendInvite(tx, invite);
    await requireDistinctName(tx, invite.tripId, name);
    const member = await insertMember(tx, { ...input, name });
    await tx.insert(memberships).values({
      tripId: invite.tripId,
      memberId: member.id,
      invitedWith: invite.code,
    });
    logger.info(
      { memberId: member.id, tripId: invite.tripId, invitedBy: invite.invitedBy },
      "member joined by invite",
    );
    return { member, tripId: invite.tripId, key: handoverOf(invite) };
  });
}

/**
 * A member of one trip opening the link to another. Already seated costs nothing and spends
 * nothing — but the link still hands its key over, which is how a lost key comes back.
 */
export async function joinTripWithInvite(
  memberId: string,
  code: string,
): Promise<{ tripId: string; key: KeyHandover | null }> {
  const member = await getMember(memberId);
  if (!member) throw new DataError("Sign in first.");
  return db.transaction(async (tx) => {
    const invite = await lockInvite(tx, code);
    const already = await tx
      .select({ tripId: memberships.tripId })
      .from(memberships)
      .where(and(eq(memberships.tripId, invite.tripId), eq(memberships.memberId, memberId)));
    if (already.length > 0) return { tripId: invite.tripId, key: handoverOf(invite) };
    await spendInvite(tx, invite);
    await requireDistinctName(tx, invite.tripId, member.name);
    await tx.insert(memberships).values({
      tripId: invite.tripId,
      memberId,
      invitedWith: invite.code,
    });
    logger.info({ memberId, tripId: invite.tripId }, "member joined another trip by invite");
    return { tripId: invite.tripId, key: handoverOf(invite) };
  });
}

// ---------- recovery links ----------
// This link does not create a member, it *becomes* one (lib/recovery.ts), so nothing here is
// quiet: every mint, revoke, and use is a warn, and listRecoveries feeds a notice the whole
// trip can read.

export interface RecoveryView {
  row: RecoveryRow;
  member: Member;
  /** Null when it came from the console. */
  mintedBy: Member | null;
}

async function organisesWith(actorId: string, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ tripId: memberships.tripId })
    .from(memberships)
    .where(
      and(
        eq(memberships.memberId, actorId),
        eq(memberships.role, "organiser"),
        inArray(
          memberships.tripId,
          db
            .select({ tripId: memberships.tripId })
            .from(memberships)
            .where(eq(memberships.memberId, memberId)),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function createRecovery(memberId: string, mintedBy: string | null): Promise<string> {
  const member = await getMember(memberId);
  if (!member) throw new DataError("No such member.");
  const code = newLinkCode();
  const now = new Date();
  await db.transaction(async (tx) => {
    // One live link per member: minting a second shuts the first. Expired unused ones go too.
    await tx
      .delete(recoveries)
      .where(
        and(
          isNull(recoveries.usedAt),
          or(eq(recoveries.memberId, memberId), lte(recoveries.expiresAt, now)),
        ),
      );
    await tx
      .insert(recoveries)
      .values({ code, memberId, mintedBy, expiresAt: expiresAfter(now, RECOVERY_TTL_MS) });
  });
  logger.warn({ memberId, mintedBy }, "recovery link minted");
  return code;
}

/**
 * An organiser of a trip they share; the real check, who is asking, is theirs, out of band. The
 * link restores the seat only — the key comes afterwards from anyone on the trip.
 */
export async function mintRecovery(actorId: string, memberId: string): Promise<string> {
  if (!(await organisesWith(actorId, memberId))) {
    throw new DataError("Only an organiser of a trip they're on can mint a recovery link.");
  }
  return createRecovery(memberId, actorId);
}

export async function mintRecoveryFromConsole(memberId: string): Promise<string> {
  return createRecovery(memberId, null);
}

export async function findRecovery(code: string): Promise<RecoveryRow | null> {
  return first(db.select().from(recoveries).where(eq(recoveries.code, code)));
}

/** Live and last-week-used links; every member reads them, not just organisers. */
export async function listRecoveries(
  tripId: string,
): Promise<{ live: RecoveryView[]; used: RecoveryView[] }> {
  const memberById = await membersById(tripId);
  if (memberById.size === 0) return { live: [], used: [] };
  const rows = await db
    .select()
    .from(recoveries)
    .where(inArray(recoveries.memberId, [...memberById.keys()]))
    .orderBy(desc(recoveries.createdAt));
  const { live, used } = visibleRecoveries(rows, new Date());
  const view = (row: RecoveryRow): RecoveryView[] => {
    const member = memberById.get(row.memberId);
    return member ? [{ row, member, mintedBy: memberById.get(row.mintedBy ?? "") ?? null }] : [];
  };
  return { live: live.flatMap(view), used: used.flatMap(view) };
}

/** The banner that follows the member a link names: they may never open a members page in 30 minutes. */
export async function recoveryNoticeFor(
  memberId: string,
): Promise<{ live: RecoveryRow[]; used: RecoveryRow[] }> {
  const rows = await db
    .select()
    .from(recoveries)
    .where(eq(recoveries.memberId, memberId))
    .orderBy(desc(recoveries.createdAt));
  return visibleRecoveries(rows, new Date());
}

/** An organiser who shares a trip, or the member it names — who most needs to be able to stop it. */
export async function revokeRecovery(actorId: string, code: string): Promise<void> {
  const row = await findRecovery(code);
  if (!row) return;
  if (actorId !== row.memberId && !(await organisesWith(actorId, row.memberId))) {
    throw new DataError("Only an organiser, or whoever the link is for, can shut it.");
  }
  await db.delete(recoveries).where(and(eq(recoveries.code, code), isNull(recoveries.usedAt)));
  logger.warn({ actorId, memberId: row.memberId }, "recovery link shut");
}

/**
 * Attach the passkey to the seat and spend the link, row locked. Existing passkeys are left
 * alone: a member who still holds one keeps it, sees the arrival, and can remove it.
 */
export async function recoverWithLink(input: {
  code: string;
  memberId: string;
  credential: VerifiedRegistration;
}): Promise<{ member: Member }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(recoveries)
      .where(eq(recoveries.code, input.code))
      .for("update");
    if (!row) throw new DataError("That recovery link isn't valid.");
    if (linkState(row, new Date()) !== "live") {
      throw new DataError("That recovery link has already been used or has expired.");
    }
    // The ceremony was started for one seat; the row has to still name it.
    if (row.memberId !== input.memberId) throw new DataError("That recovery link isn't valid.");

    const [member] = await tx.select().from(members).where(eq(members.id, row.memberId));
    if (!member || member.deletedAt) throw new DataError("That seat is gone.");

    await tx.insert(credentials).values(credentialRow(member.id, input.credential));
    await tx.update(recoveries).set({ usedAt: new Date() }).where(eq(recoveries.code, input.code));
    logger.warn(
      { memberId: member.id, mintedBy: row.mintedBy },
      "seat recovered — a new passkey was added through a recovery link",
    );
    return {
      member,
    };
  });
}

export async function setLingo(memberId: string, lingo: string): Promise<void> {
  await db.update(members).set({ lingo }).where(eq(members.id, memberId));
}

export async function markInboxSeen(tripId: string, memberId: string): Promise<void> {
  await db
    .update(memberships)
    .set({ inboxSeenAt: new Date() })
    .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId)));
}

// ---------- the sealed log ----------
// Envelopes the phones seal and open (lib/crypto.ts) and this server orders. It checks the seat,
// the epoch, the size and the shape; it cannot check anything inside, and that is the point.

/** What a link hands a phone: the trip key under the link's secret, and which epoch it is. */
export interface KeyHandover {
  wrappedKey: string;
  epoch: number;
}

function handoverOf(row: { wrappedKey: string | null; epoch: number | null }): KeyHandover | null {
  return row.wrappedKey !== null && row.epoch !== null
    ? { wrappedKey: row.wrappedKey, epoch: row.epoch }
    : null;
}

const MAX_EVENT_BYTES = 16 * 1024;

export interface Appended {
  id: number;
  seq: number;
  at: Date;
}

/**
 * One row onto the trip's log, inside `tx`: the trip row is locked so `seq` is the next number
 * and no two writers commit out of order, and the epoch is checked under that same lock.
 */
async function insertEvent(
  tx: Tx,
  authorId: string,
  tripId: string,
  envelope: string,
): Promise<Appended> {
  let header: EnvelopeHeader;
  try {
    header = parseEnvelope(envelope);
  } catch {
    throw new DataError("That didn't come through right. Try again.");
  }
  if (envelope.length > MAX_EVENT_BYTES) throw new DataError("That's too long to keep.");
  const [trip] = await tx
    .select({ keyEpoch: trips.keyEpoch })
    .from(trips)
    .where(eq(trips.id, tripId))
    .for("update");
  if (!trip) throw new DataError("That trip is gone.");
  checkEpoch(trip, header.epoch);
  const [row] = await tx
    .insert(events)
    .values({
      tripId,
      authorId,
      epoch: header.epoch,
      body: envelope,
      seq: sql`(select coalesce(max(${events.seq}), 0) + 1 from ${events} where ${events.tripId} = ${tripId})`,
    })
    .returning({ id: events.id, seq: events.seq, at: events.at });
  return row;
}

/** The author is the session, never the body; an event under a rotated-away key is refused. */
export async function appendEvent(
  memberId: string,
  tripId: string,
  envelope: string,
): Promise<Appended> {
  await requireMembership(tripId, memberId);
  return db.transaction((tx) => insertEvent(tx, memberId, tripId, envelope));
}

/** Every event after `afterSeq`, in the trip's order — ciphertext, for a phone with a seat. */
export async function eventsSince(
  memberId: string,
  tripId: string,
  afterSeq: number,
): Promise<EventRow[]> {
  await requireMembership(tripId, memberId);
  return db
    .select()
    .from(events)
    .where(and(eq(events.tripId, tripId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq));
}

async function hasEvents(tripId: string): Promise<boolean> {
  return Boolean(
    await first(
      db.select({ id: events.id }).from(events).where(eq(events.tripId, tripId)).limit(1),
    ),
  );
}

// ---------- rekey links ----------
// A key for a member who already has a seat (lib/rekeys.ts). Any member can mint one for any
// member on the trip — themselves included, which is how a second phone gets the key — and only
// a session that is the member it names can spend it.

export interface RekeyView {
  row: RekeyRow;
  forMember: Member;
  mintedBy: Member | null;
}

export async function mintRekey(
  actorId: string,
  tripId: string,
  forMemberId: string,
  wrappedKey: string,
  epoch: number,
): Promise<string> {
  const { trip } = await requireMembership(tripId, actorId);
  await requireMembership(tripId, forMemberId);
  checkEpoch(trip, epoch);
  checkWrapped(wrappedKey);
  const code = newLinkCode();
  const now = new Date();
  await db.transaction(async (tx) => {
    // One live link per member per trip; spent and stale ones are swept.
    await tx
      .delete(rekeys)
      .where(
        and(
          eq(rekeys.tripId, tripId),
          or(
            and(eq(rekeys.forMemberId, forMemberId), isNull(rekeys.usedAt)),
            lte(rekeys.expiresAt, now),
          ),
        ),
      );
    await tx.insert(rekeys).values({
      code,
      tripId,
      forMemberId,
      mintedBy: actorId,
      wrappedKey,
      epoch,
      expiresAt: expiresAfter(now, REKEY_TTL_MS),
    });
  });
  logger.warn({ tripId, forMemberId, mintedBy: actorId }, "rekey link minted");
  return code;
}

/** The console's version: no session, a week to hand out. Never from an action. */
export async function mintRekeyFromConsole(
  tripId: string,
  forMemberId: string,
  wrappedKey: string,
  epoch: number,
): Promise<string> {
  const code = newLinkCode();
  await db.insert(rekeys).values({
    code,
    tripId,
    forMemberId,
    mintedBy: forMemberId,
    wrappedKey,
    epoch,
    expiresAt: expiresAfter(new Date(), CONSOLE_REKEY_TTL_MS),
  });
  logger.warn({ tripId, forMemberId }, "rekey link minted from the console");
  return code;
}

export async function findRekey(code: string): Promise<RekeyRow | null> {
  return first(db.select().from(rekeys).where(eq(rekeys.code, code)));
}

export async function listRekeys(tripId: string): Promise<RekeyView[]> {
  const memberById = await membersById(tripId);
  const rows = await db
    .select()
    .from(rekeys)
    .where(eq(rekeys.tripId, tripId))
    .orderBy(desc(rekeys.createdAt));
  return liveRekeys(rows, new Date()).flatMap((row) => {
    const forMember = memberById.get(row.forMemberId);
    return forMember ? [{ row, forMember, mintedBy: memberById.get(row.mintedBy) ?? null }] : [];
  });
}

/**
 * A link gets opened twice more often than not — an in-app browser warming the page, a second
 * tap, a dev-mode effect — by the same session. The wrap is worthless without the fragment's
 * secret, so handing it to the same member again costs nothing; refusing them cost a key.
 */
const REKEY_REPEAT_MS = 10 * 60 * 1000;

/** Only the member it names, once, with a short grace for a repeat. */
export async function spendRekey(memberId: string, code: string): Promise<RekeyRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(rekeys).where(eq(rekeys.code, code)).for("update");
    if (!row || row.forMemberId !== memberId) throw new DataError("That link isn't for you.");
    const now = new Date();
    if (row.usedAt && now.getTime() - row.usedAt.getTime() < REKEY_REPEAT_MS) {
      logger.info({ tripId: row.tripId, memberId }, "rekey link opened again by its member");
      return row;
    }
    if (linkState(row, now) !== "live") {
      throw new DataError("That link has already been used or has expired.");
    }
    await tx.update(rekeys).set({ usedAt: now }).where(eq(rekeys.code, code));
    logger.warn({ tripId: row.tripId, memberId, mintedBy: row.mintedBy }, "rekey link used");
    return row;
  });
}

/** Any member may shut one: a stray link is everybody's business. */
export async function revokeRekey(actorId: string, code: string): Promise<void> {
  const row = await findRekey(code);
  if (!row) return;
  await requireMembership(row.tripId, actorId);
  await db.delete(rekeys).where(and(eq(rekeys.code, code), isNull(rekeys.usedAt)));
  logger.warn({ tripId: row.tripId, actorId, forMemberId: row.forMemberId }, "rekey link shut");
}

// ---------- the card ----------
// The one deliberate plaintext on a sealed trip: a member tapped *share*, and this is exactly
// what the card page shows (docs/private-trips.md §4.11).

export interface CardLine {
  name: string;
  profitC: number;
}

export interface PublishedCard {
  marketId: string;
  trip: { id: string; destination: string };
  tripName: string;
  publishedBy: string;
  at: Date;
  question: string;
  verdict: "yes" | "no" | "refunded";
  winners: CardLine[];
  losers: CardLine[];
}

const MAX_CARD_LINES = 12;

export async function publishCard(
  memberId: string,
  tripId: string,
  input: {
    marketId: string;
    tripName: string;
    question: string;
    verdict: PublishedCard["verdict"];
    winners: CardLine[];
    losers: CardLine[];
  },
): Promise<void> {
  await requireMembership(tripId, memberId);
  const question = input.question.trim();
  if (question.length < 5 || question.length > 200) throw new DataError("That's not a card.");
  if (input.tripName.length > 60) throw new DataError("That's not a card.");
  const lines = [...input.winners, ...input.losers];
  if (lines.length > MAX_CARD_LINES) throw new DataError("Too many names for a card.");
  for (const line of lines) {
    if (typeof line.name !== "string" || line.name.length > 40 || !Number.isInteger(line.profitC)) {
      throw new DataError("That's not a card.");
    }
  }
  const card = {
    publishedBy: memberId,
    tripName: input.tripName.trim(),
    question,
    verdict: input.verdict,
    lines: JSON.stringify({ winners: input.winners, losers: input.losers }),
  };
  // The server cannot check the market id on a sealed trip, so the conflict clause is pinned to
  // this trip: a member elsewhere cannot rewrite another trip's card by its id.
  const [row] = await db
    .insert(cards)
    .values({ marketId: input.marketId, tripId, ...card })
    .onConflictDoUpdate({
      target: cards.marketId,
      set: { ...card, at: new Date() },
      setWhere: eq(cards.tripId, tripId),
    })
    .returning({ marketId: cards.marketId });
  if (!row) throw new DataError("That prediction belongs to another trip.");
  logger.info({ tripId, marketId: input.marketId, memberId }, "card published");
}

export async function unpublishCard(memberId: string, marketId: string): Promise<void> {
  const [card] = await db.select().from(cards).where(eq(cards.marketId, marketId));
  if (!card) return;
  await requireMembership(card.tripId, memberId);
  await db.delete(cards).where(eq(cards.marketId, marketId));
  logger.info({ tripId: card.tripId, marketId, memberId }, "card unpublished");
}

export async function cardOf(marketId: string): Promise<PublishedCard | null> {
  const [card] = await db.select().from(cards).where(eq(cards.marketId, marketId));
  if (!card) return null;
  const trip = await getTrip(card.tripId);
  if (!trip) return null;
  let parsed: { winners?: CardLine[]; losers?: CardLine[] } = {};
  try {
    parsed = JSON.parse(card.lines);
  } catch {
    // A card that cannot be read prints its question alone.
  }
  return {
    marketId: card.marketId,
    trip: { id: trip.id, destination: trip.destination },
    tripName: card.tripName,
    publishedBy: card.publishedBy,
    at: card.at,
    question: card.question,
    verdict: card.verdict as PublishedCard["verdict"],
    winners: parsed.winners ?? [],
    losers: parsed.losers ?? [],
  };
}

export async function publishedCards(tripId: string): Promise<Set<string>> {
  const rows = await db
    .select({ marketId: cards.marketId })
    .from(cards)
    .where(eq(cards.tripId, tripId));
  return new Set(rows.map((r) => r.marketId));
}

// ---------- keyring backups ----------
// The keyring under a key only that passkey's PRF can derive; one per credential.

const MAX_KEYRING_BYTES = 64 * 1024;

export async function saveKeyringWrap(
  memberId: string,
  credentialId: string,
  blob: string,
): Promise<void> {
  const [cred] = await db
    .select({ memberId: credentials.memberId })
    .from(credentials)
    .where(eq(credentials.id, credentialId));
  if (!cred || cred.memberId !== memberId) throw new DataError("That passkey isn't yours.");
  checkBlob(blob, 2, MAX_KEYRING_BYTES, "That backup didn't come through right.");
  await db
    .insert(keyringWraps)
    .values({ credentialId, memberId, blob })
    .onConflictDoUpdate({
      target: keyringWraps.credentialId,
      set: { blob, updatedAt: new Date() },
    });
}

export async function keyringWrapsOf(
  memberId: string,
): Promise<{ credentialId: string; blob: string }[]> {
  return db
    .select({ credentialId: keyringWraps.credentialId, blob: keyringWraps.blob })
    .from(keyringWraps)
    .where(eq(keyringWraps.memberId, memberId));
}

// ---------- the numbers that decide what happens next ----------

export interface PlatformStats {
  members: number;
  trips: number;
  /** Trips with at least two members. */
  tripsWithCompany: number;
  /** Members per trip, over trips with company. */
  meanRoster: number;
  /** Members who arrived by invite and later created a trip — the number the loop turns on. */
  invitedThenFounded: number;
  invited: number;
  /** Sealed: the server can count what happened, not what it was. */
  eventsSealed: number;
}

export async function platformStats(): Promise<PlatformStats> {
  const count = sql<number>`count(*)::int`;
  const [m] = await db
    .select({ n: sql<number>`count(*) filter (where ${members.deletedAt} is null)::int` })
    .from(members);
  const [t] = await db.select({ n: count }).from(trips);
  const rosters = await db
    .select({ tripId: memberships.tripId, n: count })
    .from(memberships)
    .groupBy(memberships.tripId);
  const withCompany = rosters.filter((r) => r.n >= 2);
  const invitedRows = await db
    .selectDistinct({ memberId: memberships.memberId })
    .from(memberships)
    .where(isNotNull(memberships.invitedWith));
  const founders = await db.selectDistinct({ memberId: trips.createdBy }).from(trips);
  const founderSet = new Set(founders.map((f) => f.memberId));
  const [ev] = await db.select({ n: count }).from(events);
  return {
    members: m.n,
    trips: t.n,
    tripsWithCompany: withCompany.length,
    meanRoster: withCompany.length
      ? withCompany.reduce((s, r) => s + r.n, 0) / withCompany.length
      : 0,
    invitedThenFounded: invitedRows.filter((r) => founderSet.has(r.memberId)).length,
    invited: invitedRows.length,
    eventsSealed: ev.n,
  };
}
