import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, seedCatalog, getSetting, setSetting } from "../src/lib/db.ts";
import * as A from "../src/lib/admin.ts";
import { runSync } from "../src/lib/sync.ts";
import { COLLECTIONS, ensureDefaultChannels, getChan, setChan, channelConfig, parseCollection, DEFAULT_YOGA_HANDLE } from "../src/lib/channels.ts";
import { exportJson, importJson, exportCsv, importCsv, restoreDb } from "../src/lib/io.ts";
import { createServer } from "../src/server.ts";

const fresh = () => { const db = openDb(); seedCatalog(db); return db; };
const n = (db: any, sql: string) => (db.prepare(sql).get() as any).n as number;
const ID = (k: number) => `vid${String(k).padStart(8, "0")}`; const url = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const sleep = async () => {};
const vid = (id: string, title: string, dur = "PT20M") => ({ id, snippet: { title, description: "", publishedAt: "2026-01-01T00:00:00Z", channelId: "UCx", channelTitle: "c", thumbnails: { high: { url: "https://i.ytimg.com/x.jpg" } } }, contentDetails: { duration: dur } });
interface Ch { handle: string; id: string; title: string; customUrl: string; uploads: string; videos: any[] }
const REL: Ch = { handle: "@EliteMassageBoulder", id: "UC" + "r".repeat(22), title: "Elite Massage and Injury Rehab", customUrl: "@elitemassageboulder", uploads: "UUrel", videos: [] };
const YOGA: Ch = { handle: "@yogawithkassandra", id: "UC" + "y".repeat(22), title: "Yoga With Kassandra", customUrl: "@yogawithkassandra", uploads: "UUyoga", videos: [] };
function fakeApi(chs: Ch[], fail: Record<string, number> = {}) {
  const calls: string[] = []; const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  const impl = (async (input: URL) => {
    const u = new URL(String(input)); const path = u.pathname.split("/").pop()!; const h = u.searchParams.get("forHandle"), pl = u.searchParams.get("playlistId"); calls.push(path + (h ? `:${h}` : "") + (pl ? `:${pl}` : ""));
    if (pl && fail[pl]) return new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: fail[pl] });
    if (path === "channels") { const c = chs.find(x => (h && x.handle.toLowerCase() === h.toLowerCase()) || x.id === u.searchParams.get("id")); return ok({ items: c ? [{ id: c.id, snippet: { title: c.title, customUrl: c.customUrl }, contentDetails: { relatedPlaylists: { uploads: c.uploads } } }] : [] }); }
    if (path === "playlistItems") return ok({ items: (chs.find(x => x.uploads === pl)?.videos ?? []).map(v => ({ contentDetails: { videoId: v.id } })) });
    if (path === "videos") { const ids = u.searchParams.get("id")!.split(","); return ok({ items: chs.flatMap(c => c.videos).filter(v => ids.includes(v.id)) }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch; return { impl, calls };
}
const withVideos = (c: Ch, videos: any[]): Ch => ({ ...c, videos });

test("collection helpers: filter parsing, defaults, legacy keys for the original channel", () => {
  assert.deepEqual([parseCollection("yoga"), parseCollection("release"), parseCollection("x"), parseCollection(undefined)], ["yoga", "release", "all", "all"]);
  const db = fresh(); assert.equal(channelConfig(db, "release").handle, "@EliteMassageBoulder"); assert.equal(channelConfig(db, "yoga").configured, false);
  ensureDefaultChannels(db); assert.equal(channelConfig(db, "yoga").handle, DEFAULT_YOGA_HANDLE); setChan(db, "yoga", "channelHandle", "@other"); ensureDefaultChannels(db); assert.equal(channelConfig(db, "yoga").handle, "@other"); // never overwrites
  setChan(db, "release", "channelId", "UCabc"); assert.equal(getSetting(db, "channelId"), "UCabc"); setChan(db, "yoga", "channelId", "UCxyz"); assert.equal(getSetting(db, "yoga.channelId"), "UCxyz"); assert.equal(getSetting(db, "channelId"), "UCabc");
});
test("sync: both channels land in their own collections, each resolved once", async () => {
  const db = fresh(); ensureDefaultChannels(db);
  const api = fakeApi([withVideos(REL, [vid(ID(1), "How to release your quads")]), withVideos(YOGA, [vid(ID(2), "20 min Yoga for Hips & Glutes"), vid(ID(3), "Guided Sleep Meditation"), vid(ID(5), "20 min Full Body Vinyasa Flow"), vid(ID(4), "Yoga for Tired Legs")])]);
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep });
  assert.equal(rep.status, "successful"); assert.deepEqual([rep.scanned, rep.added, rep.autoMapped, rep.ignored], [5, 5, 4, 1]); assert.equal(A.videosForMuscle(db, "full-body", "yoga").length, 1); // "Full Body" has its own target now
  assert.deepEqual([n(db, "SELECT COUNT(*) n FROM videos WHERE collection='release'"), n(db, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'")], [1, 4]);
  assert.equal(getSetting(db, "uploadsPlaylistId"), "UUrel"); assert.equal(getChan(db, "yoga", "uploadsPlaylistId"), "UUyoga"); assert.equal(getChan(db, "yoga", "channelTitle"), "Yoga With Kassandra");
  assert.equal((db.prepare("SELECT ignored_reason r FROM videos WHERE collection='yoga' AND processing_status='ignored'").get() as any).r.startsWith("[auto] No body area"), true);
  assert.equal(A.videosForMuscle(db, "gluteus-maximus", "yoga").length, 1); assert.equal(A.videosForMuscle(db, "gluteus-maximus", "yoga")[0].channelTitle, "c"); // attribution comes from the synced video itself assert.equal(A.videosForMuscle(db, "quadriceps", "yoga").length, 1); assert.equal(A.videosForMuscle(db, "quadriceps", "release").length, 1); assert.equal(A.videosForMuscle(db, "quadriceps", "all").length, 2);
  await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep }); assert.equal(api.calls.filter(c => c.startsWith("channels")).length, 2); // the handles are not re-resolved
});
test("sync: the collection option limits which channel is read", async () => {
  const db = fresh(); ensureDefaultChannels(db); const api = fakeApi([withVideos(REL, [vid(ID(1), "How to release your quads")]), withVideos(YOGA, [vid(ID(2), "Yoga for Hips")])]);
  await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep, collection: "yoga" }); assert.ok(api.calls.every(c => !c.includes("UUrel") && !c.includes("EliteMassage"))); assert.deepEqual([n(db, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'"), n(db, "SELECT COUNT(*) n FROM videos WHERE collection='release'")], [1, 0]);
  await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep, collection: "release" }); assert.equal(n(db, "SELECT COUNT(*) n FROM videos WHERE collection='release'"), 1);
});
test("sync: a failing channel is reported but does not stop the other one", async () => {
  const db = fresh(); setChan(db, "yoga", "channelHandle", "@doesnotexist"); const api = fakeApi([withVideos(REL, [vid(ID(1), "How to release your quads")])]);
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep }); assert.equal(rep.status, "partially-successful"); assert.match(rep.errors[0], /^\[yoga\] No channel found/); assert.equal(n(db, "SELECT COUNT(*) n FROM videos"), 1);
  const q = fakeApi([withVideos(REL, [vid(ID(1), "How to release your quads")]), withVideos(YOGA, [vid(ID(2), "Yoga for Hips")])], { UUyoga: 403 }); const db2 = fresh(); ensureDefaultChannels(db2);
  const rep2 = await runSync({ db: db2, apiKey: "KEY", fetchImpl: q.impl, mode: "full", sleep }); assert.equal(rep2.status, "partially-successful"); assert.match(rep2.errors[0], /^\[yoga\] .*quota/i); assert.equal(n(db2, "SELECT COUNT(*) n FROM videos WHERE collection='release'"), 1);
});
test("sync: the yoga channel must really be the handle we asked for", async () => {
  const db = fresh(); ensureDefaultChannels(db); const imposter: Ch = { ...YOGA, customUrl: "@someoneelse", videos: [vid(ID(2), "Yoga for Hips")] };
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: fakeApi([imposter]).impl, mode: "full", sleep, collection: "yoga" });
  assert.equal(rep.status, "failed"); assert.match(rep.errors[0], /@someoneelse, not @yogawithkassandra/); assert.equal(n(db, "SELECT COUNT(*) n FROM videos"), 0); assert.equal(getChan(db, "yoga", "uploadsPlaylistId"), undefined);
});
test("sync: unconfigured or disabled channels are skipped silently; dry run saves nothing", async () => {
  const db = fresh(); const api = fakeApi([withVideos(REL, [vid(ID(1), "How to release your quads")]), withVideos(YOGA, [vid(ID(2), "Yoga for Hips")])]);
  const r1 = await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep }); assert.equal(r1.status, "successful"); assert.equal(n(db, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'"), 0); // never configured: not touched
  ensureDefaultChannels(db); setChan(db, "yoga", "enabled", "0"); await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep }); assert.equal(n(db, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'"), 0);
  setChan(db, "yoga", "enabled", "1"); const dry = await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "full", sleep, dryRun: true }); assert.equal(dry.added, 1); assert.equal(n(db, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'"), 0); assert.equal(getChan(db, "yoga", "uploadsPlaylistId"), undefined);
});
test("collection filters: map states, counts, video lists and recent videos", () => {
  const db = fresh(); const a = A.importVideo(db, { url: url(ID(1)), title: "How to release your hamstrings" }) as any, b = A.importVideo(db, { url: url(ID(2)), title: "Yoga for Hamstrings & Hips", collection: "yoga" }) as any, c = A.importVideo(db, { url: url(ID(3)), title: "Yoga for Wrists", collection: "yoga" }) as any;
  assert.deepEqual([a.processing, b.processing, c.processing], ["automatically-mapped", "automatically-mapped", "automatically-mapped"]);
  const st = (k: any) => A.muscleStates(db, k); assert.equal(st("release")["hamstring-group"], "approved"); assert.equal(st("release")["forearm-flexors"], undefined); assert.equal(st("yoga")["forearm-flexors"], "approved"); assert.equal(st("all")["forearm-flexors"], "approved"); assert.equal(st("yoga")["piriformis"], "approved"); assert.equal(st("release")["piriformis"], undefined);
  const cnt = (k: any, slug: string) => A.listMuscles(db, k).find(m => m.slug === slug)!.videoCount; assert.deepEqual([cnt("release", "hamstring-group"), cnt("yoga", "hamstring-group"), cnt("all", "hamstring-group")], [1, 1, 2]);
  const v = A.videosForMuscle(db, "hamstring-group", "all"); assert.deepEqual(v.map((x: any) => x.collection).sort(), ["release", "yoga"]); assert.deepEqual(A.recentVideos(db, 10, "yoga").map((x: any) => x.collection), ["yoga", "yoga"]); assert.equal(A.recentVideos(db, 10, "release").length, 1); assert.equal(A.recentVideos(db).length, 3);
  const row = A.videosForMuscle(db, "hamstring-group", "yoga")[0]; const why = db.prepare("SELECT mapping_source s, mapping_reason r FROM mappings WHERE video_id=? AND muscle_id=(SELECT id FROM muscles WHERE slug='hamstring-group')").get(row.id) as any; assert.match(why.s, /rule/); assert.match(why.r, /title/);
});
test("yoga videos: no 'release' word needed, full-body ones are skipped, reset/re-check use the yoga rules", () => {
  const db = fresh(); const fb = A.importVideo(db, { url: url(ID(1)), title: "Guided Sleep Meditation", collection: "yoga" }) as any; assert.equal(fb.processing, "ignored"); assert.match(A.ignoredVideos(db)[0].ignoredReason!, /^\[auto\] No body area/); assert.equal(A.ignoredVideos(db)[0].collection, "yoga");
  const x = A.importVideo(db, { url: url(ID(2)), title: "Yoga for the Iliocostalis", collection: "yoga" }) as any; assert.equal(x.processing, "ignored"); A.addAlias(db, "erector-spinae", "iliocostalis"); assert.deepEqual(A.reclassifySkipped(db), { mapped: 1, stillSkipped: 1 }); assert.equal(A.videosForMuscle(db, "erector-spinae", "yoga").length, 1);
  db.prepare("UPDATE videos SET title='Yoga for Neck Pain' WHERE id=?").run(fb.videoId); assert.equal(A.resetToAutomatic(db, fb.videoId), "map"); assert.equal(A.videosForMuscle(db, "sternocleidomastoid", "yoga").length, 1);
  assert.equal((A.importVideo(db, { url: url(ID(3)), title: "Yoga for Hips" }) as any).processing, "ignored"); // area words only count for the yoga collection: \"hips\" alone names no muscle for a muscle-release link
});
test("catalog/rule changes re-check skipped yoga videos once (fingerprint covers the yoga rules)", () => {
  const db = fresh(); A.importVideo(db, { url: url(ID(1)), title: "Yoga for Hips", collection: "yoga" }); db.prepare("UPDATE videos SET processing_status='ignored', ignored_reason='[auto] old rules'").run(); setSetting(db, "catalogFingerprint", "stale");
  assert.deepEqual(A.upgradeIfCatalogChanged(db), { mapped: 1, stillSkipped: 0 }); assert.equal(A.upgradeIfCatalogChanged(db), null);
});
test("export/import and CSV keep the collection; old files without it default to muscle release", () => {
  const db = fresh(); A.importVideo(db, { url: url(ID(1)), title: "Yoga for Wrists", collection: "yoga" }); A.importVideo(db, { url: url(ID(2)), title: "How to release your quads" });
  const dst = fresh(); const sum = importJson(dst, exportJson(db)); assert.equal(sum.added, 2); assert.deepEqual([n(dst, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'"), n(dst, "SELECT COUNT(*) n FROM videos WHERE collection='release'")], [1, 1]);
  const csv = exportCsv(db); assert.ok(csv.split("\r\n")[0].endsWith(",collection")); const d2 = fresh(); assert.equal(importCsv(d2, csv).added, 2); assert.equal(A.videosForMuscle(d2, "forearm-flexors", "yoga").length, 1);
  const old = exportJson(db) as any; for (const v of old.videos) delete v.collection; const d3 = fresh(); importJson(d3, old); assert.equal(n(d3, "SELECT COUNT(*) n FROM videos WHERE collection='release'"), 2);
});
test("schema v2: the collection column is added, and an older (v1) backup is upgraded when restored", () => {
  const dir = mkdtempSync(join(tmpdir(), "mmap-mig-")); const f = join(dir, "v1.db"); const old = openDb(f);
  old.exec("DROP INDEX idx_videos_collection; ALTER TABLE videos DROP COLUMN collection; PRAGMA user_version=1");
  old.prepare("INSERT INTO videos(youtube_video_id,canonical_url,title,processing_status,import_source,discovered_at) VALUES('aaaaaaaaaaa','https://www.youtube.com/watch?v=aaaaaaaaaaa','Old video','ignored','youtube-sync','2025-01-01')").run(); old.close();
  const bytes = readFileSync(f); const up = openDb(f); assert.equal((up.prepare("PRAGMA user_version").get() as any).user_version, 2); assert.equal((up.prepare("SELECT collection c FROM videos").get() as any).c, "release"); up.close();
  const target = fresh(); const res = restoreDb(target, bytes, dir); assert.equal(res.videos, 1); assert.equal((target.prepare("SELECT collection c FROM videos").get() as any).c, "release");
  assert.throws(() => restoreDb(target, readFileSync(f).subarray(0, 50), dir), /not a SQLite/);
});
// ---- HTTP
const H = { "x-mmap": "1" };
function call(port: number, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; text: string }>((ok, bad) => { const b = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, method, path, headers: { host: `localhost:${port}`, ...(b ? { "content-type": "application/json", ...H } : {}) } }, res => { const c: Buffer[] = []; res.on("data", d => c.push(d)); res.on("end", () => ok({ status: res.statusCode!, text: Buffer.concat(c).toString() })); });
    r.on("error", bad); if (b) r.write(b); r.end(); });
}
async function withServer(fn: (port: number, db: any) => Promise<void>, fetchImpl?: typeof fetch) {
  const db = fresh(); ensureDefaultChannels(db); const srv = createServer({ db, apiKey: "KEY", dataDir: mkdtempSync(join(tmpdir(), "mmap-s-")), fetchImpl }); await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  try { await fn((srv.address() as any).port, db); } finally { srv.close(); }
}
test("HTTP: the collection parameter filters muscles, videos, recent videos and the map", () => withServer(async port => {
  await call(port, "POST", "/api/admin/import-url", { url: url(ID(1)), title: "How to release your quads" }); await call(port, "POST", "/api/admin/import-url", { url: url(ID(2)), title: "Yoga for Tired Legs", collection: "yoga" });
  const q = async (p: string) => JSON.parse((await call(port, "GET", p)).text); const quad = (list: any[]) => list.find(m => m.slug === "quadriceps");
  const counts: number[] = []; for (const c of ["release", "yoga", "all", "bogus"]) counts.push(quad(await q(`/api/muscles?collection=${c}`)).videoCount); assert.deepEqual(counts, [1, 1, 2, 2]);
  assert.deepEqual([(await q("/api/muscles/quadriceps/videos?collection=yoga")).map((v: any) => v.collection), (await q("/api/muscles/quadriceps/videos?collection=release")).map((v: any) => v.collection)], [["yoga"], ["release"]]);
  assert.deepEqual([(await q("/api/recent?collection=yoga")).length, (await q("/api/recent")).length], [1, 2]);
  const map = (c: string) => call(port, "GET", `/api/map?view=anterior&collection=${c}`).then(r => r.text); assert.match(await map("yoga"), /class="muscle approved"[^>]*aria-label="Quads \(group\)/); assert.match(await map("release"), /class="muscle approved"[^>]*aria-label="Quads \(group\)/);
  assert.doesNotMatch(await map("yoga"), /class="muscle approved"[^>]*aria-label="Rectus femoris/); const d = JSON.parse((await call(port, "GET", "/api/admin/diagnostics")).text); assert.deepEqual(d.counts.onMap, { release: 1, yoga: 1 });
}));
test("HTTP: per-channel settings, test connection and sync scope", () => withServer(async port => {
  const j = async (path: string, body: unknown) => JSON.parse((await call(port, "POST", path, body)).text);
  let d = await j("/api/admin/settings", { collection: "yoga", channelUrl: "https://youtube.com/@NewYogaChannel/videos" }); assert.equal(d.channels.yoga.handle, "@NewYogaChannel"); assert.equal(d.channels.release.handle, "@EliteMassageBoulder");
  d = await j("/api/admin/settings", { collection: "yoga", enabled: false }); assert.equal(d.channels.yoga.enabled, false); assert.equal(d.channels.release.enabled, true);
  assert.equal((await call(port, "POST", "/api/admin/settings", { collection: "yoga", channelUrl: "https://evil.com/@x" })).status, 400); assert.equal((await call(port, "POST", "/api/admin/channel", { collection: "yoga", channelId: "nope" })).status, 400);
  assert.equal((await call(port, "POST", "/api/admin/channel", { collection: "yoga", channelId: "UC" + "z".repeat(22) })).status, 200); assert.equal(JSON.parse((await call(port, "GET", "/api/admin/diagnostics")).text).channels.yoga.channelId, "UC" + "z".repeat(22));
}));
test("HTTP: test connection and re-resolve work per channel", async () => {
  const api = fakeApi([withVideos(REL, []), withVideos(YOGA, [])]);
  await withServer(async port => {
    const t = JSON.parse((await call(port, "POST", "/api/admin/test-api", { collection: "yoga" })).text); assert.equal(t.ok, true); assert.match(t.message, /yoga/);
    const r = JSON.parse((await call(port, "POST", "/api/admin/channel/resolve", { collection: "yoga" })).text); assert.deepEqual([r.collection, r.channelId, r.title], ["yoga", YOGA.id, "Yoga With Kassandra"]);
    const d = JSON.parse((await call(port, "GET", "/api/admin/diagnostics")).text); assert.equal(d.channels.yoga.uploadsPlaylistResolved, true); assert.equal(d.channels.release.uploadsPlaylistResolved, false);
    const s = JSON.parse((await call(port, "POST", "/api/admin/sync", { mode: "full", collection: "yoga" })).text); assert.equal(s.status, "successful");
  }, api.impl);
});

import { ignoreForeverAllAutoSkipped, unignoreBulk } from "../src/lib/admin.ts";
test("bulk ignore forever (per collection) only touches auto-skipped videos, and the bulk undo only reverses those", () => {
  const db = fresh(); const mk = (k: number, title: string, collection: "release" | "yoga") => (A.importVideo(db, { url: url(ID(k)), title, collection }) as any).videoId;
  const y1 = mk(1, "Guided Sleep Meditation", "yoga"), y2 = mk(2, "Q&A coffee chat", "yoga"), y3 = mk(3, "Morning flow vlog", "yoga"), r1 = mk(4, "Gym tour vlog", "release");
  A.ignoreVideo(db, y3, "my own choice"); A.ignoreForever(db, y2, "single"); // user decisions that bulk actions must leave alone
  assert.equal(ignoreForeverAllAutoSkipped(db, "yoga"), 1); // only y1
  assert.deepEqual([A.ignoredVideos(db).map((v: any) => v.id).sort(), A.foreverVideos(db).map((v: any) => v.id).sort()], [[y3, r1].sort(), [y1, y2].sort()]); // release untouched, y3 stays a user skip
  A.ignoreForever(db, A.ignoredVideos(db).find((v: any) => v.id === r1)!.id, "x"); db.prepare("UPDATE videos SET title='Yoga for Neck' WHERE id=?").run(y1); // y1's title would map now
  assert.deepEqual(unignoreBulk(db, "yoga"), { restored: 1, mapped: 1 }); assert.deepEqual(A.foreverVideos(db).map((v: any) => v.id).sort(), [y2, r1].sort()); // the single "forever" ones are NOT undone
  assert.equal(A.videosForMuscle(db, "sternocleidomastoid", "yoga").length, 1); assert.deepEqual(unignoreBulk(db, "release"), { restored: 0, mapped: 0 });
});
test("HTTP: bulk routes validate the collection", () => withServer(async port => {
  await call(port, "POST", "/api/admin/import-url", { url: url(ID(1)), title: "Evening Meditation", collection: "yoga" });
  assert.equal((await call(port, "POST", "/api/admin/ignore-forever-all", {})).status, 400); assert.equal((await call(port, "POST", "/api/admin/unignore-bulk", { collection: "nope" })).status, 400);
  assert.equal(JSON.parse((await call(port, "POST", "/api/admin/ignore-forever-all", { collection: "yoga" })).text).changed, 1);
  const r = JSON.parse((await call(port, "GET", "/api/admin/review")).text); assert.deepEqual([r.ignored.length, r.forever.length, r.forever[0].collection], [0, 1, "yoga"]);
  assert.deepEqual(JSON.parse((await call(port, "POST", "/api/admin/unignore-bulk", { collection: "yoga" })).text), { restored: 1, mapped: 0 });
}));

test("UPGRADE PATH: an existing single-channel (v1) database keeps its data and settings, then also syncs the yoga channel", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mmap-up-")); const f = join(dir, "app.db"); const old = openDb(f); seedCatalog(old);
  const REL2: Ch = { ...REL, videos: [vid(ID(1), "How to release your quads")] };
  old.prepare("INSERT INTO settings(key,value) VALUES('channelId',?),('uploadsPlaylistId','UUrel'),('channelHandle','@EliteMassageBoulder'),('channelTitle','Elite Massage and Injury Rehab')").run(REL.id);
  await runSync({ db: old, apiKey: "KEY", fetchImpl: fakeApi([REL2]).impl, mode: "full", sleep }); A.setNotes(old, 1, "my note"); A.setPrimary(old, 1, "quadriceps");
  old.exec("DROP INDEX idx_videos_collection; ALTER TABLE videos DROP COLUMN collection; PRAGMA user_version=1"); old.close(); // = what a database from the previous version looks like
  const db = openDb(f); ensureDefaultChannels(db); // what the app does on start-up
  assert.equal((db.prepare("PRAGMA user_version").get() as any).user_version, 2); assert.equal((db.prepare("SELECT collection c, notes n FROM videos").get() as any).c, "release"); assert.equal((db.prepare("SELECT notes n FROM videos").get() as any).n, "my note");
  assert.equal(A.videosForMuscle(db, "quadriceps", "release")[0].isPrimary, true); assert.equal(getSetting(db, "uploadsPlaylistId"), "UUrel"); assert.equal(channelConfig(db, "yoga").handle, DEFAULT_YOGA_HANDLE);
  const api = fakeApi([REL2, withVideos(YOGA, [vid(ID(2), "20 min Yoga for Hips & Glutes"), vid(ID(3), "Full Body Flow")])]); const rep = await runSync({ db, apiKey: "KEY", fetchImpl: api.impl, mode: "incremental", sleep });
  assert.equal(rep.status, "successful"); assert.equal(api.calls.filter(c => c.startsWith("channels")).length, 1, "only the yoga channel is resolved; the existing channel keeps its stored IDs");
  assert.deepEqual([n(db, "SELECT COUNT(*) n FROM videos WHERE collection='release'"), n(db, "SELECT COUNT(*) n FROM videos WHERE collection='yoga'")], [1, 2]); assert.equal(A.videosForMuscle(db, "piriformis", "yoga").length, 1); assert.equal(A.videosForMuscle(db, "quadriceps", "all").length, 1);
  assert.equal((db.prepare("SELECT notes n FROM videos WHERE collection='release'").get() as any).n, "my note"); // untouched by the upgrade and the sync
});
