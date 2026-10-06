// "@" followed by a member's full or first name, case-insensitive, longest match wins. Resolved
// at write time and stored as the comment's mentions, so a later rename never rewrites who was
// tagged.

export interface Mentionable {
  id: string;
  name: string;
}

interface MentionMatch {
  start: number;
  end: number;
  memberIds: string[];
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function candidatesOf(member: Mentionable): string[] {
  const name = member.name.trim();
  if (!name) return [];
  const first = name.split(/\s+/)[0];
  return first.length < name.length ? [name, first] : [name];
}

function scan(body: string, members: Mentionable[]): MentionMatch[] {
  const matches: MentionMatch[] = [];
  const lower = body.toLowerCase();
  for (let i = 0; i < body.length; i++) {
    // "@" glued to a word (an email address, mid-token noise) is not a mention.
    if (body[i] !== "@" || isWordChar(body[i - 1])) continue;
    let bestLength = 0;
    let memberIds: string[] = [];
    for (const member of members) {
      for (const candidate of candidatesOf(member)) {
        if (candidate.length < bestLength) continue;
        if (lower.slice(i + 1, i + 1 + candidate.length) !== candidate.toLowerCase()) continue;
        if (isWordChar(body[i + 1 + candidate.length])) continue;
        if (candidate.length > bestLength) {
          bestLength = candidate.length;
          memberIds = [member.id];
        } else if (!memberIds.includes(member.id)) {
          // A shared first name tags everyone it could mean: a spare notification beats a missed one.
          memberIds.push(member.id);
        }
      }
    }
    if (bestLength > 0) {
      matches.push({ start: i, end: i + 1 + bestLength, memberIds });
      i += bestLength;
    }
  }
  return matches;
}

export function parseMentions(body: string, members: Mentionable[]): string[] {
  const seen = new Set<string>();
  for (const match of scan(body, members)) {
    for (const id of match.memberIds) seen.add(id);
  }
  return [...seen];
}

export interface BodySegment {
  text: string;
  memberId?: string;
}

// Re-matches only against the members stored as tagged on the comment.
export function segmentBody(body: string, mentioned: Mentionable[]): BodySegment[] {
  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const match of scan(body, mentioned)) {
    if (match.start > cursor) segments.push({ text: body.slice(cursor, match.start) });
    segments.push({ text: body.slice(match.start, match.end), memberId: match.memberIds[0] });
    cursor = match.end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor) });
  return segments;
}
