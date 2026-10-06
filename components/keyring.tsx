"use client";

// The keyring on this phone (docs/private-trips.md §4.1, §4.8.3): IndexedDB holds a
// non-extractable keyring key, the keyring sealed under it, and a key per passkey derived from
// its PRF output — the same on every phone the passkey syncs to — under which the keyring is
// backed up in `keyring_wraps` and restored after a sign-in.
//
// Missing or broken storage (a private window, Safari after a week away) is a keyless phone,
// not a crash.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { keyringWrapsAction, saveKeyringWrapAction } from "@/app/actions";
import { newKey, newMemberKey } from "@/lib/crypto";
import {
  emptyKeyring,
  encodeKeyring,
  type Keyring,
  mergeKeyrings,
  openKeyring,
  prfKeyringKey,
  sealKeyring,
  tripCryptoKey,
  withMemberKey,
} from "@/lib/keys";

const DB_NAME = "souvenir-keys";
const STORE = "keys";
const KK_ID = "kk";
const BLOB_ID = "keyring";
const PRF_IDS = "prf";
const prfId = (credentialId: string) => `prf:${credentialId}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no storage"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("storage refused"));
    req.onblocked = () => reject(new Error("storage blocked"));
  });
}

function idbGet<T>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// The store and its key, opened once per page: a second concurrent open (dev
// StrictMode) would otherwise mint a second keyring key over the first.
let store: Promise<{ db: IDBDatabase; kk: CryptoKey }> | null = null;
function openStore() {
  store ??= (async () => {
    const db = await openDb();
    let kk = await idbGet<CryptoKey>(db, KK_ID);
    if (!kk) {
      kk = await newKey(false);
      await idbPut(db, KK_ID, kk);
    }
    return { db, kk };
  })();
  return store;
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

/**
 * True when the authenticator said this credential can evaluate the PRF but did not do so in
 * this ceremony — what Chrome answers on `create()`. A `get()` on the same credential will.
 */
export function prfWithheld(credential: PublicKeyCredential): boolean {
  const results = credential.getClientExtensionResults() as PrfResults;
  return results.prf?.enabled === true && !results.prf.results?.first;
}

/** After a ceremony: keep the key this credential's PRF output derives. True when it gave one. */
export async function rememberPrf(credential: PublicKeyCredential): Promise<boolean> {
  const results = credential.getClientExtensionResults() as PrfResults;
  const prf = results.prf?.results?.first;
  if (!prf) {
    console.info("this passkey returned no PRF secret: the keyring cannot be backed up under it");
    return false;
  }
  try {
    const { db } = await openStore();
    await idbPut(db, prfId(credential.id), await prfKeyringKey(new Uint8Array(prf)));
    const ids = (await idbGet<string[]>(db, PRF_IDS)) ?? [];
    if (!ids.includes(credential.id)) await idbPut(db, PRF_IDS, [...ids, credential.id]);
    return true;
  } catch {
    return false;
  }
}

type PrfKeys = Map<string, CryptoKey>;

async function prfKeys(db: IDBDatabase): Promise<PrfKeys> {
  const out: PrfKeys = new Map();
  for (const id of (await idbGet<string[]>(db, PRF_IDS)) ?? []) {
    const key = await idbGet<CryptoKey>(db, prfId(id));
    if (key) out.set(id, key);
  }
  return out;
}

const same = (a: Keyring, b: Keyring) => encodeKeyring(a).join() === encodeKeyring(b).join();

/** The keyring sealed under each passkey key, to the server. Best effort; the ids that landed. */
async function backUp(kr: Keyring, keys: PrfKeys): Promise<string[]> {
  const written: string[] = [];
  for (const [id, key] of keys) {
    try {
      const res = await saveKeyringWrapAction(id, await sealKeyring(key, kr));
      if (res.ok) written.push(id);
      else console.warn(`keyring backup refused: ${res.error}`);
    } catch (err) {
      console.warn(`keyring backup failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return written;
}

/** Why the passkey backup did or did not come back on this phone — the keyless card says it. */
export type BackupNote =
  /** No passkey on this browser handed over a PRF secret. */
  | "no-secret"
  /** This passkey could open a backup, but none has been written under it yet. */
  | "no-backup"
  /** A backup exists for this passkey and would not open: written under a different secret. */
  | "would-not-open"
  | "offline"
  | "restored";

/**
 * Whatever this member's passkeys backed up that this phone can open, merged
 * into what it holds; `stale` is the passkey keys whose backup no longer matches.
 */
async function restore(
  local: Keyring,
  keys: PrfKeys,
): Promise<{ keyring: Keyring; stale: PrfKeys; note: BackupNote }> {
  let merged = local;
  const opened = new Map<string, Keyring>();
  let note: BackupNote = keys.size > 0 ? "no-backup" : "no-secret";
  if (keys.size > 0) {
    try {
      const res = await keyringWrapsAction();
      for (const wrap of res.wraps ?? []) {
        const key = keys.get(wrap.credentialId);
        if (!key) continue;
        try {
          const kr = await openKeyring(key, wrap.blob);
          opened.set(wrap.credentialId, kr);
          merged = mergeKeyrings(merged, kr);
          note = "restored";
        } catch {
          if (note !== "restored") note = "would-not-open";
          console.warn(`the keyring backup for passkey ${wrap.credentialId} would not open here`);
        }
      }
    } catch {
      note = "offline";
    }
  }
  const stale: PrfKeys = new Map();
  for (const [id, key] of keys) {
    const backup = opened.get(id);
    if (!backup || !same(backup, merged)) stale.set(id, key);
  }
  return { keyring: merged, stale, note };
}

