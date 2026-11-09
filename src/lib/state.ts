import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb, seedCatalog, SCHEMA_VERSION, type Db } from "./db.ts";
import { ensureDefaultChannels } from "./channels.ts";
import { upgradeIfCatalogChanged } from "./admin.ts";
/** GitHub Pages mode: the whole database lives in the repository as one JSON file (one row per line, so git diffs stay readable).
 *  It is loaded into an in-memory SQLite database, so every existing query, rule and admin function keeps working unchanged. */
const TABLES = ["muscles", "settings", "videos", "mappings", "sync_runs"]; // insert order (foreign keys)
const ORDER: Record<string, string> = { settings: "key" };
export const KEEP_SYNC_RUNS = 50;

export function loadState(path: string): Db {
  const db = openDb(":memory:");
  if (existsSync(path)) {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (doc.app !== "elite-massage-muscle-map" || !doc.tables) throw new Error(`${path} is not a muscle-map state file.`);
    if (doc.schemaVersion > SCHEMA_VERSION) throw new Error(`${path} has schema ${doc.schemaVersion}; this app knows ${SCHEMA_VERSION}. Update the code.`);
    const cols = new Map(TABLES.map(t => [t, new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name as string))]));
    db.exec("BEGIN");
    try {
      for (const t of TABLES) { const known = cols.get(t)!; const cache = new Map<string, ReturnType<Db["prepare"]>>();
        for (const row of doc.tables[t] ?? []) { const ks = Object.keys(row).filter(k => known.has(k)); const sig = ks.join(",");
          let st = cache.get(sig); if (!st) { st = db.prepare(`INSERT INTO ${t}(${sig}) VALUES(${ks.map(() => "?").join(",")})`); cache.set(sig, st); }
          st.run(...ks.map(k => row[k])); } }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  seedCatalog(db); ensureDefaultChannels(db); upgradeIfCatalogChanged(db);
  return db;
}

export function saveState(db: Db, path: string) {
  const runs = db.prepare(`SELECT id FROM sync_runs ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_SYNC_RUNS - 1}`).get() as { id: number } | undefined;
  if (runs) db.prepare("DELETE FROM sync_runs WHERE id < ?").run(runs.id);
  const part = (t: string) => { const rows = db.prepare(`SELECT * FROM ${t} ORDER BY ${ORDER[t] ?? "id"}`).all();
    return `"${t}":[` + (rows.length ? "\n" + rows.map(r => JSON.stringify(r)).join(",\n") + "\n" : "") + "]"; };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `{"app":"elite-massage-muscle-map","schemaVersion":${SCHEMA_VERSION},"tables":{\n${TABLES.map(part).join(",\n")}\n}}\n`);
}
