import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { completeGoogleSignIn, createSession, takeSignInIntent } from "@/lib/auth";
import { DataError, ensureMember } from "@/lib/data";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Google sends the member back here with `code` + `state`. */
export async function GET(request: NextRequest) {
  const profile = await completeGoogleSignIn(request.nextUrl.searchParams);
  if (!profile) {
    return NextResponse.redirect(`${env.AUTH_URL}/signin?error=OAuthCallback`);
  }
  const intent = await takeSignInIntent();

  // No picture: avatars are monograms (lib/avatar.ts), and a googleusercontent URL would be a
  // third-party identifier collected for nothing.
  try {
    const { member, created } = await ensureMember(profile.email, profile.name, {
      termsAccepted: intent.agreed,
    });
    await createSession(member.id);
    logger.info({ memberId: member.id, provider: "google", created }, "member signed in");
  } catch (err) {
    if (err instanceof DataError) {
      return NextResponse.redirect(`${env.AUTH_URL}/signin?error=AccessDenied`);
    }
    throw err;
  }
  return NextResponse.redirect(`${env.AUTH_URL}${intent.next}`);
}
