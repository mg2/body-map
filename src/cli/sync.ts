import { mkdirSync } from "node:fs";
import { openDb, seedCatalog } from "../lib/db.ts";
import { upgradeIfCatalogChanged } from "../lib/admin.ts";
import { runSync } from "../lib/sync.ts";
import { ensureDefaultChannels, parseCollection } from "../lib/channels.ts";
const args = process.argv.slice(2);
mkdirSync("data", { recursive: true });
const db = openDb(process.env.DATABASE_PATH ?? "data/app.db"); seedCatalog(db); ensureDefaultChannels(db);
{ const up = upgradeIfCatalogChanged(db); if (up && up.mapped + up.stillSkipped) console.log(`Catalog updated: re-checked old videos, ${up.mapped} added to the map, ${up.stillSkipped} skipped.`); }
const key = process.env.YOUTUBE_API_KEY;
console.log(`YouTube API key: ${key ? `configured (ends …${key.slice(-4)})` : "NOT configured"}`);
try {
  const rep = await runSync({ db, apiKey: key, mode: args.includes("--full") ? "full" : "incremental", dryRun: args.includes("--dry-run"), collection: parseCollection(args.find(a => a.startsWith("--collection="))?.split("=")[1]) });
  const secs = ((Date.parse(rep.finishedAt) - Date.parse(rep.startedAt)) / 1000).toFixed(1);
  console.log(`${rep.dryRun ? "[DRY RUN, nothing saved] " : ""}Sync ${rep.status} in ${secs}s
  scanned ${rep.scanned} | added ${rep.added} | updated ${rep.updated} | skipped ${rep.skipped}
  auto-mapped ${rep.autoMapped} | awaiting review ${rep.awaitingReview} | ignored ${rep.ignored} | API requests ${rep.apiRequests}`);
  if (rep.errors.length) { console.error("Errors:\n  " + rep.errors.join("\n  ")); process.exitCode = 1; }
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
