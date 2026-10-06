# Taking a friend-group travel web app to market as a solo founder (August 2026)

## PWA vs native

- **iOS**: home-screen web apps get Web Push and badges (16.4+); **iOS 26 opens every home-screen site standalone**. Still true: no `beforeinstallprompt` (ship a "Share → Add to Home Screen" card), push only once installed, ~50 MB cache, no Web Share Target. Passkeys work in Safari and installed apps. `webkitSpeechRecognition` is flaky and absent standalone (what `/talk` already handles: say so, offer typing).
- **Android Chrome**: install prompt, push, share target, solid speech. First-class.
- **Fees**: web apps pay Apple nothing. Stores take 15–30% (EU: a new tiered structure plus a 5% Core Technology Commission from 1 Oct 2026) plus $99/yr Apple, $25 Google.
- **Capacitor** is the right wrapper if ever needed; costs are two review queues, Apple rule 4.2 (thin wrappers), mandatory IAP for any paywall. **PWA-only at launch**; revisit only when iOS push reliability or store discoverability is the demonstrated bottleneck.
- Precedent: Partiful was web-first for years; Wanderlog launched web-only.

## Acquisition

- **Invite loop**: k = invites per user × conversion. 0.15–0.25 good, 0.4 great, ~0.7 exceptional; sustained k>1 essentially never. Group apps are structurally better (one host imports a group; the invite is the product). Partiful hit 500K MAU with ~no paid marketing because non-members see the event page before signing up. **Measure** members joined per trip and the fraction of joined members who later *found* a trip: the real k.
- **Product Hunt**: diluted, SaaS/AI audience; use for the backlink. **Launch HN** fits a founder-built web app better.
- **Reddit**: travel subs ban self-promo. What works is the "I built this for my friend group, here's what happened" story in r/SideProject, r/webdev, r/india, plus genuinely answering "how do you plan a group trip" threads.
- **Short video**: travel creators are the costliest category (India 10–50K followers ₹5–15K/Reel). Cheap version: $50–100 to many micro-creators, <$10K total. The organic unit is the group's own "who won" recap; build a shareable result card (Locket's path).
- **WhatsApp in India** (~89% of smartphone owners) is the best organic channel. The invite's OG card is the ad; the "resolved — X won 40 stamps" message is the retention hook; a wa.me deep link with a pre-filled message beats the share sheet. UPI cash referrals are irrelevant and poisonous for a play-money app.
- **SEO**: "trip planner with friends" is crowded. Defensible: "prediction game for friends", "bets with friends no money", "trip bets app", destination pages.
- **ASO** only if a wrapper ships.

## Pricing benchmarks

Splitwise Pro $39.99/yr (India ₹2,499), Wanderlog Pro $39.99, TripIt $49, Polarsteps €29.99 plus books, Strava $79.99; Partiful and Spond take a cut of tickets/payments; Luma charges organisers. Group apps charge the *organiser*; nobody charges per member. Options: free for the group plus a founder tier (₹99–149/mo) or per-trip unlock (₹299 / $4.99) for voice, AI lingos, exports. Razorpay (UPI AutoPay, 0% on UPI under ₹2,000) in India, Stripe abroad; both need an Indian entity (sole prop + GST suffices for Razorpay).

## Legal and ops basics

- **Play money is the whole ballgame in India** (PROGA 2025, in force 1 May 2026): no stamp purchases, no cash-out, no prizes, no rupee side-bets; say so in the Terms.
- **DPDP Act 2023 + Rules** (notified 13 Nov 2025; full compliance by 13 May 2027): notice and consent per purpose, a grievance contact, erasure, breach notification, verifiable parental consent for under-18s. Cheap route: an 18+ gate.
- **GDPR** applies if any EU member joins. `/talk` voice is not stored; state it.
- **Cookies**: no consent needed with only strictly necessary cookies and no third-party analytics.
- Ship: Privacy Policy, Terms (play-money clause, 18+, deletion, organiser powers), one-click delete that anonymises ledger rows, a security contact.
- **Hosting**: Hetzner CX22 (~€6/mo) runs the standalone image; Oracle Always Free ARM was cut 15 Jun 2026 (fine for staging, not the only production box). Budget ≤ $0.20/active user/month all-in; $15–40/mo to ~5K MAU. DB disk and TLS renewals are what page you at 3am; put both on a managed service.

## Playbooks

Wanderlog (Launch HN, zero paid ads, shared trips + SEO), Splitwise (a viral rent calculator, then the settle-up loop), Partiful (link invites, guests see the page first, campus orgs), Luma (seeded hosts, free for organisers), BeReal/Locket/NGL (daily prompt, a visible widget, $50–100 micro-creators). Common thread: the product's own artifact is the distribution; founders hand-seeded 1–3 real communities; paid channels, if any, <$10K; money came 1–2 years later from the organiser. The resulting plan is in `docs/gtm.md`.

Sources: Apple DMA and WebKit Safari 26 notes; First Round k-factor benchmarks; NoGood and CNBC on Partiful; Wanderlog founder story; TechCrunch on Locket; Razorpay and Stripe docs; PROGA and DPDP analyses; vendor pricing pages.
