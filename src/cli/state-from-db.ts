// One-off migration: copy a local SQLite database (data/app.db) into the repository state file (state/db.json).
//   npm run state:from-db                       (data/app.db → state/db.json)
//   node src/cli/state-from-db.ts <in.db> <out.json>
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../lib/db.ts";
import { saveState } from "../lib/state.ts";
const [src = "data/app.db", out = "state/db.json"] = process.argv.slice(2);
if (!existsSync(src)) { console.error(`${src} not found.`); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), "mmap-conv-")), copy = join(dir, "app.db"); // work on a copy: the original stays untouched
copyFileSync(src, copy); for (const x of ["-wal", "-shm"]) if (existsSync(src + x)) copyFileSync(src + x, copy + x);
const db = openDb(copy); saveState(db, out);
console.log(`Wrote ${out}: ${(db.prepare("SELECT COUNT(*) n FROM videos").get() as any).n} videos.`);
