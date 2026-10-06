// Edit lingo.yaml, not this: `pnpm lingo:gen` compiles it into lingo.data.ts; this module types
// it and turns {placeholders} into functions.

import { LINGO_KEYS, RAW_LINGOS } from "./lingo.data.ts";

export { LINGO_KEYS };

export type LingoKey = (typeof LINGO_KEYS)[number];

export interface Lingo {
  name: string;
  /** Handed to the AI polish prompt. */
  register: string;
  footer: string;
  activityHeading: string;
  activitySoFarHeading: string;
  activityEmpty: string;
  openEmptyTitle: string;
  openEmptySub: string;
  resolvedEmpty: string;
  forYouHeading: string;
  forYouSub: string;
  openBetsEmpty: string;
  betsEmpty: string;
  poolEmpty: string;
  leaderboardTitle: string;
  leaderboardSub: (min: number) => string;
  leaderboardEmptyTitle: string;
  calibratingSub: string;
  membersTitle: string;
  membersSub: string;
  newTitle: string;
  magicPitch: string;
  inboxSub: string;
  inboxEmptyTitle: string;
  inboxEmptySub: string;
  stakeLimit: string;
  voidHint: string;
  resolveSub: string;
  recording: string;
  oops: string;
  youWon: (amount: string) => string;
  youLost: (amount: string) => string;
  brokeEven: string;
  questionPlaceholder: string;
  criteriaPlaceholder: string;
  commentsHeading: string;
  commentsEmpty: string;
  commentPlaceholder: string;
  billsTitle: string;
  billsSub: string;
  billsEmptyTitle: string;
  billsEmptySub: string;
  allSquare: string;
  talkTitle: (language: string) => string;
  talkSub: (language: string) => string;
  phrasebookHeading: string;
  startersHeading: string;
  startersSub: string;
  tripsTitle: string;
  tripsSub: string;
  tripsEmptyTitle: string;
  tripsEmptySub: string;
  newTripTitle: string;
  newTripSub: string;
  recapTitle: string;
  recapSub: string;
  recapEmptyTitle: string;
  recapEmptySub: string;
  sealedNote: string;
  sealedTripName: string;
  keylessTitle: string;
  keylessSub: string;
  noKeyYet: (name: string) => string;
  cardPublishNote: string;
}

/** As YAML holds it; a field renamed in lingo.yaml fails to compile. */
export type RawLingo = { [K in keyof Lingo]: string };

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  );
}

function hydrate(raw: RawLingo): Lingo {
  return {
    ...raw,
    leaderboardSub: (min) => fill(raw.leaderboardSub, { min }),
    youWon: (amount) => fill(raw.youWon, { amount }),
    talkTitle: (language) => fill(raw.talkTitle, { language }),
    talkSub: (language) => fill(raw.talkSub, { language }),
    youLost: (amount) => fill(raw.youLost, { amount }),
    noKeyYet: (name) => fill(raw.noKeyYet, { name }),
  };
}

export const LINGOS = Object.fromEntries(
  LINGO_KEYS.map((key) => [key, hydrate(RAW_LINGOS[key])]),
) as Record<LingoKey, Lingo>;

export function isLingoKey(key: string): key is LingoKey {
  return (LINGO_KEYS as readonly string[]).includes(key);
}

export function lingoOf(key: string): Lingo {
  return isLingoKey(key) ? LINGOS[key] : LINGOS.english;
}
