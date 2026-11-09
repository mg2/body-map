export interface MuscleDef { slug: string; commonName: string; anatomicalName: string; aliases: string[] }
export interface Match { slug: string; confidence: number; source: string; reason: string; where: "title" | "description"; phrase?: string[] }
export interface MatchResult { matches: Match[]; autoApprove: Match[]; needsReview: boolean; reviewReason?: string }

// Generic regions never auto-approve on their own.
export const GENERIC_REGIONS = ["back", "leg", "arm", "hip", "shoulder", "neck", "thigh"];

const IRREGULAR: Record<string, string> = { calves: "calf" };
const stem = (t: string) => IRREGULAR[t] ?? (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

export function tokens(text: string): string[] {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean).map(stem);
}
export const hasPhrase = (hay: string[], needle: string[]) => {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((n, j) => hay[i + j] === n)) return true;
  return false;
};
const hashtags = (text: string) => [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m => tokens(m[1]).join(""));

export function matchVideo(title: string, description: string, catalog: MuscleDef[]): MatchResult {
  const found = new Map<string, Match>();
  const add = (m: Match) => { const o = found.get(m.slug); if (!o || m.confidence > o.confidence || (m.confidence === o.confidence && m.where === "title")) found.set(m.slug, m); };
  for (const [where, text] of [["title", title], ["description", description]] as const) {
    const hay = tokens(text); const tags = hashtags(text);
    for (const m of catalog) {
      const checks: [string, "exact-rule" | "alias-rule", number][] = [
        [m.anatomicalName, "exact-rule", 1], [m.commonName, "exact-rule", 0.95],
        ...m.aliases.map(a => [a, "alias-rule", 0.9] as [string, "alias-rule", number]),
      ];
      for (const [phrase, source, confidence] of checks)
        if (hasPhrase(hay, tokens(phrase))) add({ slug: m.slug, confidence, source, reason: `Whole-word match on "${phrase}"`, where, phrase: tokens(phrase) });
      for (const [phrase] of checks)
        if (tags.includes(tokens(phrase).join(""))) add({ slug: m.slug, confidence: 0.9, source: "hashtag-rule" as never, reason: `Hashtag #${phrase.replace(/\s+/g, "")}`, where, phrase: tokens(phrase) });
    }
  }
  const all = [...found.values()];
  const matches = all.filter(m => !all.some(o => o.where === m.where && o.slug !== m.slug && o.phrase && m.phrase && o.phrase.length > m.phrase.length && hasPhrase(o.phrase, m.phrase)))
    .sort((a, b) => b.confidence - a.confidence);
  const titleHits = matches.filter(m => m.where === "title");
  const generic = hasPhrase(tokens(title), []) || GENERIC_REGIONS.some(g => tokens(title).includes(g));
  if (!matches.length) return { matches, autoApprove: [], needsReview: true, reviewReason: "No muscle identified" };
  if (!titleHits.length) return { matches, autoApprove: [], needsReview: true, reviewReason: "Only mentioned in description" };
  if (titleHits.length > 3) return { matches, autoApprove: [], needsReview: true, reviewReason: "Too many muscles in title; ambiguous" };
  void generic; // a specific title hit outweighs a generic region word ("back" + "lats")
  return { matches, autoApprove: titleHits, needsReview: false };
}

/** A "muscle-release" upload: the title contains one of the filter phrases (default: the word "release"). */
export function isReleaseTitle(title: string, phrases: string[] = ["release"]): boolean {
  const hay = tokens(title); return phrases.some(p => hasPhrase(hay, tokens(p)));
}
const target = (title: string) => /release[sd]?\s+(?:your|the|a|my|that|those|tight)?\s*([^|\-\u2013\u2014:(\[#]{2,40})/i.exec(title)?.[1]?.trim() ?? null;
export type Classification = { kind: "map"; matches: Match[] } | { kind: "skip"; reason: string };
/** Title-only classification. phrases=null skips the release-word requirement (used for links the user imports on purpose). */
export function classifyUpload(title: string, catalog: MuscleDef[], phrases: string[] | null = ["release"]): Classification {
  if (phrases && !isReleaseTitle(title, phrases)) return { kind: "skip", reason: "Title is not a muscle-release title" };
  const hits = matchVideo(title, "", catalog).matches.filter(m => m.where === "title");
  if (!hits.length) { const t = target(title); return { kind: "skip", reason: t ? `No muscle in the catalog matched "${t}"` : "No muscle recognised in the title" }; }
  if (hits.length > 6) return { kind: "skip", reason: "Too many muscles named in the title" };
  return { kind: "map", matches: hits };
}
