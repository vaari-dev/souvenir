# Souvenir — go-to-market plan

Evidence for each claim is in `docs/research/`.

## Thesis

**The app for the trip that actually happens.** Friend groups don't fail for
lack of itineraries or split apps (free and everywhere). They fail between
"chalte hain" and booking (42% of Indian outbound trips are booked inside 7
days), and fall out over money afterwards (1 in 5 friendships ended over a
trip's money, Experian 2025). Souvenir attacks *commitment* and
*awkwardness*: a zero-sum, play-money prediction game about the trip itself,
with bills and the interpreter alongside.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Spine | Commitment game first; bills and talk supporting | Itineraries and splitting are commoditised; the social mechanic has no incumbent |
| Market | Indian friend groups going abroad, built global-ready | 32.7M departures, WhatsApp- and UPI-native, no purpose-built tools |
| Price | Free; instrument; decide at day 90 | Nobody in this category grew on per-seat pricing; Indian tolerance for a ₹149/mo utility is nil |
| Vocabulary | *prediction / call / pool / stamp*; never *bet, wager, odds, payout* | PROGA 2025 and the stores pattern-match on words |
| Money | Stamps are never bought, sold, or cashed out; the app never records or links money on a prediction | Keeps it an "online social game" under PROGA and off gambling ratings |
| Bills | At most two currencies per trip (destination + home), set at creation | Matches the real trip; avoids Splitwise's currency confusion |
| Age | 18+, India + global terms | Avoids DPDP parental-consent machinery |
| Privacy | Trips sealed end to end | A group's arguments and money are its own; a dump, subpoena or the operator gets nothing readable (`docs/private-trips.md`) |

## Positioning

**For** the one friend who always ends up planning the trip, **Souvenir** is
the group game that makes backing out visible and settling up painless,
**unlike** Splitwise, Wanderlog, or the group chat, **because** it turns "are
you actually coming" into a call with stamps on it, and the leaderboard
remembers.

Tagline: *The trip that actually happens.* Secondary: *Call who shows up,
who's late, who pays. Play-money stamps, real bragging rights.*

Copy rules: Hinglish is a member's choice (lingo), never the default; no
crude roast outside the opt-in "unhinged" lingo; never roast a money error;
"stamps are never money" on every public surface.

## Who

**Beachhead:** 22–35, metro India (Delhi, Bengaluru, Mumbai), a WhatsApp
group of 4–10 with one planner, going to Thailand / Vietnam / Bali / Sri
Lanka / Dubai / Goa within 8 weeks. Entry persona is **the planner**.

**Second ring:** the same groups' domestic trips (one currency, no talk tab).
**Third ring (after day 90):** English-speaking groups anywhere; only the
marketing is Indian.

## The loop and the numbers

```
planner opens trip ──► drops invite link in WhatsApp ──► 4–9 friends join (see the table first)
        ▲                                                          │
        │                                                          ▼
  a friend opens their own trip  ◄──  verdict cards / recap  ◄──  predictions resolve during the trip
```

| Metric | Source | Target by day 90 |
|---|---|---|
| Trips opened / week | `pnpm stats` | 10 seeded by day 45, 40 by day 90 |
| Members per trip (trips with ≥2) | `pnpm stats` mean roster | ≥ 4.5 |
| Invite → join conversion | `invites.use_count` vs memberships | ≥ 50% of personal links, ≥ 3 joins per group link |
| **Founding rate** (invited → founded) | `pnpm stats` | **≥ 15%**, the line between a product and a toy |
| Predictions resolved per trip | `pnpm stats` | ≥ 5 (the leaderboard threshold) |
| Cards shared | log hits on the `card` route from non-members | ≥ 1 per resolved prediction |

Founding rate under 10% at day 90 means the loop is not compounding; the fix
is the card and the join preview, not marketing.

## 90-day plan

Open items: Google OAuth consent screen (app name, privacy and terms URLs)
if Google sign-in is ever turned on (`docs/launch/deploy-checklist.md`).

**Days 8–21: dogfood and seed 3 more.** Resolve every open call on the
Chiang Mai trip and share three verdict cards. Open a trip for your own next
plan (Diwali 6–10 Nov) by group link. Hand-recruit 3 planners; a weekly
15-minute call with each; fix what kills a trip in its first week. Write the
first "how we ran our trip on it" post (`docs/launch/launch-hn.md`).

**Days 22–45: 10 real trips, two loop artifacts tuned.** Post the seed
messages (`docs/launch/whatsapp-seeds.md`) in 5 WhatsApp groups. Answer
"planning a Goa/Thailand trip" threads on r/IndiaTravel, r/bangalore,
r/delhi, r/mumbai. Watch which cards non-members open (route logs); the card
is the ad. Write `/for/thailand` and `/for/goa` (visa rules, what the bills
look like, starter predictions; the "will it happen" angle, not itineraries).

**Days 46–70: public launch.** Launch HN (Tue–Thu, 8am PT): play-money
zero-sum math, append-only ledger, passkey-only join, the "why not money"
legal story. Product Hunt the same week. 10–20 micro travel/college creators
at ₹2–5K each (`docs/launch/creator-brief.md`), total ≤ ₹50K, each running
their own trip's board and posting the recap. IndieHackers / r/SideProject
post with the founding-rate number.

**Days 71–90: decide.**
- Founding rate ≥ 15% and ≥ 5 resolved predictions per trip: stay PWA-only;
  optionally test an organiser tier (₹299 per trip for server voice, AI
  polish, CSV export; Razorpay UPI). Free is right for India; revenue, if
  any, is affiliate/card partnerships later.
- iOS push the measured blocker (members missing verdicts): wrap with
  Capacitor, submit as "Contests", not "Simulated Gambling".
- Founding rate < 10%: work the card and join preview, not the channel.

## Calendar

| When | What | Why |
|---|---|---|
| Oct 2026 | Public launch + creator seeding | Diwali 6–10 Nov trips are being booked; NYE plans open |
| 20 Nov – 5 Dec | Second push | NYE trips booked inside a 23–25 day window |
| 15 Feb 2027 | Third push | Holi 22 Mar 2027 long weekend |

## Needs a human

- An entity and a grievance address: DPDP wants a named contact; Razorpay
  wants an Indian entity (sole prop + GST suffices). Neither is needed to
  launch free.
- A lawyer's read of `/terms` and `/privacy` before the creator push.
- Trademark clearance (classes 9, 42) and domain for "Souvenir".
- Google OAuth app verification beyond 100 Google sign-ins; passkeys
  sidestep it.

## Risks

- **Absorption.** WhatsApp polls + Paytm splits + Airbnb group itineraries
  cover 80% of coordination. The defensible 20% is the game and the group's
  history; never drift into the 80%.
- **Play-money fatigue.** Manifold-style decay happens without a season. The
  trip is the season; recap, rivalries and the nemesis line are retention.
  If a trip's predictions stop at 2–3, improve the starters.
- **Regulatory drift.** PROGA's "other stakes" hinges on *purchased*. Selling
  stamps, cosmetic or not, is a no. The Supreme Court challenge is pending;
  the social-game carve-out is stable ground.
- **Store risk if wrapped.** "Pool" plus a currency may rate 18+ simulated
  gambling. Present stamps as points.
- **Tone risk.** One screenshot of an "unhinged" line next to a money error
  is a PR problem. Lingo is opt-in and never touches rule errors.
