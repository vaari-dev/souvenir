# Two-way speech interpretation for travellers (August 2026)

## Incumbents

- **Google Translate** (free): Conversation tab rebuilt 9 Jun 2026 on Gemini 3.5 Live Translate: audio to audio, 70+ languages, auto-detects who speaks. Covers Hindi, Thai, Vietnamese; Indonesian expanding. Offline packs use the legacy pipeline.
- **Apple**: Translate app has Thai, Vietnamese, Indonesian, **no Hindi**. iOS 26 AirPods Live Translation has none of Thai, Vietnamese, Hindi, Indonesian. Accuracy drops sharply above ~70 dB ambient.
- **Samsung Galaxy AI Interpreter**: free, ~20 languages including all four, real offline packs; the best free offline option, Samsung only.
- Microsoft Converse retired 30 Jun 2026; SayHi shut Aug 2024; iTranslate is a paywall; Papago is shallow on Thai. Hardware (Timekettle, Pocketalk, $150–450) serves people who won't use a phone.

Net: two-way voice in Thai/Vietnamese/Hindi/Indonesian is free and good; paid apps and hardware are residual.

## Web platform reality

- **iOS Safari `webkitSpeechRecognition`**: covers all four languages but `continuous=true` never ends and drops results, and **it does not work in a Home Screen (standalone) web app**. Usable only as tap-to-talk in a real Safari tab, which is what `/talk` does. Chrome/Edge on iOS inherit this.
- **Android Chrome**: cloud recogniser, broad languages, stable. On-device Thai coverage unconfirmed.
- **`speechSynthesis`**: iOS exposes only pre-installed voices. Android Chrome silently falls back to English without the Google TTS pack, so check that `voice.lang` resolved and keep the `SPEECH_BASE_URL` fallback.
- No continuous listening in iOS PWAs. Chrome's Translator API is desktop only; in-browser Whisper is multi-second and 100–500 MB; Apple's SpeechAnalyzer is native only.

## Server cost

STT is ~$0.006–0.008 per minute (Deepgram, AssemblyAI, OpenAI, ElevenLabs, Sarvam). TTS ranges from $4/M characters (Google WaveNet) to $60–100/M (MiniMax, ElevenLabs). Speech-to-speech is $0.04–0.10 per minute (Gemini Live Translate API, free in preview; OpenAI realtime). A turn is ~150 characters, so a trip costs cents. Cost is not the constraint; latency and robustness are.

## Differentiator or commodity?

Commodity: Google has >1B monthly users and every flagship bundles an interpreter. Pain points: **noise**, **turn-taking latency**, **register** (Thai ครับ/ค่ะ, Hindi tu/tum/aap guessed), **domain** (prices, numbers, dishes), and most tourist needs are **reading** (menus, signs), where the camera beats speech.

## What matters more for a group

- **Address card in local script** (hotel, tonight's restaurant) for a driver; used more than any spoken sentence.
- **Phrase cards the group wrote together** ("we are 8, one vegetarian, no coriander", "meter please") with the gender toggle baked in: the kept `phrases`.
- **Haggle helper**: target and walk-away prices, the number spoken in Thai with the right particle.
- Menu OCR is commodity; the group version is the bill. A currency converter defaults to the destination.

## Implications

1. Do not compete with Google on interpretation. Keep `/talk` a thin tap-to-talk that works in Safari; spend no more on STT/TTS plumbing.
2. The moat is what Google does not know about the group: the shared phrasebook, address cards, a number-speaker tied to the bill's currency, the bill.
3. If a server voice stays, Cartesia or Google Chirp are cheaper than MiniMax for Thai (irrelevant at these volumes). Gemini Live Translate is the only speech-to-speech option covering the four languages if that ever returns.
4. Guard the constraints: the politeness toggle (Google guesses gender, Souvenir asks), no stored turns, `voiceFor` refusing a language the pair no longer covers.

Sources: Google blog (9 Jun 2026); Apple, Samsung and Chrome documentation; Apple developer forums on standalone `webkitSpeechRecognition`; vendor pricing pages.
