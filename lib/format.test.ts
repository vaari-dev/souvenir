import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmtDate, timeAgo, timeUntil } from "./format.ts";

// Clock held at noon UTC mid-month so `fmtDate` lands on the same day in every timezone.
const NOW = new Date("2026-08-27T12:00:00.000Z");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo", () => {
  it("says just now for the first minute", () => {
    expect(timeAgo(NOW)).toBe("just now");
    expect(timeAgo(ago(59_000))).toBe("just now");
  });

  it("counts up through minutes, hours and days", () => {
    expect(timeAgo(ago(MINUTE))).toBe("1m ago");
    expect(timeAgo(ago(59 * MINUTE))).toBe("59m ago");
    expect(timeAgo(ago(HOUR))).toBe("1h ago");
    expect(timeAgo(ago(23 * HOUR))).toBe("23h ago");
    expect(timeAgo(ago(DAY))).toBe("1d ago");
    expect(timeAgo(ago(29 * DAY))).toBe("29d ago");
  });

  it("counts months in thirties, then years", () => {
    expect(timeAgo(ago(30 * DAY))).toBe("1mo ago");
    expect(timeAgo(ago(359 * DAY))).toBe("11mo ago");
    expect(timeAgo(ago(360 * DAY))).toBe("1y ago");
    expect(timeAgo(ago(3 * 360 * DAY))).toBe("3y ago");
  });

  // Rows arrive from the server as JSON, where a timestamp is a string.
  it("takes a string as readily as a Date", () => {
    expect(timeAgo(ago(2 * HOUR).toISOString())).toBe("2h ago");
  });

  // A phone clock ahead of the server's would read a negative age.
  it("does not go backwards on a clock a touch ahead", () => {
    expect(timeAgo(ahead(5 * MINUTE))).toBe("just now");
  });
});

describe("timeUntil", () => {
  it("says any moment once the deadline has passed", () => {
    expect(timeUntil(NOW)).toBe("any moment");
    expect(timeUntil(ago(HOUR))).toBe("any moment");
  });

  it("spells the singular minute and hour out", () => {
    expect(timeUntil(ahead(MINUTE))).toBe("in a minute");
    expect(timeUntil(ahead(HOUR))).toBe("in an hour");
  });

  it("counts the minutes of a recovery link's half hour", () => {
    expect(timeUntil(ahead(30 * MINUTE))).toBe("in 30 minutes");
    expect(timeUntil(ahead(24 * MINUTE))).toBe("in 24 minutes");
    expect(timeUntil(ahead(59 * MINUTE))).toBe("in 59 minutes");
  });

  it("rounds to hours beyond one", () => {
    expect(timeUntil(ahead(2 * HOUR))).toBe("in 2 hours");
    expect(timeUntil(ahead(7 * DAY))).toBe("in 168 hours");
  });

  it("takes a string as readily as a Date", () => {
    expect(timeUntil(ahead(2 * HOUR).toISOString())).toBe("in 2 hours");
  });
});

describe("fmtDate", () => {
  it("writes the day before the month, unabbreviated year", () => {
    expect(fmtDate(NOW)).toBe("27 Aug 2026");
  });

  it("reads a string the same way as the Date it parses to", () => {
    const iso = "2026-01-05T12:00:00.000Z";
    expect(fmtDate(iso)).toBe(fmtDate(new Date(iso)));
  });
});
