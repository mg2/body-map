import http from "node:http";
import { readFileSync, createReadStream, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting, setSetting, SCHEMA_VERSION, type Db } from "./lib/db.ts";
import { COLLECTIONS, channelConfig, setChan, getChan, clearChan, parseCollection, type Collection } from "./lib/channels.ts";
import { renderBodyMap } from "./lib/bodymap.ts";
import * as A from "./lib/admin.ts";
import { exportCsv, exportJson, importCsv, importJson, backupDb, restoreDb } from "./lib/io.ts";
import { runSync } from "./lib/sync.ts";
import { fetchVideoMeta, resolveChannelByHandle, YouTubeApiError } from "./lib/youtube/api.ts";
import { parseChannelRef } from "./lib/youtube/url.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION: string = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const CSP = "default-src 'self'; img-src 'self' https://i.ytimg.com data:; frame-src https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";
export interface ServerOptions { db: Db; apiKey?: string; fetchImpl?: typeof fetch; dataDir: string }
class HttpError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }

export function createServer(o: ServerOptions) {
  const { db } = o;
  const send = (res: http.ServerResponse, code: number, body: string | Buffer, type = "application/json; charset=utf-8", extra: Record<string, string> = {}) => {
    res.writeHead(code, { "content-type": type, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": CSP, "cache-control": "no-store", ...extra }); res.end(body); };
  const json = (res: http.ServerResponse, data: unknown, code = 200) => send(res, code, JSON.stringify(data));
  const body = (req: http.IncomingMessage, limit: number) => new Promise<Buffer>((ok, bad) => { const c: Buffer[] = []; let n = 0;
    req.on("data", d => { n += d.length; if (n > limit) { bad(new HttpError(413, "Upload too large.")); req.destroy(); } else c.push(d); }); req.on("end", () => ok(Buffer.concat(c))); req.on("error", bad); });
  const jbody = async (req: http.IncomingMessage) => { try { return JSON.parse((await body(req, 2_000_000)).toString("utf8") || "{}"); } catch { throw new HttpError(400, "Invalid JSON."); } };
  const str = (v: unknown, max = 500) => { if (typeof v !== "string") throw new HttpError(400, "Expected text."); return v.slice(0, max); };
  const vid = (v: unknown) => { if (!Number.isInteger(v)) throw new HttpError(400, "Bad video id."); return v as number; };
  const slugs = (v: unknown) => { if (!Array.isArray(v) || v.length > 40 || v.some(s => typeof s !== "string")) throw new HttpError(400, "Bad muscle list."); return v as string[]; };
  const key = () => o.apiKey; const offline = () => getSetting(db, "networkSyncDisabled") === "1";

  async function diagnostics() {
    const last = (s: string) => db.prepare(s).get() as any;
    return { appVersion: VERSION, databaseAvailable: true, migrationVersion: (db.prepare("PRAGMA user_version").get() as any).user_version, expectedMigrationVersion: SCHEMA_VERSION,
      youtubeApiKeyConfigured: !!key(), creatorConfigured: !!(getSetting(db, "channelHandle") || getSetting(db, "channelId")), channelHandle: getSetting(db, "channelHandle") ?? null, creatorName: getSetting(db, "creatorName") ?? null,
      stableChannelIdResolved: !!getSetting(db, "channelId"), channelId: getSetting(db, "channelId") ?? null, channelTitle: getSetting(db, "channelTitle") ?? null, uploadsPlaylistResolved: !!getSetting(db, "uploadsPlaylistId"),
      networkSyncDisabled: offline(), titleFilter: A.titleFilter(db), lastSuccessfulSync: last("SELECT finished_at f FROM sync_runs WHERE status='successful' AND dry_run=0 ORDER BY id DESC LIMIT 1")?.f ?? null,
      lastSyncError: last("SELECT error_summary e FROM sync_runs WHERE error_summary IS NOT NULL AND dry_run=0 ORDER BY id DESC LIMIT 1")?.e ?? null,
      channels: Object.fromEntries(COLLECTIONS.map(c => { const k = channelConfig(db, c); return [c, { configured: k.configured, enabled: k.enabled, handle: k.handle ?? null, channelId: k.channelId ?? null, channelTitle: k.title ?? null, uploadsPlaylistResolved: !!k.uploadsPlaylistId, expectedTitle: k.expectedTitle ?? null }]; })),
      counts: { onMap: Object.fromEntries(COLLECTIONS.map(c => [c, last(`SELECT COUNT(*) n FROM videos WHERE collection='${c}' AND processing_status IN ('approved','automatically-mapped')`).n])), videos: last("SELECT COUNT(*) n FROM videos").n, awaitingReview: last("SELECT COUNT(*) n FROM videos WHERE processing_status='awaiting-review'").n, ignored: last("SELECT COUNT(*) n FROM videos WHERE processing_status='ignored'").n, unavailable: last("SELECT COUNT(*) n FROM videos WHERE availability_status='unavailable'").n } };
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!LOCAL.has(host)) throw new HttpError(403, "Only localhost access is allowed.");
    const url = new URL(req.url ?? "/", "http://localhost"); const p = url.pathname; const m = req.method ?? "GET";
    if (m === "POST") { if (req.headers["x-mmap"] !== "1") throw new HttpError(403, "Missing request header."); const org = req.headers.origin; if (org && org !== `http://${req.headers.host}`) throw new HttpError(403, "Cross-origin request blocked."); }
    if (m === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, readFileSync(join(ROOT, "public/index.html")), "text/html; charset=utf-8");
    if (m === "GET" && p === "/theme.js") return send(res, 200, readFileSync(join(ROOT, "public/theme.js")), "text/javascript; charset=utf-8");
    if (m === "GET" && p === "/app.js") return send(res, 200, readFileSync(join(ROOT, "public/app.js")), "text/javascript; charset=utf-8");
    // ---- public (viewer) API
    const coll = parseCollection(url.searchParams.get("collection")); // all | release | yoga
    if (m === "GET" && p === "/api/muscles") return json(res, A.listMuscles(db, coll));
    if (m === "GET" && p === "/api/recent") return json(res, A.recentVideos(db, 10, coll));
    if (m === "GET" && p === "/api/map") {
      const view = url.searchParams.get("view") === "posterior" ? "posterior" : "anterior"; const sel = url.searchParams.get("selected") ?? undefined;
      return send(res, 200, renderBodyMap(view, A.muscleStates(db, coll) as never, sel && /^[a-z0-9-]+$/.test(sel) ? sel : undefined), "image/svg+xml; charset=utf-8"); }
    let r = p.match(/^\/api\/muscles\/([a-z0-9-]+)\/videos$/); if (m === "GET" && r) return json(res, A.videosForMuscle(db, r[1], coll));
    if (!p.startsWith("/api/admin/")) throw new HttpError(404, "Not found.");
    // ---- admin API (local only; add authentication before exposing beyond localhost)
    if (m === "GET" && p === "/api/admin/diagnostics") return json(res, await diagnostics());
    if (m === "GET" && p === "/api/admin/review") return json(res, { queue: A.reviewQueue(db), ignored: A.ignoredVideos(db), forever: A.foreverVideos(db) });
    if (m === "GET" && p === "/api/admin/sync-runs") return json(res, db.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 15").all());
    if (m === "GET" && p === "/api/admin/export.json") return send(res, 200, JSON.stringify(exportJson(db), null, 1), "application/json", { "content-disposition": 'attachment; filename="muscle-map-export.json"' });
    if (m === "GET" && p === "/api/admin/export.csv") return send(res, 200, exportCsv(db), "text/csv; charset=utf-8", { "content-disposition": 'attachment; filename="muscle-map-videos.csv"' });
    if (m === "GET" && p === "/api/admin/backup") { const f = backupDb(db, o.dataDir); return send(res, 200, readFileSync(f), "application/octet-stream", { "content-disposition": `attachment; filename="${f.split(/[\\/]/).pop()}"` }); }
    if (m !== "POST") throw new HttpError(405, "Method not allowed.");
    if (p === "/api/admin/restore") return json(res, restoreDb(db, await body(req, 200_000_000), o.dataDir));
    if (p === "/api/admin/import-csv") return json(res, importCsv(db, (await body(req, 5_000_000)).toString("utf8")));
    const b = await jbody(req);
    if (p === "/api/admin/import-json") { try { return json(res, importJson(db, b)); } catch (e) { throw new HttpError(400, (e as Error).message); } }
    if (p === "/api/admin/approve") { try { A.approveVideo(db, vid(b.videoId), slugs(b.slugs)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, (e as Error).message); } return json(res, { ok: true }); }
    if (p === "/api/admin/ignore") { A.ignoreVideo(db, vid(b.videoId), typeof b.reason === "string" ? b.reason : ""); return json(res, { ok: true }); }
    if (p === "/api/admin/restore-video") { A.restoreVideo(db, vid(b.videoId)); return json(res, { ok: true }); }
    if (p === "/api/admin/availability") { A.setAvailability(db, vid(b.videoId), b.available === true); return json(res, { ok: true }); }
    if (p === "/api/admin/notes") { A.setNotes(db, vid(b.videoId), str(b.notes, 5000)); return json(res, { ok: true }); }
    if (p === "/api/admin/primary") { try { A.setPrimary(db, vid(b.videoId), str(b.slug, 80)); } catch (e) { throw new HttpError(400, (e as Error).message); } return json(res, { ok: true }); }
    if (p === "/api/admin/ignore-forever") { try { A.ignoreForever(db, vid(b.videoId), typeof b.note === "string" ? b.note : ""); } catch (e) { throw new HttpError(404, (e as Error).message); } return json(res, { ok: true }); }
    if (p === "/api/admin/ignore-forever-all" || p === "/api/admin/unignore-bulk") { if (b.collection !== "release" && b.collection !== "yoga") throw new HttpError(400, "Choose a collection (release or yoga).");
      return json(res, p.endsWith("-all") ? { changed: A.ignoreForeverAllAutoSkipped(db, b.collection) } : A.unignoreBulk(db, b.collection)); }
    if (p === "/api/admin/reset-video") { try { return json(res, { result: A.resetToAutomatic(db, vid(b.videoId)) }); } catch (e) { throw new HttpError(404, (e as Error).message); } }
    if (p === "/api/admin/unassign") { try { return json(res, A.unassignMuscle(db, vid(b.videoId), str(b.slug, 80))); } catch (e) { throw new HttpError(400, (e as Error).message); } }
    if (p === "/api/admin/alias/remove") { try { return json(res, { aliases: A.removeAlias(db, str(b.slug, 80), str(b.alias, 80)) }); } catch (e) { throw new HttpError(400, (e as Error).message); } }
    if (p === "/api/admin/alias") { try { return json(res, { aliases: A.addAlias(db, str(b.slug, 80), str(b.alias, 80)) }); } catch (e) { throw new HttpError(400, (e as Error).message); } }
    if (p === "/api/admin/import-url") return json(res, await importWithMeta(str(b.url, 500), b));
    if (p === "/api/admin/settings") {
      if (typeof b.networkSyncDisabled === "boolean") setSetting(db, "networkSyncDisabled", b.networkSyncDisabled ? "1" : "0");
      if (typeof b.titleFilter === "string") { const ph = b.titleFilter.split(",").map((x: string) => x.trim().slice(0, 40)).filter((x: string) => x.length >= 2).slice(0, 10); if (!ph.length) throw new HttpError(400, "Enter at least one phrase (2+ characters)."); setSetting(db, "titleFilterPhrases", JSON.stringify(ph)); }
      const cc: Collection = b.collection === "yoga" ? "yoga" : "release"; // which channel the next settings belong to
      if (typeof b.enabled === "boolean") setChan(db, cc, "enabled", b.enabled ? "1" : "0");
      if (typeof b.creatorName === "string" && b.creatorName.trim()) setChan(db, cc, "creatorName", b.creatorName.trim().slice(0, 100));
      if (typeof b.channelUrl === "string" && b.channelUrl.trim()) { const ref = parseChannelRef(b.channelUrl); if (!ref) throw new HttpError(400, "Unrecognized channel URL."); setChan(db, cc, "channelUrl", b.channelUrl.trim());
        if (ref.kind === "handle") { const old = getChan(db, cc, "channelHandle"); setChan(db, cc, "channelHandle", ref.value); if (old && old !== ref.value) clearChan(db, cc, ["channelId", "uploadsPlaylistId", "channelTitle"]); }
        else if (ref.kind === "id") { setChan(db, cc, "channelId", ref.value); clearChan(db, cc, ["uploadsPlaylistId"]); } else throw new HttpError(400, "Custom (/c/) URLs can't be resolved by the official API. Use the @handle or /channel/ URL."); }
      return json(res, await diagnostics()); }
    if (p === "/api/admin/reclassify") return json(res, A.reclassifySkipped(db));
    if (p === "/api/admin/channel") { const id = str(b.channelId, 40).trim(); if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) throw new HttpError(400, "A channel ID starts with UC and is 24 characters long."); const cc: Collection = b.collection === "yoga" ? "yoga" : "release"; setChan(db, cc, "channelId", id); clearChan(db, cc, ["uploadsPlaylistId"]); return json(res, { ok: true, note: "Saved. The next sync verifies it and fetches the uploads playlist." }); }
    if (p === "/api/admin/channel/resolve") { // "Re-resolve channel": resolves the handle again (verifying it) and stores the stable channel ID and uploads playlist
      if (offline()) throw new HttpError(400, "Network access is disabled in Settings."); const cc: Collection = b.collection === "yoga" ? "yoga" : "release", k = channelConfig(db, cc);
      const ch = await apiCall(() => resolveChannelByHandle({ apiKey: key(), handle: k.handle, expectedTitle: k.expectedTitle, fetchImpl: o.fetchImpl }));
      setChan(db, cc, "channelId", ch.channelId); setChan(db, cc, "uploadsPlaylistId", ch.uploadsPlaylistId); setChan(db, cc, "channelTitle", ch.title); return json(res, { ok: true, collection: cc, channelId: ch.channelId, title: ch.title }); }
    if (p === "/api/admin/test-api") { // safe, minimal connectivity check; never echoes the key
      if (offline()) return json(res, { ok: false, code: "offline", message: "Network access is disabled in Settings." });
      const cc: Collection = b.collection === "yoga" ? "yoga" : "release", k = channelConfig(db, cc);
      try { await resolveChannelByHandle({ apiKey: key(), handle: k.handle, channelId: k.handle ? undefined : k.channelId, expectedTitle: k.expectedTitle, fetchImpl: o.fetchImpl }); return json(res, { ok: true, code: "ok", message: `API key works and the ${cc === "yoga" ? "yoga" : "muscle-release"} channel was found.` }); }
      catch (e) { const c = e instanceof YouTubeApiError ? e.code : "error"; return json(res, { ok: ["mismatch", "ambiguous", "not-found"].includes(c), code: c, message: (e as Error).message }); } }
    if (p === "/api/admin/sync") { const mode = b.mode === "full" ? "full" : "incremental";
      try { return json(res, await runSync({ db, apiKey: key(), fetchImpl: o.fetchImpl, mode, dryRun: b.dryRun === true, collection: parseCollection(b.collection) })); } catch (e) { throw new HttpError(409, (e as Error).message); } }
    throw new HttpError(404, "Not found.");
  }
  async function apiCall<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { throw new HttpError(e instanceof YouTubeApiError ? 502 : 500, (e as Error).message); } }
  async function importWithMeta(url: string, b: any) {
    const parsed = (await import("./lib/youtube/url.ts")).parseYouTubeVideoUrl(url); let meta = null;
    if (parsed && key() && !offline() && !(db.prepare("SELECT 1 FROM videos WHERE youtube_video_id=?").get(parsed.videoId))) { try { meta = await fetchVideoMeta(key()!, parsed.videoId, o.fetchImpl); } catch (e) { if (!b.title) return { status: "api-error", error: (e as Error).message, youtubeVideoId: parsed.videoId }; } }
    return A.importVideo(db, { url, title: typeof b.title === "string" ? b.title : undefined, description: typeof b.description === "string" ? b.description : undefined, publishedAt: typeof b.publishedAt === "string" ? b.publishedAt : undefined, notes: typeof b.notes === "string" ? b.notes : undefined, slugs: Array.isArray(b.slugs) ? slugs(b.slugs) : [], meta, collection: b.collection === "yoga" ? "yoga" : "release" });
  }
  return http.createServer((req, res) => { route(req, res).catch(e => { const code = e instanceof HttpError ? e.status : 500; if (code === 500) console.error("[server]", (e as Error).message); if (!res.headersSent) json(res, { error: code === 500 ? "Internal error." : (e as Error).message }, code); }); });
}
