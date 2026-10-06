// The play currency. UI calls them stamps; code keeps pies (like market/stake/settle*): don't
// half-rename either side. Amounts are integer centi-pies, 1 stamp = 100, so settlement is exact.

export const CENTS = 100;

export function stampsWord(cents: number): string {
  return Math.abs(cents) === CENTS ? "stamp" : "stamps";
}

export function toCents(pies: number): number {
  return Math.round(pies * CENTS);
}

export function fmtPies(cents: number, opts?: { sign?: boolean }): string {
  const sign = opts?.sign && cents > 0 ? "+" : cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / CENTS);
  const frac = abs % CENTS;
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

export function piesText(cents: number, opts?: { sign?: boolean }): string {
  return `${fmtPies(cents, opts)} ${stampsWord(cents)}`;
}

export function fmtPct(x: number): string {
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${sign}${Math.abs(x * 100).toFixed(0)}%`;
}
