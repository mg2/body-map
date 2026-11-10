// GitHub Action step: render the static site into ./site. Every public and admin GET endpoint of the local server is saved as a file,
// so the browser reads exactly what the local app would return. No secret is ever written into the site:
// ADMIN_TOKEN is only stored ENCRYPTED with a key derived from ADMIN_PASSWORD (PBKDF2-SHA256 + AES-GCM); YOUTUBE_API_KEY is not used here at all.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { loadState } from "../lib/state.ts";
import { createServer } from "../server.ts";
import { backupDb } from "../lib/io.ts";

const STATE = process.env.STATE_PATH ?? "state/db.json", REPORTS = process.env.REPORTS_PATH ?? "state/reports.json", OUT = process.env.SITE_DIR ?? "site";
const VERSION: string = JSON.parse(readFileSync("package.json", "utf8")).version;
export const PBKDF2_ITERATIONS = 600_000;

const db = loadState(STATE);
const tmp = mkdtempSync(join(tmpdir(), "mmap-site-"));
const srv = createServer({ db, dataDir: tmp });
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const get = async (p: string) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`GET ${p} → ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
rmSync(OUT, { recursive: true, force: true });
const write = (p: string, data: string | Buffer) => { const f = join(OUT, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };

// public data, per collection
for (const c of ["all", "release", "yoga"]) {
  const muscles = await get(`/api/muscles?collection=${c}`); write(`api/muscles.${c}.json`, muscles);
  write(`api/recent.${c}.json`, await get(`/api/recent?collection=${c}`));
  for (const v of ["anterior", "posterior"]) write(`api/map.${v}.${c}.svg`, await get(`/api/map?view=${v}&collection=${c}`));
  for (const m of JSON.parse(muscles.toString("utf8"))) write(`api/videos/${m.slug}.${c}.json`, await get(`/api/muscles/${m.slug}/videos?collection=${c}`));
}
// admin data (titles of public YouTube videos plus your notes; the repository holds the same data)
const diag = JSON.parse((await get("/api/admin/diagnostics")).toString("utf8")); diag.youtubeApiKeyConfigured = process.env.HAS_YOUTUBE_KEY === "1"; diag.hosting = "github-pages";
write("api/admin/diagnostics.json", JSON.stringify(diag));
write("api/admin/review.json", await get("/api/admin/review"));
write("api/admin/sync-runs.json", await get("/api/admin/sync-runs"));
write("api/admin/export.json", await get("/api/admin/export.json"));
write("api/admin/export.csv", await get("/api/admin/export.csv"));
write("api/admin/backup.db", readFileSync(backupDb(db, tmp)));
const reports: any[] = existsSync(REPORTS) ? JSON.parse(readFileSync(REPORTS, "utf8")) : [];
write("api/admin/reports.json", JSON.stringify(reports));
srv.close();

const builtAt = new Date().toISOString(), build = builtAt.replace(/\D/g, "").slice(0, 14);
write("api/meta.json", JSON.stringify({ build, version: VERSION, builtAt, repo: process.env.GITHUB_REPOSITORY ?? "", branch: process.env.GITHUB_REF_NAME || "main", doneOps: reports.map(r => r.id) }));

// admin unlock file: the GitHub token, encrypted with the admin password
const pw = (process.env.ADMIN_PASSWORD ?? "").replace(/[\r\n]+$/, ""), token = (process.env.ADMIN_TOKEN ?? "").trim(); // a pasted secret often ends with a line break
if (pw && token) {
  const enc = new TextEncoder(), b64 = (u: ArrayBuffer | Uint8Array) => Buffer.from(u as ArrayBuffer).toString("base64");
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k0 = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, k0, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
  write("admin-key.json", JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
} else { write("admin-key.json", JSON.stringify({ v: 1, missing: [!pw && "ADMIN_PASSWORD", !token && "ADMIN_TOKEN"].filter(Boolean) })); console.warn("Admin login disabled: ADMIN_PASSWORD and/or ADMIN_TOKEN secret missing."); }

// static files
const CSP = "default-src 'self'; img-src 'self' https://i.ytimg.com data:; frame-src https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.github.com; base-uri 'none'; object-src 'none'";
const html = readFileSync("public/index.html", "utf8")
  .replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#1f6f9f">`)
  .replace('<script src="/theme.js"></script>', `<script src="theme.js?v=${build}"></script>`)
  .replace('<script src="/app.js"></script>', `<script src="static-api.js?v=${build}"></script><script src="app.js?v=${build}"></script>`); // new URLs per build: phones never mix old code with new data
if (!html.includes(`src="static-api.js?v=${build}"`)) throw new Error("public/index.html changed: could not insert static-api.js");
write("index.html", html);
for (const f of ["app.js", "theme.js", "static-api.js"]) copyFileSync(join("public", f), join(OUT, f));
write(".nojekyll", "");
console.log(`Site built in ./${OUT} (build ${build}).`);
