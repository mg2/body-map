import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "./db.ts";
import { SCHEMA_VERSION, migrate } from "./db.ts";
import { importVideo, insertVideo, tx } from "./admin.ts";
import { parseYouTubeVideoUrl } from "./youtube/url.ts";

export const CSV_HEADER = ["platform", "url", "title", "description", "publishedAt", "muscleSlugs", "notes", "collection"]; // "collection" (release|yoga) is optional on import
const FORMULA = /^[=+\-@\t\r]/;
export const csvCell = (v: unknown) => { let s = String(v ?? ""); if (FORMULA.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const unformula = (s: string) => s.replace(/^'(?=[=+\-@\t\r])/, "");
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false; const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c; }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row); return rows;
}
export function exportCsv(db: Db): string {
  const vs = db.prepare("SELECT * FROM videos ORDER BY published_at DESC").all() as any[];
  const slugs = db.prepare("SELECT m.slug FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id WHERE mp.video_id=? AND mp.review_status='approved' ORDER BY m.slug");
  return [CSV_HEADER.join(","), ...vs.map(v => ["youtube", v.canonical_url, v.title, v.description, v.published_at ?? "", (slugs.all(v.id) as any[]).map(x => x.slug).join(";"), v.notes, v.collection].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
export interface CsvSummary { totalRows: number; added: number; duplicates: number; invalid: { row: number; error: string }[]; warnings: { row: number; warning: string }[] }
export function importCsv(db: Db, text: string): CsvSummary {
  const rows = parseCsv(text); const out: CsvSummary = { totalRows: 0, added: 0, duplicates: 0, invalid: [], warnings: [] };
  if (!rows.length) { out.invalid.push({ row: 1, error: "File is empty." }); return out; }
  const head = rows[0].map(h => h.trim()); const col = (n: string) => head.indexOf(n);
  for (const need of ["platform", "url"]) if (col(need) < 0) { out.invalid.push({ row: 1, error: `Missing required column "${need}". Expected: ${CSV_HEADER.join(",")}` }); return out; }
  const known = new Set((db.prepare("SELECT slug FROM muscles").all() as any[]).map(m => m.slug));
  rows.slice(1).forEach((r, i) => {
    const n = i + 2; out.totalRows++; const g = (c: string) => (col(c) < 0 ? "" : unformula((r[col(c)] ?? "").trim()));
    if (g("platform").toLowerCase() !== "youtube") return void out.invalid.push({ row: n, error: `platform must be "youtube" (got "${g("platform").slice(0, 20)}").` });
    if (!parseYouTubeVideoUrl(g("url"))) return void out.invalid.push({ row: n, error: "Invalid or non-YouTube URL." });
    const pub = g("publishedAt"); if (pub && Number.isNaN(Date.parse(pub))) return void out.invalid.push({ row: n, error: `publishedAt is not a valid date: "${pub.slice(0, 30)}".` });
    const slugs = g("muscleSlugs").split(/[;|]/).map(s => s.trim()).filter(Boolean); const bad = slugs.filter(s => !known.has(s));
    if (bad.length) return void out.invalid.push({ row: n, error: `Unknown muscle slug(s): ${bad.join(", ").slice(0, 80)}.` });
    let title = g("title"); if (!title) { title = `Untitled YouTube video ${parseYouTubeVideoUrl(g("url"))!.videoId}`; out.warnings.push({ row: n, warning: "No title; placeholder used. Run a sync or edit later." }); }
    try { const res = importVideo(db, { url: g("url"), title, description: g("description"), publishedAt: pub, notes: g("notes"), slugs, source: "csv-import", collection: g("collection").toLowerCase() === "yoga" ? "yoga" : "release" });
      if (res.status === "added") out.added++; else if (res.status === "duplicate") out.duplicates++; else out.invalid.push({ row: n, error: res.status === "invalid" ? res.error : "Could not import." });
    } catch (e) { out.invalid.push({ row: n, error: (e as Error).message }); }
  });
  return out;
}

export function exportJson(db: Db) {
  const q = (s: string, ...p: any[]) => db.prepare(s).all(...p) as any[];
  return { app: "elite-massage-muscle-map", version: 1, exportedAt: new Date().toISOString(),
    muscleAliases: Object.fromEntries(q("SELECT slug, aliases FROM muscles").map(m => [m.slug, JSON.parse(m.aliases)])),
    videos: q("SELECT * FROM videos ORDER BY id").map(v => ({ youtubeVideoId: v.youtube_video_id, title: v.title, description: v.description, thumbnailUrl: v.thumbnail_url, publishedAt: v.published_at, channelId: v.channel_id, channelTitle: v.channel_title,
      collection: v.collection, durationSeconds: v.duration_seconds, isShortCandidate: !!v.is_short_candidate, availabilityStatus: v.availability_status, processingStatus: v.processing_status, ignoredReason: v.ignored_reason, importSource: v.import_source, notes: v.notes,
      mappings: q("SELECT m.slug, mp.confidence, mp.mapping_reason reason, mp.mapping_source source, mp.is_primary isPrimary, mp.review_status reviewStatus, mp.notes FROM mappings mp JOIN muscles m ON m.id=mp.muscle_id WHERE mp.video_id=?", v.id).map(x => ({ ...x, isPrimary: !!x.isPrimary })) })) };
}
export interface JsonSummary { added: number; existing: number; mappingsAdded: number; invalid: string[]; aliasesAdded: number }
/** Merge strategy: new videos are added; for videos that already exist locally only MISSING mappings are added and empty notes filled.
 *  Local processing status, ignore state, approved/rejected mappings and primary flags are never overwritten. */
export function importJson(db: Db, doc: any): JsonSummary {
  const out: JsonSummary = { added: 0, existing: 0, mappingsAdded: 0, invalid: [], aliasesAdded: 0 };
  if (!doc || doc.app !== "elite-massage-muscle-map" || !Array.isArray(doc.videos)) throw new Error("Not an Elite Massage Muscle Map export file.");
  if (doc.version !== 1) throw new Error(`Incompatible export version ${doc.version} (this app reads version 1).`);
  const mid = new Map((db.prepare("SELECT id, slug FROM muscles").all() as any[]).map(m => [m.slug, m.id]));
  tx(db, () => {
    for (const [slug, list] of Object.entries<any>(doc.muscleAliases ?? {})) { if (!mid.has(slug) || !Array.isArray(list)) continue;
      const cur: string[] = JSON.parse((db.prepare("SELECT aliases FROM muscles WHERE slug=?").get(slug) as any).aliases); let ch = false;
      for (const a of list) if (typeof a === "string" && a.length >= 2 && a.length <= 60 && !cur.some(c => c.toLowerCase() === a.toLowerCase())) { cur.push(a); out.aliasesAdded++; ch = true; }
      if (ch) db.prepare("UPDATE muscles SET aliases=? WHERE slug=?").run(JSON.stringify(cur), slug); }
    doc.videos.forEach((v: any, i: number) => {
      if (!v || typeof v.title !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(v.youtubeVideoId ?? "")) return void out.invalid.push(`videos[${i}]: bad youtubeVideoId or title`);
      const ex = db.prepare("SELECT id, notes FROM videos WHERE youtube_video_id=?").get(v.youtubeVideoId) as any; let vid: number;
      if (ex) { out.existing++; vid = ex.id; if (!ex.notes && typeof v.notes === "string") db.prepare("UPDATE videos SET notes=? WHERE id=?").run(v.notes.slice(0, 5000), vid); }
      else { out.added++; vid = insertVideo(db, { youtubeVideoId: v.youtubeVideoId, title: v.title, description: v.description, publishedAt: v.publishedAt, thumbnailUrl: v.thumbnailUrl, durationSeconds: v.durationSeconds, channelId: v.channelId, channelTitle: v.channelTitle, source: "csv-import", notes: v.notes, collection: v.collection === "yoga" ? "yoga" : "release" });
        db.prepare("DELETE FROM mappings WHERE video_id=?").run(vid); // use the file's own mappings and state instead of re-running matching
        const st = ["newly-imported", "automatically-mapped", "awaiting-review", "approved", "ignored", "unavailable"].includes(v.processingStatus) ? v.processingStatus : "awaiting-review";
        db.prepare("UPDATE videos SET processing_status=?, ignored_reason=?, import_source=?, availability_status=? WHERE id=?").run(st, v.ignoredReason ?? null, ["youtube-sync", "manual-url", "csv-import", "demo"].includes(v.importSource) ? v.importSource : "csv-import", v.availabilityStatus === "unavailable" ? "unavailable" : "available", vid); }
      for (const m of v.mappings ?? []) { const id = mid.get(m.slug); if (!id || !["approved", "pending", "rejected"].includes(m.reviewStatus)) continue;
        const r = db.prepare("INSERT OR IGNORE INTO mappings(muscle_id,video_id,confidence,mapping_reason,mapping_source,is_primary,review_status,notes) VALUES(?,?,?,?,?,?,?,?)")
          .run(id, vid, Number(m.confidence) || 0, String(m.reason ?? "Imported").slice(0, 300), String(m.source ?? "imported").slice(0, 40), ex ? 0 : m.isPrimary ? 1 : 0, m.reviewStatus, String(m.notes ?? "").slice(0, 1000)); out.mappingsAdded += Number(r.changes); }
    });
  });
  return out;
}

export function backupDb(db: Db, dir: string): string {
  mkdirSync(join(dir, "backups"), { recursive: true });
  const p = join(dir, "backups", `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`); db.exec(`VACUUM INTO '${p.replace(/'/g, "''")}'`); return p;
}
const TABLES = ["mappings", "videos", "muscles", "settings", "sync_runs"];
export function restoreDb(db: Db, bytes: Buffer, dir: string): { preRestoreBackup: string; videos: number } {
  if (bytes.length < 100 || bytes.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") throw new Error("That file is not a SQLite database.");
  mkdirSync(dir, { recursive: true }); const tmp = join(dir, "restore-candidate.db"); writeFileSync(tmp, bytes);
  try {
    const cand = new DatabaseSync(tmp); // our private copy: older backups are upgraded in place before they are checked and restored
    try {
      const v0 = (cand.prepare("PRAGMA user_version").get() as any).user_version; if (v0 >= 1 && v0 < SCHEMA_VERSION) migrate(cand);
      const v = (cand.prepare("PRAGMA user_version").get() as any).user_version; if (v !== SCHEMA_VERSION) throw new Error(`Backup schema version ${v} does not match this app (${SCHEMA_VERSION}).`);
      for (const t of TABLES) cand.prepare(`SELECT 1 FROM ${t} LIMIT 1`).all();
      if ((cand.prepare("PRAGMA integrity_check").get() as any).integrity_check !== "ok") throw new Error("Backup failed integrity check.");
    } catch (e) { throw new Error(/schema version|integrity/.test((e as Error).message) ? (e as Error).message : "Backup is not a valid Elite Massage Muscle Map database."); } finally { cand.close(); }
    const pre = backupDb(db, dir); db.exec("PRAGMA foreign_keys=OFF"); db.exec(`ATTACH '${tmp.replace(/'/g, "''")}' AS r`);
    try { tx(db, () => { for (const t of TABLES) db.exec(`DELETE FROM main.${t}`); for (const t of [...TABLES].reverse()) db.exec(`INSERT INTO main.${t} SELECT * FROM r.${t}`); }); }
    finally { db.exec("DETACH r"); db.exec("PRAGMA foreign_keys=ON"); }
    return { preRestoreBackup: pre, videos: (db.prepare("SELECT COUNT(*) n FROM videos").get() as any).n };
  } finally { try { unlinkSync(tmp); } catch { /* ignore */ } }
}
