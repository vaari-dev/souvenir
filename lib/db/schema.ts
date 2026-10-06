import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  // Null for a member who joined by link: no address anywhere.
  email: text("email").unique(),
  name: text("name").notNull(),
  /** Google's picture URL; unread. */
  image: text("image"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  /** A lib/lingo.ts key. */
  lingo: text("lingo").notNull().default("english"),
  /** Set on upload (see `avatars`); the avatar URL's cache-buster. */
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  /** Null only for members who predate the gate; the layout nags them. */
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  /**
   * The row stays because the ledger references it, but everything identifying is scrubbed at
   * once (lib/data.ts deleteAccount) and nothing signs in as them again.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// ---------- trips ----------
//
// Everything a member does is scoped to exactly one trip. The `/talk` language pair is derived
// from `destination` and `home_language` at read time (lib/trips.ts), never stored twice.

export const membershipRoleEnum = pgEnum("membership_role", ["organiser", "member"]);

export const trips = pgTable("trips", {
  id: text("id").primaryKey(),
  /** A key of lib/talk DESTINATIONS. */
  destination: text("destination").notNull(),
  /** A key of lib/talk HOME. */
  homeLanguage: text("home_language").notNull().default("en"),
  /** ISO 4217 lowercased. */
  homeCurrency: text("home_currency").notNull(),
  /** Null when the destination spends the home currency. */
  foreignCurrency: text("foreign_currency"),
  startsOn: date("starts_on", { mode: "string" }),
  endsOn: date("ends_on", { mode: "string" }),
  maxStakePies: integer("max_stake_pies").notNull().default(10),
  /** The trip-key epoch new events must be sealed under. */
  keyEpoch: integer("key_epoch").notNull().default(0),
  /** Sealed (lib/keys `sealName`). */
  nameEnc: text("name_enc"),
  /** Set when a seat went (removal, leaving, deletion) and the key has not been rotated since. */
  keyStaleSince: timestamp("key_stale_since", { withTimezone: true }),
  createdBy: text("created_by")
    .notNull()
    .references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The inbox cursor lives here because the inbox is per trip.
export const memberships = pgTable(
  "memberships",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    role: membershipRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    /** What the founding rate is read from. */
    invitedWith: text("invited_with"),
    /** Events after this instant are unread. */
    inboxSeenAt: timestamp("inbox_seen_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tripId, t.memberId] }),
    index("memberships_member_idx").on(t.memberId),
  ],
);

// Separate from `members` so full-members scans never drag image bytes along.
export const avatars = pgTable("avatars", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => members.id),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Personal (single use) or open group links. The code is stored as-is; they are safe by being
// short-lived and revocable (lib/invites.ts). Acceptance runs in the member-creating
// transaction with the row locked, so a personal link cannot be spent twice.
export const invites = pgTable("invites", {
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id),
  code: text("code").primaryKey(),
  /** Who the inviter says this is for. */
  label: text("label").notNull(),
  /** An open link never spends. */
  isOpen: boolean("is_open").notNull().default(false),
  /** Spends a personal invite; counts arrivals through an open one. */
  useCount: integer("use_count").notNull().default(0),
  /**
   * The trip key (at `epoch`) and the join page's preview, wrapped under the link's secret,
   * which lives in the URL fragment and never reaches this server.
   */
  wrappedKey: text("wrapped_key"),
  epoch: integer("epoch"),
  preview: text("preview"),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Not an invite: it makes you somebody already at the table, so the guards are tighter
// (lib/recovery.ts). `used_at` spends it; a spent row stays as the record.
export const recoveries = pgTable(
  "recoveries",
  {
    code: text("code").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    /** Null when minted by scripts/recovery-link.ts. */
    mintedBy: text("minted_by").references(() => members.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when a passkey is added through it. */
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("recoveries_member_idx").on(t.memberId)],
);

// Nothing here identifies anyone; the aaguid is deliberately not stored.
export const credentials = pgTable(
  "credentials",
  {
    /** Base64url credential id. */
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    /** SPKI DER, as node:crypto exports it (lib/webauthn.ts). */
    publicKey: bytea("public_key").notNull(),
    /** COSE algorithm: -7 (ES256) or -257 (RS256). */
    alg: integer("alg").notNull(),
    /** Going backwards means a clone. */
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    /** Synced to a credential manager. */
    backedUp: boolean("backed_up").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("credentials_member_idx").on(t.memberId)],
);

// ---------- private trips (docs/private-trips.md) ----------

/**
 * Envelopes under the trip key for `epoch`. The server checks seat, epoch, size and shape and
 * nothing else: the type and all content are inside the envelope (replayed on the phone).
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id),
    authorId: text("author_id")
      .notNull()
      .references(() => members.id),
    epoch: integer("epoch").notNull(),
    /**
     * Assigned under the trip row's lock, so it is also commit order: a phone polling "after N"
     * never misses a row. The global `id` can commit out of order.
     */
    seq: integer("seq").notNull(),
    /** `v1.<epoch>.<iv>.<ct>` (lib/crypto.ts). */
    body: text("body").notNull(),
  },
  (t) => [
    uniqueIndex("events_trip_seq_idx").on(t.tripId, t.seq),
    check("events_body_size", sql`length(${t.body}) <= 16384`),
  ],
);

/**
 * A keyring under the credential's PRF secret, so a synced passkey restores keys on a new
 * phone. Opaque here; dropping the credential drops the backup.
 */
export const keyringWraps = pgTable(
  "keyring_wraps",
  {
    credentialId: text("credential_id")
      .primaryKey()
      .references(() => credentials.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    blob: text("blob").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("keyring_wraps_member_idx").on(t.memberId)],
);

/**
 * TK[epoch] wrapped to the member key announced in the log (lib/crypto `wrapToMember`). Opaque
 * here; `bumpEpoch` requires one per seat so nobody is left behind.
 */
export const keyGrants = pgTable(
  "key_grants",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id),
    epoch: integer("epoch").notNull(),
    toMemberId: text("to_member_id")
      .notNull()
      .references(() => members.id),
    fromMemberId: text("from_member_id")
      .notNull()
      .references(() => members.id),
    wrapped: text("wrapped").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    takenAt: timestamp("taken_at", { withTimezone: true }),
  },
  (t) => [index("key_grants_to_idx").on(t.tripId, t.toMemberId, t.epoch)],
);

/**
 * An invite-like link carrying a key to a member who already has a seat, redeemable only by a
 * session that *is* `for_member_id`.
 */
export const rekeys = pgTable(
  "rekeys",
  {
    code: text("code").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id),
    forMemberId: text("for_member_id")
      .notNull()
      .references(() => members.id),
    mintedBy: text("minted_by")
      .notNull()
      .references(() => members.id),
    wrappedKey: text("wrapped_key").notNull(),
    epoch: integer("epoch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("rekeys_trip_member_idx").on(t.tripId, t.forMemberId)],
);

/** The one deliberate plaintext on a sealed trip: a verdict a member chose to share. */
export const cards = pgTable("cards", {
  marketId: text("market_id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id),
  publishedBy: text("published_by")
    .notNull()
    .references(() => members.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /** As the publishing phone printed it. */
  tripName: text("trip_name").notNull().default(""),
  question: text("question").notNull(),
  verdict: text("verdict").notNull(),
  /** `[{ name, pies }]`. */
  lines: text("lines").notNull(),
});

export type Member = typeof members.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type MembershipRole = MembershipRow["role"];
export type CredentialRow = typeof credentials.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type RecoveryRow = typeof recoveries.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type RekeyRow = typeof rekeys.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
