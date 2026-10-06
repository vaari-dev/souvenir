// Gmail ignores dots in the local part, and Google's ID token returns exactly one spelling, so
// everything keyed off an address stores and looks up this canonical form. Plus-tags are left
// alone: they are routing, not identity, and a member signing in with one is a different Google
// account.

const DOTLESS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!DOTLESS_DOMAINS.has(domain)) return email;
  return `${local.replaceAll(".", "")}@${domain}`;
}
