import { DatabaseSync } from "node:sqlite";
import { CATALOG } from "./catalog.ts";
import { DESCRIPTIONS } from "./descriptions.ts";
import type { MuscleDef } from "./matching.ts";
export type Db = DatabaseSync;
const MIGRATIONS = [`
CREATE TABLE muscles(id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, common_name TEXT NOT NULL, anatomical_name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  region TEXT NOT NULL, side TEXT NOT NULL, view TEXT NOT NULL, svg_element_ids TEXT NOT NULL DEFAULT '[]', is_group INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '');
CREATE TABLE videos(id INTEGER PRIMARY KEY, youtube_video_id TEXT UNIQUE NOT NULL, canonical_url TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT, published_at TEXT, channel_id TEXT, channel_title TEXT, duration_seconds INTEGER, is_short_candidate INTEGER NOT NULL DEFAULT 0,
  availability_status TEXT NOT NULL DEFAULT 'available',
  processing_status TEXT NOT NULL CHECK(processing_status IN ('newly-imported','automatically-mapped','awaiting-review','approved','ignored','unavailable')),
  ignored_reason TEXT, import_source TEXT NOT NULL DEFAULT 'youtube-sync', notes TEXT NOT NULL DEFAULT '', discovered_at TEXT NOT NULL, last_checked_at TEXT);
CREATE TABLE mappings(id INTEGER PRIMARY KEY, muscle_id INTEGER NOT NULL REFERENCES muscles(id), video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  confidence REAL NOT NULL, mapping_reason TEXT NOT NULL, mapping_source TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL CHECK(review_status IN ('approved','pending','rejected')), notes TEXT NOT NULL DEFAULT '', UNIQUE(muscle_id, video_id));
CREATE TABLE sync_runs(id INTEGER PRIMARY KEY, sync_type TEXT NOT NULL, status TEXT NOT NULL, dry_run INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT,
  videos_scanned INTEGER NOT NULL DEFAULT 0, videos_added INTEGER NOT NULL DEFAULT 0, videos_updated INTEGER NOT NULL DEFAULT 0, videos_skipped INTEGER NOT NULL DEFAULT 0,
  videos_auto_mapped INTEGER NOT NULL DEFAULT 0, videos_awaiting_review INTEGER NOT NULL DEFAULT 0, videos_ignored INTEGER NOT NULL DEFAULT 0,
  api_requests INTEGER NOT NULL DEFAULT 0, error_summary TEXT);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
`ALTER TABLE videos ADD COLUMN collection TEXT NOT NULL DEFAULT 'release'; CREATE INDEX idx_videos_collection ON videos(collection);`];

export const SCHEMA_VERSION = MIGRATIONS.length;
export function openDb(path = ":memory:"): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  migrate(db); return db;
}
/** Applies any schema migrations this database is missing (also used to upgrade older backups before restoring them). */
export function migrate(db: Db) {
  const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = v; i < MIGRATIONS.length; i++) { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version=${i + 1}`); }
}
export const getSetting = (db: Db, k: string) => (db.prepare("SELECT value FROM settings WHERE key=?").get(k) as { value: string } | undefined)?.value;
export const setSetting = (db: Db, k: string, v: string) => { db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v); };

export function seedCatalog(db: Db) {
  const st = db.prepare(`INSERT INTO muscles(slug,common_name,anatomical_name,aliases,region,side,view,svg_element_ids,is_group,description) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET common_name=excluded.common_name, anatomical_name=excluded.anatomical_name, region=excluded.region, side=excluded.side, view=excluded.view, is_group=excluded.is_group, description=excluded.description`);
  // aliases are only set on first insert so user-added aliases survive re-seeding
  for (const m of CATALOG) {
    const ids = JSON.stringify((m.view === "both" ? ["anterior", "posterior"] : [m.view]).map(v => `muscle-${v}-${m.slug}`));
    st.run(m.slug, m.commonName, m.anatomicalName, JSON.stringify(m.aliases), m.region, m.side, m.view, ids, m.isGroup ? 1 : 0, DESCRIPTIONS[m.slug] ?? "");
    // upgrade path: add aliases introduced by newer catalogs without removing ones the user added
    const cur: string[] = JSON.parse((db.prepare("SELECT aliases FROM muscles WHERE slug=?").get(m.slug) as any).aliases);
    const add = m.aliases.filter(a => !cur.some(c => c.toLowerCase() === a.toLowerCase()));
    if (add.length) db.prepare("UPDATE muscles SET aliases=? WHERE slug=?").run(JSON.stringify([...cur, ...add]), m.slug);
  }
}
export function loadMuscleDefs(db: Db): (MuscleDef & { id: number })[] {
  return (db.prepare("SELECT id,slug,common_name,anatomical_name,aliases FROM muscles").all() as any[])
    .map(r => ({ id: r.id, slug: r.slug, commonName: r.common_name, anatomicalName: r.anatomical_name, aliases: JSON.parse(r.aliases) }));
}
