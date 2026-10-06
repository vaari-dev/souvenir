import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { BackupNudge } from "@/components/backup-nudge";
import { ErrorReporter } from "@/components/error-reporter";
import { KeyringProvider } from "@/components/keyring";
import { Logo } from "@/components/logo";
import { PasskeyNudge } from "@/components/passkey-nudge";
import { RecoveryNotice } from "@/components/recovery-notice";
import { StaleBuild } from "@/components/stale-build";
import { TermsNudge } from "@/components/terms-nudge";
import { ThemeToggle } from "@/components/theme-toggle";
import { passkeysConfigured, RP_ID } from "@/lib/auth";
import { build } from "@/lib/build";
import { passkeyBackups, recoveryNoticeFor } from "@/lib/data";
import { env } from "@/lib/env";
import { lingoOf } from "@/lib/lingo";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import "./globals.css";

// Next has no metrics for Big Shoulders and warns each build; naming a fallback quiets it.
const display = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-big-shoulders",
  fallback: ["Arial Narrow", "sans-serif"],
  adjustFontFallback: false,
});
const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});
const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
});

export const metadata: Metadata = {
  // Standalone deploy: no platform env supplies a base, so og:image would resolve to localhost.
  metadataBase: new URL(env.AUTH_URL),
  title: { default: "Souvenir", template: "%s · Souvenir" },
  description:
    "The app for the trip that actually happens. Call who shows up, who's late, who pays — play-money stamps, real bragging rights.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Souvenir", statusBarStyle: "black-translucent" },
  openGraph: {
    siteName: "Souvenir",
    title: "Souvenir",
    description: "The app for the trip that actually happens.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#143024",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const member = await currentMember();
  const [passkeys, recoveries] = member
    ? await Promise.all([passkeyBackups(member.id), recoveryNoticeFor(member.id)])
    : [[], null];
  const liveRecovery = recoveries?.live[0] ?? null;
  const usedRecovery = recoveries?.used[0] ?? null;
  const needsPasskey = passkeysConfigured && member != null && passkeys.length === 0;
  const needsTerms = member != null && member.termsAcceptedAt == null;
  const t = lingoOf(member?.lingo ?? "english");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Saved theme before first paint; suppressHydrationWarning covers the attribute. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen antialiased`}
      >
        <ErrorReporter />
        {/* Installed to a home screen, the page runs under the status bar: pad the header down by the notch. */}
        <header className="bg-felt-deep pt-[env(safe-area-inset-top)] text-[#f1eee4]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Link href={member ? routes.trips : routes.home} className="flex items-center gap-2.5">
              <Logo size={30} className="rounded-[22%] ring-1 ring-white/20" />
              <span className="display text-2xl font-extrabold uppercase tracking-wide">
                Souvenir
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-3">
              {member ? (
                <>
                  {/* The logo already leads to the trips on a phone, where the row has no room for the word. */}
                  <Link
                    href={routes.trips}
                    className="hidden rounded px-2 py-1 text-sm hover:bg-white/10 sm:inline"
                  >
                    Trips
                  </Link>
                  <Link
                    href={routes.account}
                    className="flex items-center gap-2 rounded-full bg-white/10 p-1 hover:bg-white/20 sm:pl-3"
                    title="Your account"
                  >
                    <span className="hidden text-sm sm:inline">{member.name}</span>
                    <Avatar member={member} size={26} />
                  </Link>
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      title="Sign out"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <Link href={routes.signin} className="rounded px-2 py-1 text-sm hover:bg-white/10">
                  Sign in
                </Link>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div aria-hidden className="zari" />
        <StaleBuild />
        {member && (liveRecovery || usedRecovery) && (
          <RecoveryNotice
            live={liveRecovery && { code: liveRecovery.code, expiresAt: liveRecovery.expiresAt }}
            usedAt={usedRecovery?.usedAt ?? null}
          />
        )}
        {member && needsTerms && <TermsNudge />}
        {member && needsPasskey && !needsTerms && (
          <PasskeyNudge memberId={member.id} needsPicture={member.avatarUpdatedAt == null} />
        )}
        <KeyringProvider signedIn={member != null}>
          {member && !needsTerms && passkeys.length > 0 && (
            <BackupNudge
              rpId={RP_ID}
              held={passkeys.map((p) => p.id)}
              wrapped={passkeys.filter((p) => p.wrapped).map((p) => p.id)}
            />
          )}
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </KeyringProvider>
        <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4 text-xs text-soft">
          <span>{t.footer}</span>
          <span className="ml-auto flex gap-3">
            <Link href={routes.terms} className="hover:underline">
              Terms
            </Link>
            <Link href={routes.privacy} className="hover:underline">
              Privacy
            </Link>
            {build && (
              <span className="mono" title="The commit this build is from">
                {build.short}
              </span>
            )}
          </span>
        </footer>
      </body>
    </html>
  );
}
