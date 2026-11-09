import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { loadMuscleDefs, getSetting, setSetting } from "./db.ts";
import { CATALOG } from "./catalog.ts";
import { classifyUpload, type Classification, type MuscleDef } from "./matching.ts";
import { classifyYoga, AREA_RULES, POSE_RULES } from "./yoga.ts";
import type { Collection, CollFilter } from "./channels.ts";
import { parseYouTubeVideoUrl } from "./youtube/url.ts";
import type { VideoMeta } from "./youtube/api.ts";

const now = () => new Date().toISOString();
const all = <T = any>(db: Db, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[];
const one = <T = any>(db: Db, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
const run = (db: Db, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
let spCounter = 0;
/** Re-entrant transaction: the outermost call BEGINs, nested calls (or calls inside an outer BEGIN) use savepoints. */
export function tx<T>(db: Db, fn: () => T): T {
  const nested = (db as any).isTransaction as boolean; const sp = `sp${++spCounter}`; db.exec(nested ? `SAVEPOINT ${sp}` : "BEGIN");
  try { const v = fn(); db.exec(nested ? `RELEASE ${sp}` : "COMMIT"); return v; }
  catch (e) { db.exec(nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : "ROLLBACK"); throw e; }
}
export function titleFilter(db: Db): string[] { try { const v = JSON.parse(one(db, "SELECT value FROM settings WHERE key='titleFilterPhrases'")?.value ?? "null"); if (Array.isArray(v) && v.length) return v; } catch { /* default */ } return ["release"]; }
const ACTIVE = "('approved','automatically-mapped')";

const collFilter = (coll: CollFilter) => ({ cf: coll === "all" ? "" : " AND v.collection=?", cp: coll === "all" ? [] as string[] : [coll as string] });
/** Title classification for a collection: yoga videos are matched by body area / pose / muscle name, muscle-release videos need the release phrase (when synced). */
function classifyFor(coll: string, title: string, defs: MuscleDef[], fromSync: boolean, phrases: string[]): Classification {
  return coll === "yoga" ? classifyYoga(title, defs) : classifyUpload(title, defs, fromSync ? phrases : null);
}
export function muscleStates(db: Db, coll: CollFilter = "all"): Record<string, "approved" | "pending"> {
  const out: Record<string, "approved" | "pending"> = {}; const { cf, cp } = collFilter(coll);
  for (const r of all(db, `SELECT DISTINCT m.slug FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id JOIN videos v ON v.id=mp.video_id WHERE mp.review_status='pending' AND v.processing_status='awaiting-review'${cf}`, ...cp)) out[r.slug] = "pending";
  for (const r of all(db, `SELECT DISTINCT m.slug FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id JOIN videos v ON v.id=mp.video_id WHERE mp.review_status='approved' AND v.processing_status IN ${ACTIVE}${cf}`, ...cp)) out[r.slug] = "approved";
  return out;
}
const safeThumb = (u?: string | null) => { try { const x = new URL(u ?? ""); return x.protocol === "https:" && /(^|\.)ytimg\.com$/.test(x.hostname) ? x.href : null; } catch { return null; } };
export const publicVideo = (r: any) => ({ id: r.id, youtubeVideoId: r.youtube_video_id, canonicalUrl: r.canonical_url, title: r.title, description: String(r.description ?? "").slice(0, 600), publishedAt: r.published_at,
  thumbnailUrl: safeThumb(r.thumbnail_url), discoveredAt: r.discovered_at, isShort: !!r.is_short_candidate, unavailable: r.availability_status !== "available", status: r.processing_status, collection: r.collection ?? "release", channelTitle: r.channel_title ?? null, ignoredReason: r.ignored_reason, notes: r.notes, source: r.import_source, isPrimary: !!r.is_primary });

export function listMuscles(db: Db, coll: CollFilter = "all") {
  const { cf, cp } = collFilter(coll); const st = muscleStates(db, coll);
  const counts = Object.fromEntries(all(db, `SELECT m.slug, COUNT(*) n FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id JOIN videos v ON v.id=mp.video_id WHERE mp.review_status='approved' AND v.processing_status IN ${ACTIVE}${cf} GROUP BY m.slug`, ...cp).map(r => [r.slug, r.n]));
  return all(db, "SELECT * FROM muscles ORDER BY region, common_name").map(r => ({ slug: r.slug, commonName: r.common_name, anatomicalName: r.anatomical_name, aliases: JSON.parse(r.aliases), userAliases: (JSON.parse(r.aliases) as string[]).filter(a => !(CATALOG.find(c => c.slug === r.slug)?.aliases ?? []).some(b => b.toLowerCase() === a.toLowerCase())), region: r.region, view: r.view, isGroup: !!r.is_group, description: r.description, state: st[r.slug] ?? "none", videoCount: counts[r.slug] ?? 0 }));
}
export function videosForMuscle(db: Db, slug: string, coll: CollFilter = "all") {
  const { cf, cp } = collFilter(coll);
  return all(db, `SELECT v.*, mp.is_primary FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id JOIN videos v ON v.id=mp.video_id
    WHERE m.slug=? AND mp.review_status='approved' AND v.processing_status IN ${ACTIVE}${cf} ORDER BY mp.is_primary DESC, v.published_at DESC`, slug, ...cp).map(publicVideo);
}
export const recentVideos = (db: Db, n = 10, coll: CollFilter = "all") => { const { cf, cp } = collFilter(coll); return all(db, `SELECT v.* FROM videos v WHERE v.processing_status IN ${ACTIVE}${cf} ORDER BY COALESCE(v.published_at, v.discovered_at) DESC LIMIT ?`, ...cp, n).map(publicVideo); };
export function reviewQueue(db: Db) {
  return all(db, "SELECT * FROM videos WHERE processing_status='awaiting-review' ORDER BY published_at DESC").map(v => ({ ...publicVideo(v),
    suggestions: all(db, `SELECT m.slug, m.common_name commonName, mp.confidence, mp.mapping_reason reason, mp.mapping_source source FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id WHERE mp.video_id=? AND mp.review_status='pending' ORDER BY mp.confidence DESC`, v.id) }));
}
// ignored_reason conventions: "[auto] ..." = skipped by the app (re-checked when rules change); "[forever] ..." = ignored forever (never re-checked); anything else = skipped by you.
export const ignoredVideos = (db: Db) => all(db, "SELECT * FROM videos WHERE processing_status='ignored' AND COALESCE(ignored_reason,'') NOT LIKE '[forever]%' ORDER BY published_at DESC").map(publicVideo);
export const foreverVideos = (db: Db) => all(db, "SELECT * FROM videos WHERE processing_status='ignored' AND ignored_reason LIKE '[forever]%' ORDER BY published_at DESC").map(publicVideo);

function need(db: Db, id: number) { const v = one(db, "SELECT * FROM videos WHERE id=?", id); if (!v) throw new Error("Video not found."); return v; }
export function approveVideo(db: Db, videoId: number, slugs: string[]) {
  need(db, videoId); const uniq = [...new Set(slugs)]; if (!uniq.length) throw new Error("Choose at least one muscle.");
  const ids = uniq.map(s => one(db, "SELECT id FROM muscles WHERE slug=?", s)?.id ?? (() => { throw new Error(`Unknown muscle: ${s}`); })());
  tx(db, () => {
    run(db, `UPDATE mappings SET review_status='rejected', is_primary=0 WHERE video_id=? AND review_status!='rejected' AND muscle_id NOT IN (${ids.map(() => "?").join(",")})`, videoId, ...ids);
    for (const mid of ids) run(db, `INSERT INTO mappings(muscle_id,video_id,confidence,mapping_reason,mapping_source,review_status) VALUES(?,?,1,'Approved manually','manual','approved')
      ON CONFLICT(muscle_id,video_id) DO UPDATE SET review_status='approved', mapping_source='manual'`, mid, videoId);
    run(db, "UPDATE videos SET processing_status='approved', ignored_reason=NULL WHERE id=?", videoId);
  });
}
export function ignoreVideo(db: Db, id: number, reason = "") { need(db, id); run(db, "UPDATE videos SET processing_status='ignored', ignored_reason=? WHERE id=?", reason.replace(/^\s*\[(auto|forever)\]\s*/i, "").slice(0, 300) || null, id); }
/** Ignore forever: hidden from the map and from Skipped, never re-checked or re-mapped by syncs or rule changes. Undo with resetToAutomatic. */
export function ignoreForever(db: Db, id: number, note = "") { need(db, id); run(db, "UPDATE videos SET processing_status='ignored', ignored_reason=? WHERE id=?", `[forever] ${note.replace(/^\s*\[(auto|forever)\]\s*/i, "").trim()}`.trim().slice(0, 300), id); }
/** Undo ONE manual (or automatic) muscle assignment. The mapping is kept as "rejected" so syncs never re-add it. A video left with no muscle returns to Skipped. */
export function unassignMuscle(db: Db, videoId: number, slug: string) {
  need(db, videoId); const m = one(db, "SELECT id FROM muscles WHERE slug=?", slug); if (!m) throw new Error("Unknown muscle.");
  const r = run(db, "UPDATE mappings SET review_status='rejected', is_primary=0, mapping_source='manual', mapping_reason='Removed by you' WHERE video_id=? AND muscle_id=? AND review_status='approved'", videoId, m.id);
  if (!Number(r.changes)) throw new Error("This video is not assigned to that muscle.");
  const left = one(db, "SELECT COUNT(*) n FROM mappings WHERE video_id=? AND review_status='approved'", videoId).n as number;
  if (!left) run(db, "UPDATE videos SET processing_status='ignored', ignored_reason='Unassigned by you: no muscle left' WHERE id=?", videoId);
  return { remaining: left };
}
/** Discard every manual choice for a video (assignments, removals, ignore, ignore-forever) and let the app decide again from its title. Notes are kept. */
export function resetToAutomatic(db: Db, videoId: number): "map" | "skip" {
  const v = need(db, videoId); const defs = loadMuscleDefs(db); const idBy = new Map(defs.map(d => [d.slug, d.id]));
  const c = classifyFor(v.collection, v.title, defs, v.import_source === "youtube-sync", titleFilter(db));
  tx(db, () => { run(db, "DELETE FROM mappings WHERE video_id=?", videoId);
    if (c.kind === "map") { for (const x of c.matches) run(db, "INSERT OR IGNORE INTO mappings(muscle_id,video_id,confidence,mapping_reason,mapping_source,review_status) VALUES(?,?,?,?,?,'approved')", idBy.get(x.slug)!, videoId, x.confidence, `${x.reason} (in title)`, x.source);
      run(db, "UPDATE videos SET processing_status='automatically-mapped', ignored_reason=NULL WHERE id=?", videoId); }
    else run(db, "UPDATE videos SET processing_status='ignored', ignored_reason=? WHERE id=?", "[auto] " + c.reason, videoId); });
  return c.kind;
}
export function restoreVideo(db: Db, id: number) { need(db, id); run(db, "UPDATE videos SET processing_status='awaiting-review', ignored_reason=NULL WHERE id=? AND processing_status='ignored'", id); }
export function setAvailability(db: Db, id: number, available: boolean) { need(db, id); run(db, "UPDATE videos SET availability_status=? WHERE id=?", available ? "available" : "unavailable", id); }
export function setNotes(db: Db, id: number, notes: string) { need(db, id); run(db, "UPDATE videos SET notes=? WHERE id=?", notes.slice(0, 5000), id); }
export function setPrimary(db: Db, id: number, slug: string) {
  const m = one(db, "SELECT id FROM muscles WHERE slug=?", slug); if (!m) throw new Error("Unknown muscle.");
  if (!one(db, "SELECT 1 FROM mappings WHERE video_id=? AND muscle_id=? AND review_status='approved'", id, m.id)) throw new Error("Video is not approved for this muscle.");
  tx(db, () => { run(db, "UPDATE mappings SET is_primary=0 WHERE muscle_id=?", m.id); run(db, "UPDATE mappings SET is_primary=1 WHERE muscle_id=? AND video_id=?", m.id, id); });
}
/** Bulk "ignore forever" for ONE collection: only videos the app skipped automatically ([auto]); videos you skipped yourself are never touched. Undo with unignoreBulk. */
export function ignoreForeverAllAutoSkipped(db: Db, coll: Collection): number { return Number(run(db, "UPDATE videos SET ignored_reason='[forever] bulk: automatically skipped' WHERE processing_status='ignored' AND ignored_reason LIKE '[auto]%' AND collection=?", coll).changes); }
/** Undo the bulk ignore: only videos marked "[forever] bulk:" go back through the automatic flow; videos you ignored forever one by one stay ignored. */
export function unignoreBulk(db: Db, coll: Collection): { restored: number; mapped: number } {
  const ids = all(db, "SELECT id FROM videos WHERE processing_status='ignored' AND ignored_reason LIKE '[forever] bulk:%' AND collection=?", coll); let mapped = 0;
  tx(db, () => { for (const r of ids) if (resetToAutomatic(db, r.id) === "map") mapped++; }); return { restored: ids.length, mapped };
}
/** Remove an alias you added yourself. Built-in aliases cannot be removed (they come back on start-up). */
export function removeAlias(db: Db, slug: string, alias: string) {
  const row = one(db, "SELECT aliases FROM muscles WHERE slug=?", slug); if (!row) throw new Error("Unknown muscle.");
  const key = alias.trim().toLowerCase(); if ((CATALOG.find(c => c.slug === slug)?.aliases ?? []).some(a => a.toLowerCase() === key)) throw new Error("Built-in aliases can't be removed.");
  const list: string[] = JSON.parse(row.aliases); const next = list.filter(a => a.toLowerCase() !== key); if (next.length === list.length) throw new Error("Alias not found.");
  run(db, "UPDATE muscles SET aliases=? WHERE slug=?", JSON.stringify(next), slug); return next;
}
export function addAlias(db: Db, slug: string, alias: string) {
  const a = alias.trim().replace(/\s+/g, " "); if (a.length < 2 || a.length > 60) throw new Error("Alias must be 2-60 characters.");
  const m = one(db, "SELECT aliases FROM muscles WHERE slug=?", slug); if (!m) throw new Error("Unknown muscle.");
  const list: string[] = JSON.parse(m.aliases); if (list.some(x => x.toLowerCase() === a.toLowerCase())) return list;
  list.push(a); run(db, "UPDATE muscles SET aliases=? WHERE slug=?", JSON.stringify(list), slug); return list;
}

export interface NewVideo { youtubeVideoId: string; title: string; description?: string; publishedAt?: string | null; thumbnailUrl?: string | null; durationSeconds?: number | null; channelId?: string | null; channelTitle?: string | null; isShort?: boolean; source: "manual-url" | "csv-import" | "youtube-sync"; notes?: string; slugs?: string[]; requireRelease?: boolean; phrases?: string[]; collection?: Collection }
/** Stores a video and maps it automatically from its TITLE. Unmatched videos are stored as "ignored" with an "[auto]" reason (a Skipped list, not a review queue). */
export function insertVideo(db: Db, v: NewVideo): number {
  const defs = loadMuscleDefs(db); const idBy = new Map(defs.map(d => [d.slug, d.id]));
  const manual = (v.slugs ?? []).filter(s => idBy.has(s)); let status: string, ignored: string | null = null; let rows: { slug: string; confidence: number; reason: string; source: string }[];
  if (manual.length) { status = "approved"; rows = manual.map(slug => ({ slug, confidence: 1, reason: "Assigned manually at import", source: "manual" })); }
  else { const c = classifyFor(v.collection ?? "release", v.title, defs, !!v.requireRelease, v.phrases ?? ["release"]);
    if (c.kind === "map") { status = "automatically-mapped"; rows = c.matches.map(x => ({ slug: x.slug, confidence: x.confidence, reason: `${x.reason} (in title)`, source: x.source })); }
    else { status = "ignored"; ignored = "[auto] " + c.reason; rows = []; } }
  return tx(db, () => {
    const id = Number(run(db, `INSERT INTO videos(youtube_video_id,canonical_url,title,description,thumbnail_url,published_at,channel_id,channel_title,duration_seconds,is_short_candidate,processing_status,ignored_reason,import_source,notes,discovered_at,last_checked_at,collection)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.youtubeVideoId, `https://www.youtube.com/watch?v=${v.youtubeVideoId}`, v.title.slice(0, 500), (v.description ?? "").slice(0, 5000), v.thumbnailUrl ?? null, v.publishedAt ?? null,
      v.channelId ?? null, v.channelTitle ?? null, v.durationSeconds ?? null, v.isShort || (v.durationSeconds != null && v.durationSeconds <= 180) ? 1 : 0, status, ignored, v.source, (v.notes ?? "").slice(0, 5000), now(), now(), v.collection ?? "release").lastInsertRowid);
    const ins = db.prepare("INSERT OR IGNORE INTO mappings(muscle_id,video_id,confidence,mapping_reason,mapping_source,review_status) VALUES(?,?,?,?,?,'approved')");
    for (const x of rows) ins.run(idBy.get(x.slug)!, id, x.confidence, x.reason, x.source);
    return id;
  });
}
/** Re-checks videos that were skipped AUTOMATICALLY (never ones you ignored yourself) plus legacy "awaiting-review" videos from older versions, e.g. after adding an alias or changing the title filter. */
export function reclassifySkipped(db: Db) {
  const defs = loadMuscleDefs(db); const idBy = new Map(defs.map(d => [d.slug, d.id])); const phrases = titleFilter(db); let mapped = 0, stillSkipped = 0;
  tx(db, () => { for (const r of all(db, "SELECT id,title,import_source,processing_status,collection FROM videos WHERE processing_status='awaiting-review' OR (processing_status='ignored' AND ignored_reason LIKE '[auto]%')")) {
    const c = classifyFor(r.collection, r.title, defs, r.import_source === "youtube-sync", phrases);
    if (r.processing_status === "awaiting-review") run(db, "DELETE FROM mappings WHERE video_id=? AND review_status='pending'", r.id); // old machine suggestions (often description-based)
    if (c.kind === "map") { for (const x of c.matches) run(db, "INSERT OR IGNORE INTO mappings(muscle_id,video_id,confidence,mapping_reason,mapping_source,review_status) VALUES(?,?,?,?,?,'approved')", idBy.get(x.slug)!, r.id, x.confidence, `${x.reason} (in title)`, x.source);
      run(db, "UPDATE videos SET processing_status='automatically-mapped', ignored_reason=NULL WHERE id=?", r.id); mapped++; }
    else { run(db, "UPDATE videos SET processing_status='ignored', ignored_reason=? WHERE id=?", "[auto] " + c.reason, r.id); stillSkipped++; } } });
  return { mapped, stillSkipped };
}
/** When the built-in catalog/aliases change (new app version), re-check automatically skipped and legacy review videos once. Returns null if nothing changed. */
export function upgradeIfCatalogChanged(db: Db) {
  const fp = createHash("sha1").update(JSON.stringify([CATALOG.map(m => [m.slug, m.aliases]), AREA_RULES, POSE_RULES])).digest("hex").slice(0, 12);
  if (getSetting(db, "catalogFingerprint") === fp) return null;
  const r = reclassifySkipped(db); setSetting(db, "catalogFingerprint", fp); return r;
}
export type ImportResult = { status: "added"; videoId: number; processing: string } | { status: "duplicate"; videoId: number } | { status: "invalid"; error: string } | { status: "needs-metadata"; youtubeVideoId: string };
export function importVideo(db: Db, o: { url: string; title?: string; description?: string; publishedAt?: string; notes?: string; slugs?: string[]; source?: "manual-url" | "csv-import"; meta?: VideoMeta | null; collection?: Collection }): ImportResult {
  const p = parseYouTubeVideoUrl(o.url); if (!p) return { status: "invalid", error: "Not a valid YouTube video URL (only youtube.com, youtu.be and youtube-nocookie.com links are accepted)." };
  const ex = one(db, "SELECT id FROM videos WHERE youtube_video_id=?", p.videoId); if (ex) return { status: "duplicate", videoId: ex.id };
  const title = (o.meta?.title || o.title || "").trim(); if (!title) return { status: "needs-metadata", youtubeVideoId: p.videoId };
  const pub = o.meta?.publishedAt ?? (o.publishedAt && !Number.isNaN(Date.parse(o.publishedAt)) ? new Date(o.publishedAt).toISOString() : null);
  const id = insertVideo(db, { youtubeVideoId: p.videoId, title, description: o.meta?.description ?? o.description, publishedAt: pub, thumbnailUrl: o.meta?.thumbnailUrl, durationSeconds: o.meta?.durationSeconds, channelId: o.meta?.channelId, channelTitle: o.meta?.channelTitle,
    isShort: p.isShortUrl, source: o.source ?? "manual-url", notes: o.notes, slugs: o.slugs, collection: o.collection });
  return { status: "added", videoId: id, processing: one(db, "SELECT processing_status s FROM videos WHERE id=?", id).s };
}