export type KeyringStatus =
  /** Storage is still opening; nothing is known yet. */
  | "loading"
  /** A keyring is open on this phone (it may still hold no key for a given trip). */
  | "ready"
  /** Storage is unavailable here; nothing can be kept between visits. */
  | "unavailable";

export interface KeyringContextValue {
  status: KeyringStatus;
  keyring: Keyring;
  /** Replace the keyring, seal it, persist it, and back it up. */
  update(next: (current: Keyring) => Keyring): Promise<void>;
  /** What the passkey backup did on this phone; null until known, or signed out. */
  backup: BackupNote | null;
  /** The passkeys this phone holds a PRF secret for, by credential id. */
  passkeys: string[];
  /**
   * Back the keyring up again under every passkey secret this phone now holds — after a
   * `get()` handed one over (`fetchPrf`). The credential ids whose backup landed.
   */
  backUpNow(): Promise<string[]>;
}

const KeyringContext = createContext<KeyringContextValue | null>(null);

/**
 * `signedIn` gates the server round trips: the actions redirect a signed-out
 * caller to /signin, which from a join or card page would be a bounce.
 */
export function KeyringProvider({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<KeyringStatus>("loading");
  const [keyring, setKeyring] = useState<Keyring>(emptyKeyring);
  const [backup, setBackup] = useState<BackupNote | null>(null);
  const [passkeys, setPasskeys] = useState<string[]>([]);
  const keyringRef = useRef(keyring);
  keyringRef.current = keyring;
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { db, kk } = await openStore();
        let kr = emptyKeyring();
        const blob = await idbGet<string>(db, BLOB_ID);
        if (blob) {
          try {
            kr = await openKeyring(kk, blob);
          } catch {
            // A blob this key cannot open is a keyless phone, not a broken one.
          }
        }
        const keys = await prfKeys(db);
        if (!cancelled) setPasskeys([...keys.keys()]);
        const restored = signedIn ? await restore(kr, keys) : null;
        let next = restored?.keyring ?? kr;
        const stale = restored?.stale ?? keys;
        // A member key, once: the public half goes into every trip's log with the next hello.
        if (!next.mk) next = withMemberKey(next, (await newMemberKey()).privateKey);
        if (cancelled) return;
        // Whatever update() put in the keyring meanwhile (a key just taken from a link) wins over
        // what storage and the backup had: this effect re-runs when a sign-in flips `signedIn`.
        next = mergeKeyrings(keyringRef.current, next);
        setKeyring(next);
        setBackup(restored?.note ?? null);
        setStatus("ready");
        if (!same(next, kr)) await idbPut(db, BLOB_ID, await sealKeyring(kk, next));
        if (signedIn && Object.keys(next.trips).length > 0) void backUp(next, stale);
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const update = useCallback(async (next: (current: Keyring) => Keyring) => {
    const kr = next(keyringRef.current);
    setKeyring(kr);
    let db: IDBDatabase;
    let kk: CryptoKey;
    try {
      ({ db, kk } = await openStore());
    } catch {
      return;
    }
    await idbPut(db, BLOB_ID, await sealKeyring(kk, kr));
    if (signedInRef.current) void backUp(kr, await prfKeys(db));
  }, []);

  const backUpNow = useCallback(async () => {
    let db: IDBDatabase;
    try {
      ({ db } = await openStore());
    } catch {
      return [];
    }
    const keys = await prfKeys(db);
    setPasskeys([...keys.keys()]);
    const kr = keyringRef.current;
    if (!signedInRef.current || Object.keys(kr.trips).length === 0) return [];
    return backUp(kr, keys);
  }, []);

  const value = useMemo<KeyringContextValue>(
    () => ({ status, keyring, update, backup, passkeys, backUpNow }),
    [status, keyring, update, backup, passkeys, backUpNow],
  );

  return <KeyringContext.Provider value={value}>{children}</KeyringContext.Provider>;
}

export function useKeyring(): KeyringContextValue {
  const ctx = useContext(KeyringContext);
  if (!ctx) throw new Error("useKeyring needs a KeyringProvider above it");
  return ctx;
}

/**
 * The key for one trip at one epoch: `undefined` while storage is opening,
 * `null` when this phone does not hold it (show *Get the key*), a CryptoKey
 * when it does.
 */
export function useTripKey(tripId: string, epoch: number): CryptoKey | null | undefined {
  const { status, keyring } = useKeyring();
  // Tagged with what it was looked up for: after a rotation the epoch prop moves a render before
  // the lookup lands, and the old key must not be handed out under the new epoch's name.
  const [found, setFound] = useState<{ tripId: string; epoch: number; key: CryptoKey | null }>();
  useEffect(() => {
    if (status === "loading") return setFound(undefined);
    let cancelled = false;
    tripCryptoKey(keyring, tripId, epoch).then(
      (key) => !cancelled && setFound({ tripId, epoch, key }),
    );
    return () => {
      cancelled = true;
    };
  }, [status, keyring, tripId, epoch]);
  return found && found.tripId === tripId && found.epoch === epoch ? found.key : undefined;
}
