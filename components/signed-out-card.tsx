import Link from "next/link";
import { Logo } from "@/components/logo";
import { routes } from "@/lib/routes";

export function SignedOutCard({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto mt-10 max-w-sm overflow-hidden card text-center shadow-[0_2px_0_rgba(33,38,31,0.08)]">
      <div aria-hidden className="zari" />
      <div className="p-8">
        <Logo size={64} className="mx-auto rounded-2xl" />
        <p className="eyebrow mt-5">{eyebrow}</p>
        <p className="display mt-1 text-4xl font-extrabold uppercase leading-none tracking-wide">
          Souvenir
        </p>
        {children}
      </div>
    </div>
  );
}

export function SignedOutNotice({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <SignedOutCard eyebrow={eyebrow}>
      <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
        {children}
      </p>
      <Link
        href={routes.home}
        className="mt-3 block text-sm font-semibold text-felt hover:underline"
      >
        Go home →
      </Link>
    </SignedOutCard>
  );
}

export function deadLink(state: string | null, what = "link", expiredHint = ""): string {
  if (state === "used") return `That ${what} has already been used.`;
  if (state === "expired")
    return `That ${what} has expired.${expiredHint ? ` ${expiredHint}` : ""}`;
  return `That ${what} isn't valid.`;
}
