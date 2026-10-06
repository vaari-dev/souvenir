# Ideas — making Souvenir more useful to a travelling group

A shelf, not a plan. Each idea fits the rules in `AGENTS.md`: content is a
sealed event and replay derives the page, the server never needs plaintext,
and stamps are never money.

The lens: the app has what a group chat lacks — a roster, a sealed shared
record, and a per-trip clock (`tripToday`). The best ideas turn daily
logistics *into* the record, so the game feeds itself.

## Make it the thing you open ten times a day (during the trip)

1. **A "Today" sheet.** During the trip the home page is today in the
   trip's timezone: plans, predictions due to resolve, bills, phrases kept.
2. **Plans with "who's in?"** A `plan` event ("Doi Suthep, 5 AM — who's in?")
   with RSVPs, and the app offers the prediction "Will everyone who said yes
   actually show?" by itself. Logistics become game content instead of
   competing with it.
3. **Check-ins that resolve predictions.** An "I'm here" tap is a `checkin`
   event; "Who's last to the lobby" resolves itself from log order — evidence
   rather than an argument, and entirely replay logic.
4. **Dinner polls.** Not zero-sum, so not a prediction — a small `poll`
   event. Groups fight about dinner nightly; the app that settles it becomes
   the group's home.

## Money that actually gets settled

5. **The kitty.** Most groups have one person holding cash for taxis. Model a
   float (contributions in, spend out) inside bills — a constant real-world
   pattern the split model doesn't express.
7. **Last-day settle sheet.** The trip knows when it ends *there*; on that
   day, surface what is still open and a shareable text card for the chat
   (like `ShareRecap` — never a payment link).
8. **Sealed receipt photo on a bill.** `lib/crypto` already has blobs. "What
   was the ฿12,000 for?" is answered by a picture the server cannot read.
   Watch the size.

## Keep the game alive

Unresolved predictions are what kill prediction games.

9. **Resolve-by dates.** The polish step can extract a `resolvesBy`; the
   inbox nudges the creator when it passes ("this one should have a
   verdict"). Cheap, high leverage.
10. **Phase-aware starters.** `lib/starters` already knows the phase: before
    = bookings, visa, packing ("Will Kiran forget his charger?"); during =
    daily; after = "who posts photos first".
11. **Titles from the ledger.** Contrarian (solo-side wins), Oracle, Donor —
    derived in `lib/stats` with tests, shown on the recap and the share card.
12. **A reveal ritual.** "Resolve at the table": full-screen verdict reveal,
    phone passed around. Tiny build, big moment.

## Words and places

13. **Places as kept phrases.** The hotel address in the local script, shown
    big to a taxi driver, with a maps link — the most-used thing a traveller
    needs in a foreign script, and it fits the phrasebook's one-row-per-tap
    rule.
14. **Offline.** The log already replays on the phone; a service worker
    caching the last log makes the trip open read-only on a beach with no
    signal, with calls queued. Phrases already speak on-device.

## Memory

15. **Quotes board.** A `quote` event ("— Arjun, 2 AM, Nimman"), text only,
    into the recap. The cheapest thing on this list and probably the most
    shared.

## If only five

Today sheet (1), plans with the auto-prediction (2), resolve-by nudges (9),
the kitty (5), places cards (13).

## Left out on purpose

- Anything that moves money or names a rupee amount on a prediction (UPI
  links, "loser pays"): crosses the PROGA line.
- A documents wallet (passports, tickets): E2EE would hold it, but it is scope
  the app has no reason to own, and a loss there is not a game.
- Saving interpreter turns automatically: the phrasebook stays something a
  member wrote, one row per tap.
