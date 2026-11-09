import { mkdirSync } from "node:fs";
import { openDb, seedCatalog } from "../lib/db.ts";
import { upgradeIfCatalogChanged } from "../lib/admin.ts";
import { runSync } from "../lib/sync.ts";
import { ensureDefaultChannels } from "../lib/channels.ts";
import { createServer } from "../server.ts";
mkdirSync("data", { recursive: true });
const db = openDb(process.env.DATABASE_PATH ?? "data/app.db"); seedCatalog(db); ensureDefaultChannels(db);
{ const up = upgradeIfCatalogChanged(db); if (up && up.mapped + up.stillSkipped) console.log(`Catalog updated: re-checked old videos, ${up.mapped} added to the map, ${up.stillSkipped} skipped.`); }
const apiKey = process.env.YOUTUBE_API_KEY; const port = Number(process.env.PORT ?? 3000); const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "localhost") console.warn("WARNING: binding beyond localhost. The admin API has NO authentication; add it before exposing this app.");
createServer({ db, apiKey, dataDir: "data" }).listen(port, host, () => console.log(`Muscle map: http://localhost:${port}  (API key ${apiKey ? "configured" : "not configured"})`));
const sync = () => runSync({ db, apiKey, mode: "incremental" }).then(r => console.log(`[auto-sync] ${r.status}: +${r.added} new, ${r.awaitingReview} to review`)).catch(e => console.error("[auto-sync]", e.message));
if (apiKey && process.env.SYNC_ON_START === "1") void sync();
const mins = Number(process.env.SYNC_INTERVAL_MINUTES ?? 0); if (apiKey && mins >= 15) setInterval(sync, mins * 60_000).unref();
