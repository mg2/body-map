// GitHub Action step: apply queued admin changes (ops/*.json, committed by the Admin page) and optionally run a YouTube sync,
// then write the database back to state/db.json. Each op is replayed against the normal local server, so validation and logic are identical.
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadState, saveState, serializeState } from "../lib/state.ts";
import { createServer } from "../server.ts";

const STATE = process.env.STATE_PATH ?? "state/db.json", OPS = process.env.OPS_DIR ?? "ops", REPORTS = process.env.REPORTS_PATH ?? "state/reports.json";
const SYNC = process.env.SYNC_MODE ?? ""; // "", "incremental" or "full"
const KEEP_REPORTS = 100;

const db = loadState(STATE);
const srv = createServer({ db, apiKey: process.env.YOUTUBE_API_KEY || undefined, dataDir: mkdtempSync(join(tmpdir(), "mmap-")) });
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const before = serializeState(db, true); // after loading: includes upgrades a new app version made to the data
const reports: any[] = existsSync(REPORTS) ? JSON.parse(readFileSync(REPORTS, "utf8")) : [];

async function post(path: string, body: string | Buffer) {
  if (!/^\/api\/admin\/[a-z0-9/-]+$/.test(path)) return { status: 400, result: { error: "Not an admin action." } };
  const r = await fetch(base + path, { method: "POST", headers: { "x-mmap": "1", "content-type": "application/json" }, body });
  const text = await r.text(); let result: unknown = text; try { result = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, result };
}
const log = (id: string, path: string, res: { status: number; result: unknown }) => {
  let result = res.result; if (JSON.stringify(result ?? null).length > 4000) result = { note: "Result too large to keep; see the Action log." };
  reports.unshift({ id, path, at: new Date().toISOString(), ok: res.status < 400, status: res.status, result });
  console.log(`${res.status < 400 ? "✓" : "✗"} ${id} ${path} → ${res.status}`);
};

const files = existsSync(OPS) ? readdirSync(OPS).filter(f => f.endsWith(".json")).sort() : [];
for (const f of files) {
  const file = join(OPS, f); const id = f.replace(/\.json$/, "");
  try {
    const op = JSON.parse(readFileSync(file, "utf8"));
    const body = op.encoding === "base64" ? Buffer.from(String(op.body ?? ""), "base64") : typeof op.body === "string" ? op.body : JSON.stringify(op.body ?? {});
    log(op.id ?? id, String(op.path), await post(String(op.path), body));
  } catch (e) { log(id, "?", { status: 500, result: { error: (e as Error).message } }); }
  unlinkSync(file); // processed (successfully or not): never replay it
}
let quiet = false; // a scheduled check that found nothing new: no commit (otherwise the repository would get 4 empty commits a day)
if (SYNC === "incremental" || SYNC === "full") {
  const res = await post("/api/admin/sync", JSON.stringify({ mode: SYNC })); const r = res.result as any;
  quiet = !files.length && res.status < 400 && r?.status === "successful" && !r.added && !r.updated && serializeState(db, true) === before && existsSync(STATE);
  if (!quiet) log(`sync-${Date.now()}`, "/api/admin/sync", res); else console.log(`✓ ${SYNC} sync: nothing new (scanned ${r.scanned}); state left unchanged.`);
}
srv.close();
if (!quiet) { saveState(db, STATE); writeFileSync(REPORTS, JSON.stringify(reports.slice(0, KEEP_REPORTS), null, 1) + "\n"); }
console.log(`Processed ${files.length} admin change(s)${SYNC ? ` and a ${SYNC} sync` : ""}.`);
