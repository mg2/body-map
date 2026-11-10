import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, seedCatalog, setSetting, getSetting } from "../src/lib/db.ts";
import * as A from "../src/lib/admin.ts";
import { importCsv, exportCsv, exportJson, importJson, backupDb, restoreDb, csvCell, parseCsv } from "../src/lib/io.ts";
import { runSync } from "../src/lib/sync.ts";
import { createServer } from "../src/server.ts";

const fresh = () => { const db = openDb(); seedCatalog(db); return db; };
const n = (db: any, sql: string) => (db.prepare(sql).get() as any).n as number;
const ID1 = "aaaaaaaaaaa", ID2 = "bbbbbbbbbbb";
const url = (id: string) => `https://www.youtube.com/watch?v=${id}`;

test("manual import: dedupes across URL forms, rejects impostors, needs a title without API", () => {
  const db = fresh();
  assert.equal(A.importVideo(db, { url: url(ID1) }).status, "needs-metadata");
  const r = A.importVideo(db, { url: `https://youtu.be/${ID1}`, title: "Quad release", slugs: ["quadriceps"] }) as any;
  assert.deepEqual([r.status, r.processing], ["added", "approved"]);
  assert.equal(A.importVideo(db, { url: `https://youtube.com/shorts/${ID1}` }).status, "duplicate");
  assert.equal(A.importVideo(db, { url: `https://youtube.com.evil.io/watch?v=${ID2}`, title: "x" }).status, "invalid");
  assert.equal(n(db, "SELECT COUNT(*) n FROM videos"), 1); assert.equal(A.videosForMuscle(db, "quadriceps").length, 1);
});
test("skipped list + manual assignment: approve, reassign, ignore, restore, primary, notes", () => {
  const db = fresh(); const r1 = A.importVideo(db, { url: url(ID1), title: "Fix your lower back" }) as any; const r2 = A.importVideo(db, { url: url(ID2), title: "Calf release" }) as any;
  assert.equal(r1.processing, "ignored"); assert.equal(A.reviewQueue(db).length, 0); assert.match(A.ignoredVideos(db)[0].ignoredReason!, /^\[auto\] /);
  assert.equal(A.muscleStates(db)["gastrocnemius"], "approved"); // auto-mapped, unambiguous
  A.approveVideo(db, r1.videoId, ["erector-spinae", "quadratus-lumborum"]); assert.equal(A.ignoredVideos(db).length, 0);
  A.approveVideo(db, r1.videoId, ["quadratus-lumborum"]); // reassign: erector mapping becomes rejected
  assert.equal(A.videosForMuscle(db, "erector-spinae").length, 0); assert.equal(A.videosForMuscle(db, "quadratus-lumborum").length, 1);
  A.ignoreVideo(db, r1.videoId, "generic"); assert.equal(A.videosForMuscle(db, "quadratus-lumborum").length, 0); assert.equal(A.ignoredVideos(db)[0].ignoredReason, "generic");
  A.restoreVideo(db, r1.videoId); assert.equal(A.reviewQueue(db).length, 1);
  assert.throws(() => A.approveVideo(db, r1.videoId, []), /at least one/); assert.throws(() => A.approveVideo(db, r1.videoId, ["nope"]), /Unknown muscle/);
  const r3 = A.importVideo(db, { url: `https://www.youtube.com/watch?v=ccccccccccc`, title: "Calves again" }) as any;
  A.setPrimary(db, r3.videoId, "gastrocnemius"); assert.equal(A.videosForMuscle(db, "gastrocnemius")[0].id, r3.videoId);
  assert.throws(() => A.setPrimary(db, r3.videoId, "deltoid"), /not approved/);
  A.setNotes(db, r2.videoId, "<script>alert(1)</script>"); assert.equal(A.videosForMuscle(db, "gastrocnemius").find((v: any) => v.id === r2.videoId)!.notes, "<script>alert(1)</script>"); // stored as text; UI renders via textContent
  assert.deepEqual(A.addAlias(db, "soleus", "deep calf").slice(-1), ["deep calf"]); assert.throws(() => A.addAlias(db, "soleus", "x"));
});
test("thumbnail allowlist drops non-ytimg URLs", () => {
  const db = fresh(); const r = A.insertVideo(db, { youtubeVideoId: ID1, title: "Lats", thumbnailUrl: "https://evil.example/x.jpg", source: "manual-url" });
  assert.equal(A.videosForMuscle(db, "latissimus-dorsi")[0].thumbnailUrl, null); void r;
});

test("CSV: formula injection protection and round trip", () => {
  for (const c of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) assert.ok(csvCell(c).startsWith("'"), c);
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  const db = fresh(); A.importVideo(db, { url: url(ID1), title: "=HYPERLINK(\"http://evil\")", slugs: ["deltoid"] });
  const csv = exportCsv(db); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  const db2 = fresh(); const s = importCsv(db2, csv); assert.equal(s.added, 1);
  assert.equal((db2.prepare("SELECT title FROM videos").get() as any).title, '=HYPERLINK("http://evil")'); // un-escaped on re-import
  assert.equal(parseCsv('a,b\r\n"x,1","y ""q"""\n').length, 2);
});
test("CSV import: reports bad rows, keeps good ones, no duplicates", () => {
  const db = fresh(); const csv = ["platform,url,title,description,publishedAt,muscleSlugs,notes",
    `youtube,${url(ID1)},Good one,,2026-01-02,deltoid,note`, `instagram,https://instagram.com/p/x,Nope,,,,`, `youtube,https://evil.com/watch?v=${ID2},Bad,,,,`,
    `youtube,${url(ID2)},Bad date,,not-a-date,,`, `youtube,${url("ccccccccccc")},Bad slug,,,not-a-muscle,`, `youtube,https://youtu.be/${ID1},Dup,,,,`, `youtube,${url("ddddddddddd")},,,,,`].join("\n");
  const s = importCsv(db, csv);
  assert.deepEqual([s.totalRows, s.added, s.duplicates, s.invalid.length, s.warnings.length], [7, 2, 1, 4, 1]);
  assert.deepEqual(s.invalid.map(i => i.row), [3, 4, 5, 6]);
  assert.match(importCsv(db, "foo,bar\n1,2").invalid[0].error, /Missing required column/);
});
test("JSON import: version check and merge never overwrites local decisions", () => {
  const src = fresh(); const r = A.importVideo(src, { url: url(ID1), title: "Traps", slugs: ["trapezius-group"], notes: "from file" }) as any; const doc = exportJson(src);
  assert.throws(() => importJson(fresh(), { ...doc, version: 2 }), /Incompatible/); assert.throws(() => importJson(fresh(), { nope: 1 }), /Not an Elite/);
  const dst = fresh(); const e = A.importVideo(dst, { url: url(ID1), title: "Traps" }) as any; // same video, local decisions differ
  A.ignoreVideo(dst, e.videoId, "mine"); A.setNotes(dst, e.videoId, "local note");
  const sum = importJson(dst, doc); assert.equal(sum.existing, 1);
  const v = dst.prepare("SELECT processing_status s, notes, ignored_reason r FROM videos").get() as any; assert.deepEqual([v.s, v.notes, v.r], ["ignored", "local note", "mine"]);
  const fresh2 = fresh(); const s2 = importJson(fresh2, doc); assert.deepEqual([s2.added, s2.mappingsAdded], [1, 1]); assert.equal(A.videosForMuscle(fresh2, "trapezius-group").length, 1); void r;
});
test("backup and restore round trip, with safety backup and validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "mmap-")); const db = fresh(); A.importVideo(db, { url: url(ID1), title: "Lats", slugs: ["latissimus-dorsi"] });
  const file = backupDb(db, dir); const bytes = readFileSync(file);
  A.importVideo(db, { url: url(ID2), title: "Glutes", slugs: ["gluteus-maximus"] }); assert.equal(n(db, "SELECT COUNT(*) n FROM videos"), 2);
  const res = restoreDb(db, bytes, dir); assert.equal(res.videos, 1); assert.equal(n(db, "SELECT COUNT(*) n FROM videos"), 1); assert.ok(res.preRestoreBackup.includes("backup-"));
  assert.equal(A.videosForMuscle(db, "latissimus-dorsi").length, 1);
  assert.throws(() => restoreDb(db, Buffer.from("not a database at all".repeat(20)), dir), /not a SQLite/);
  assert.equal(n(db, "SELECT COUNT(*) n FROM videos"), 1);
});
test("offline mode blocks sync; ignored videos stay out of public lists", async () => {
  const db = fresh(); setSetting(db, "networkSyncDisabled", "1"); const r = await runSync({ db, apiKey: "K", mode: "full", fetchImpl: (async () => { throw new Error("must not be called"); }) as never });
  assert.equal(r.status, "failed"); assert.match(r.errors[0], /disabled/); assert.equal(r.apiRequests, 0);
});

// ---------- HTTP layer
const SECRET = "SECRET-KEY-DO-NOT-LEAK-9876";
function call(port: number, method: string, path: string, o: { host?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  return new Promise<{ status: number; text: string }>((ok, bad) => {
    const body = o.body === undefined ? undefined : typeof o.body === "string" || Buffer.isBuffer(o.body) ? o.body : JSON.stringify(o.body);
    const r = http.request({ host: "127.0.0.1", port, method, path, headers: { host: o.host ?? `localhost:${port}`, ...(body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}), ...o.headers } }, res => { const c: Buffer[] = []; res.on("data", d => c.push(d)); res.on("end", () => ok({ status: res.statusCode!, text: Buffer.concat(c).toString("utf8") })); });
    r.on("error", bad); if (body !== undefined) r.write(body); r.end(); });
}
async function withServer(fn: (port: number, db: any) => Promise<void>, fetchImpl?: typeof fetch) {
  const db = fresh(); const dir = mkdtempSync(join(tmpdir(), "mmap-srv-")); const srv = createServer({ db, apiKey: SECRET, dataDir: dir, fetchImpl }); await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  try { await fn((srv.address() as any).port, db); } finally { srv.close(); }
}
const H = { "x-mmap": "1" };
test("server guards: localhost only, POST needs header, cross-origin blocked", () => withServer(async port => {
  assert.equal((await call(port, "GET", "/api/muscles", { host: "evil.example.com" })).status, 403); // DNS-rebinding style
  assert.equal((await call(port, "POST", "/api/admin/ignore", { body: { videoId: 1 } })).status, 403);
  assert.equal((await call(port, "POST", "/api/admin/ignore", { headers: { ...H, origin: "http://evil.example" }, body: { videoId: 1 } })).status, 403);
  assert.equal((await call(port, "GET", "/api/map?view=posterior&selected=%3Cscript%3E")).status, 200);
  assert.equal((await call(port, "POST", "/api/admin/import-json", { headers: H, body: "{bad" })).status, 400);
  assert.equal((await call(port, "GET", "/nope")).status, 404);
}));
test("API key never appears in any response, page, script, export or error", () => withServer(async port => {
  await call(port, "POST", "/api/admin/import-url", { headers: H, body: { url: url(ID1), title: "Lats release" } });
  const gets = ["/", "/app.js", "/theme.js", "/api/meta", "/api/muscles", "/api/recent", "/api/map?view=anterior", "/api/admin/diagnostics", "/api/admin/review", "/api/admin/sync-runs", "/api/admin/export.json", "/api/admin/export.csv", "/api/muscles/latissimus-dorsi/videos", "/api/admin/backup"];
  for (const p of gets) { const r = await call(port, "GET", p); assert.equal(r.status, 200, p); assert.ok(!r.text.includes(SECRET), `key leaked in ${p}`); }
  const d = JSON.parse((await call(port, "GET", "/api/admin/diagnostics")).text); assert.equal(d.youtubeApiKeyConfigured, true); assert.ok(!JSON.stringify(d).includes("SECRET"));
  const meta = JSON.parse((await call(port, "GET", "/api/meta")).text); assert.equal(meta.version, JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).version); assert.ok(Number.isFinite(Date.parse(meta.builtAt)));
  const t = await call(port, "POST", "/api/admin/test-api", { headers: H, body: {} }); assert.ok(!t.text.includes(SECRET));
  const s = await call(port, "POST", "/api/admin/sync", { headers: H, body: { mode: "full" } }); assert.ok(!s.text.includes(SECRET));
}, (async () => new Response("{}", { status: 403 })) as never));
test("skipped flow over HTTP: assign, public library, ignore, restore, title filter setting", () => withServer(async port => {
  await call(port, "POST", "/api/admin/import-url", { headers: H, body: { url: url(ID1), title: "Lower back tension" } });
  let q = JSON.parse((await call(port, "GET", "/api/admin/review")).text); assert.deepEqual([q.queue.length, q.ignored.length], [0, 1]);
  const id = q.ignored[0].id; assert.equal((await call(port, "POST", "/api/admin/approve", { headers: H, body: { videoId: id, slugs: ["erector-spinae"] } })).status, 200);
  const m = JSON.parse((await call(port, "GET", "/api/muscles")).text).find((x: any) => x.slug === "erector-spinae"); assert.deepEqual([m.state, m.videoCount], ["approved", 1]);
  assert.match((await call(port, "GET", "/api/map?view=posterior")).text, /class="muscle approved[^"]*"[^>]*aria-label="Erectors \(group\)/);
  await call(port, "POST", "/api/admin/ignore", { headers: H, body: { videoId: id, reason: "off topic" } });
  assert.equal(JSON.parse((await call(port, "GET", "/api/muscles/erector-spinae/videos")).text).length, 0);
  await call(port, "POST", "/api/admin/restore-video", { headers: H, body: { videoId: id } }); q = JSON.parse((await call(port, "GET", "/api/admin/review")).text); assert.equal(q.queue.length, 1);
  const tf = await call(port, "POST", "/api/admin/settings", { headers: H, body: { titleFilter: "release, Stretch " } }); assert.deepEqual(JSON.parse(tf.text).titleFilter, ["release", "Stretch"]);
  assert.equal((await call(port, "POST", "/api/admin/settings", { headers: H, body: { titleFilter: " , x" } })).status, 400);
  assert.equal(JSON.parse((await call(port, "POST", "/api/admin/reclassify", { headers: H, body: {} })).text).mapped, 0);
  assert.equal((await call(port, "POST", "/api/admin/channel", { headers: H, body: { channelId: "nope" } })).status, 400);
  assert.equal((await call(port, "POST", "/api/admin/settings", { headers: H, body: { channelUrl: "https://evil.com/@x" } })).status, 400);
  const ok = await call(port, "POST", "/api/admin/settings", { headers: H, body: { channelUrl: "https://youtube.com/@EliteMassageBoulder/shorts" } }); assert.equal(JSON.parse(ok.text).channelHandle, "@EliteMassageBoulder");
}));

import { classifyUpload, isReleaseTitle } from "../src/lib/matching.ts";
import { CATALOG } from "../src/lib/catalog.ts";
test("title filter: release titles map automatically; everything else is skipped with a reason", () => {
  const k = (t: string, p: string[] | null = ["release"]) => classifyUpload(t, CATALOG, p);
  for (const [t, slug] of [["How to Release Your Hamstrings", "hamstring-group"], ["Quad Release in 60 Seconds", "quadriceps"], ["HOW TO RELEASE TIGHT HIP FLEXORS (Psoas)", "hip-flexors"], ["Release your calves #shorts", "gastrocnemius"], ["How to release the glutes", "gluteus-maximus"]] as const) {
    const c = k(t); assert.equal(c.kind, "map", t); assert.ok((c as any).matches.some((m: any) => m.slug === slug), `${t} -> ${slug}`); }
  assert.equal(k("Gym tour vlog").kind, "skip"); assert.match((k("My morning routine") as any).reason, /not a muscle-release/);
  assert.match((k("How to release tight shoulders") as any).reason, /No muscle in the catalog matched "shoulders"/);
  assert.equal(k("How to release your lats, quads and hamstrings").kind, "map"); // several muscles in one title are all mapped
  assert.match((k("How to release your lats, traps, quads, calves, glutes, hamstrings, abs") as any).reason, /Too many/); // full-body routines are skipped (cap: 6)
  assert.equal(isReleaseTitle("Releasing tension"), false); assert.equal(isReleaseTitle("Stretch your quads", ["stretch"]), true);
  assert.equal(k("Quads", null).kind, "map"); // links the user imports on purpose skip the release-word requirement
  assert.equal(k("Description-only: release", ["release"]).kind, "skip");
});
test("re-check skipped: picks up new aliases, never touches videos you ignored yourself", () => {
  const db = fresh(); const a = A.importVideo(db, { url: url(ID1), title: "How to release your iliocostalis" }) as any; const u = A.importVideo(db, { url: url(ID2), title: "Quad release" }) as any;
  A.ignoreVideo(db, u.videoId, "my choice"); assert.equal(A.ignoredVideos(db).length, 2);
  A.addAlias(db, "erector-spinae", "iliocostalis"); const r = A.reclassifySkipped(db); assert.deepEqual(r, { mapped: 1, stillSkipped: 0 });
  assert.equal(A.videosForMuscle(db, "erector-spinae").length, 1); assert.equal(A.ignoredVideos(db)[0].ignoredReason, "my choice"); void a;
});

test("deeper muscles are recognised, and specific names beat generic ones", () => {
  const k = (t: string) => classifyUpload(t, CATALOG, ["release"]); const slugs = (t: string) => ((k(t) as any).matches ?? []).map((m: any) => m.slug).sort();
  assert.deepEqual(slugs("How to Release Your Piriformis"), ["piriformis"]);
  assert.deepEqual(slugs("How to release your gluteus minimus"), ["gluteus-minimus"]); // not gluteus-maximus
  assert.deepEqual(slugs("How to release your psoas"), ["hip-flexors"]);
  assert.ok(slugs("Release your rotator cuff").includes("rotator-cuff")); assert.deepEqual(slugs("Release your infraspinatus"), ["infraspinatus"]);
  assert.deepEqual(slugs("How to release your pec minor"), ["pectoralis-minor"]); assert.deepEqual(slugs("How to release your scalenes"), ["scalenes"]);
  assert.deepEqual(slugs("Release your IT band"), ["tensor-fasciae-latae"]); assert.deepEqual(slugs("How to release your hands"), ["hand-muscles"]);
  assert.deepEqual(slugs("How to release your Achilles"), ["achilles-ankle"]); assert.deepEqual(slugs("Release the jaw"), ["masseter"]);
  assert.equal(k("How to release your liver").kind, "skip");
});
test("catalog upgrade adds new aliases but keeps user-added ones", () => {
  const db = fresh(); db.prepare("UPDATE muscles SET aliases='[\"mine\"]' WHERE slug='adductor-group'").run(); seedCatalog(db);
  const a = JSON.parse((db.prepare("SELECT aliases a FROM muscles WHERE slug='adductor-group'").get() as any).a); assert.ok(a.includes("mine") && a.includes("gracilis"));
});
import { upgradeIfCatalogChanged } from "../src/lib/admin.ts";
test("upgrade from an old build: legacy awaiting-review videos are re-checked once, old suggestions dropped", () => {
  const db = fresh(); const ins = db.prepare("INSERT INTO videos(youtube_video_id,canonical_url,title,processing_status,import_source,discovered_at) VALUES(?,?,?,'awaiting-review','youtube-sync','2026-01-01')");
  const a = Number(ins.run(ID1, url(ID1), "How to Release Your Piriformis Muscle").lastInsertRowid), b = Number(ins.run(ID2, url(ID2), "What is Fascia? Why it’s important").lastInsertRowid);
  const pec = (db.prepare("SELECT id FROM muscles WHERE slug='pectoralis-major'").get() as any).id;
  for (const v of [a, b]) db.prepare("INSERT INTO mappings(muscle_id,video_id,confidence,mapping_reason,mapping_source,review_status) VALUES(?,?,0.9,'chest (in description)','alias-rule','pending')").run(pec, v);
  const r = upgradeIfCatalogChanged(db); assert.deepEqual(r, { mapped: 1, stillSkipped: 1 });
  assert.equal(A.videosForMuscle(db, "piriformis").length, 1); assert.equal(A.videosForMuscle(db, "pectoralis-major").length, 0);
  assert.equal(n(db, "SELECT COUNT(*) n FROM mappings WHERE review_status='pending'"), 0); assert.equal(A.reviewQueue(db).length, 0); assert.match(A.ignoredVideos(db)[0].ignoredReason!, /^\[auto\]/);
  assert.equal(upgradeIfCatalogChanged(db), null); // only runs when the catalog changes
});

test("muscles from the MuscleMap label list are covered (names only; bones excluded)", () => {
  const k = (t: string) => classifyUpload(t, CATALOG, ["release"]); const slugs = (t: string) => ((k(t) as any).matches ?? []).map((m: any) => m.slug).sort();
  assert.deepEqual(slugs("How to release your sartorius"), ["sartorius"]); assert.deepEqual(slugs("Release the vastus intermedius"), ["vastus-intermedius"]);
  assert.deepEqual(slugs("How to release your flexor hallucis longus"), ["flexor-hallucis-longus"]); assert.deepEqual(slugs("Release your flexor digitorum longus"), ["flexor-digitorum-longus"]);
  assert.deepEqual(slugs("How to release your plantaris"), ["plantaris"]); assert.deepEqual(slugs("How to release your longus colli"), ["longus-colli"]);
  assert.deepEqual(slugs("Release your gemelli"), ["deep-hip-rotators"]); assert.deepEqual(slugs("Release your adductor brevis"), ["adductor-group"]);
  assert.deepEqual(slugs("Release the biceps femoris long head"), ["biceps-femoris"]); assert.deepEqual(slugs("Release your peroneus longus"), ["fibularis-group"]);
  assert.deepEqual(slugs("Release the medial gastrocnemius"), ["gastrocnemius"]); assert.equal(k("How to release your femur").kind, "skip"); // bones are not muscles
  const sart = renderBodyMap("anterior").match(/id="muscle-anterior-sartorius"[^>]*>.*?<\/g>/s)![0]; assert.match(sart, /rotate\(-12 /); assert.match(sart, /rotate\(12 /); // mirrored slant
});
import { renderBodyMap } from "../src/lib/bodymap.ts";

import { REGIONS, ART, DECORATIVE, warpEllipse, VIEWBOX } from "../src/lib/artmap.ts";
test("artwork: all 89 body-muscles regions are accounted for and mapped to real catalog muscles", () => {
  assert.equal(REGIONS.length, 89); assert.equal(REGIONS.filter(r => r.view === "front").length, 40); assert.equal(REGIONS.filter(r => r.view === "back").length, 49);
  assert.equal(new Set(REGIONS.map(r => r.id)).size, 89); assert.ok(REGIONS.every(r => /^[mM][ \d.,eE+\-a-zA-Z]+$/.test(r.path)), "path data looks like SVG path syntax");
  const ids = new Set(REGIONS.map(r => r.id)); const used = new Set<string>();
  for (const [slug, views] of Object.entries(ART)) { const m = CATALOG.find(c => c.slug === slug); assert.ok(m, `unknown catalog slug in ART: ${slug}`);
    for (const [view, rs] of Object.entries(views)) { assert.ok(m!.view === "both" || m!.view === view, `${slug} drawn on ${view} but catalog says ${m!.view}`);
      for (const id of rs!) { assert.ok(ids.has(id), `missing region ${id}`); assert.equal(REGIONS.find(r => r.id === id)!.view, view === "anterior" ? "front" : "back", `${id} is on the wrong side`); used.add(id); } } }
  assert.deepEqual([...ids].filter(i => !used.has(i)).sort(), [...DECORATIVE].sort()); // every region is either a muscle or deliberate outline
});
test("every catalog muscle appears on its view(s), once, with accessible attributes", () => {
  for (const view of ["anterior", "posterior"] as const) { const svg = renderBodyMap(view);
    for (const m of CATALOG) { const want = m.view === "both" || m.view === view; const n = (svg.match(new RegExp(`id="muscle-${view}-${m.slug}"`, "g")) ?? []).length; assert.equal(n, want ? 1 : 0, `${m.slug} on ${view}`); }
    assert.ok(svg.includes(`viewBox="${VIEWBOX[view]}"`)); assert.ok(!/<script|onerror|javascript:/i.test(svg)); }
});
test("fallback shapes are warped onto the figure and stay inside the viewBox", () => {
  for (const [view, [x, , w]] of [["anterior", [-1.25, 0, 34]], ["posterior", [35.5, 0, 34]]] as const) for (const [slug, shapes] of Object.entries(SHAPES)) for (const [v, cx, cy, rx, ry] of shapes) { if (v !== view) continue;
    for (const px of cx === 100 ? [100] : [cx, 200 - cx]) { const e = warpEllipse(view, px, cy, rx, ry); assert.ok(e.cx - e.rx >= x - 0.5 && e.cx + e.rx <= x + w + 0.5 && e.cy >= -1 && e.cy <= 94, `${slug} ${view} outside: ${JSON.stringify(e)}`); } }
});
import { SHAPES } from "../src/lib/bodymap.ts";

import { DESCRIPTIONS } from "../src/lib/descriptions.ts";
test("every catalog entry has a short, neutral description (no medical or outcome claims)", () => {
  assert.deepEqual(CATALOG.filter(m => !DESCRIPTIONS[m.slug]).map(m => m.slug), []); assert.deepEqual(Object.keys(DESCRIPTIONS).filter(k => !CATALOG.some(m => m.slug === k)), []);
  for (const [slug, d] of Object.entries(DESCRIPTIONS)) { assert.ok(d.length >= 25 && d.length <= 260, `${slug}: length ${d.length}`);
    assert.ok(!/\b(cure[sd]?|heal(s|ing)?|treat(s|ment|ing)?|relie(f|ve[sd]?)|diagnos\w*|guarantee\w*|permanent\w*|therap\w*|pain\w*|fix(es)?)\b/i.test(d), `${slug}: contains a claim word`); }
});
test("descriptions are stored in the database and returned by the muscle list", () => {
  const db = fresh(); const m = A.listMuscles(db).find(x => x.slug === "piriformis")!; assert.equal(m.description, DESCRIPTIONS["piriformis"]);
  db.prepare("UPDATE muscles SET description='' WHERE slug='piriformis'").run(); seedCatalog(db); assert.equal(A.listMuscles(db).find(x => x.slug === "piriformis")!.description, DESCRIPTIONS["piriformis"]); // re-seeding refreshes it
});

test("undo: remove one muscle, last removal returns the video to Skipped, and it can be assigned again", () => {
  const db = fresh(); const r = A.importVideo(db, { url: url(ID1), title: "Glutes and hamstrings release" }) as any; const id = r.videoId;
  assert.deepEqual([A.videosForMuscle(db, "gluteus-maximus").length, A.videosForMuscle(db, "hamstring-group").length], [1, 1]);
  assert.equal(A.unassignMuscle(db, id, "hamstring-group").remaining, 1); assert.equal(A.videosForMuscle(db, "hamstring-group").length, 0); assert.equal(A.videosForMuscle(db, "gluteus-maximus").length, 1);
  assert.throws(() => A.unassignMuscle(db, id, "hamstring-group"), /not assigned/); assert.throws(() => A.unassignMuscle(db, id, "nope"), /Unknown muscle/);
  assert.equal(n(db, "SELECT COUNT(*) n FROM mappings WHERE review_status='rejected'"), 1); // kept as rejected so syncs don't re-add it
  assert.equal(A.unassignMuscle(db, id, "gluteus-maximus").remaining, 0);
  const sk = A.ignoredVideos(db); assert.equal(sk.length, 1); assert.match(sk[0].ignoredReason!, /^Unassigned by you/); assert.deepEqual(A.reclassifySkipped(db), { mapped: 0, stillSkipped: 0 }); // not an [auto] skip, so rule changes leave it alone
  A.approveVideo(db, id, ["gluteus-maximus"]); assert.equal(A.videosForMuscle(db, "gluteus-maximus").length, 1); assert.equal(A.ignoredVideos(db).length, 0);
});
test("ignore forever: leaves Skipped, is never re-checked, and un-ignore returns it to the automatic flow", () => {
  const db = fresh(); const a = A.importVideo(db, { url: url(ID1), title: "How to release your iliocostalis" }) as any; const b = A.importVideo(db, { url: url(ID2), title: "Gym tour vlog" }) as any;
  assert.equal(A.ignoredVideos(db).length, 2); A.ignoreForever(db, a.videoId, "waiting for a catalog entry"); A.ignoreForever(db, b.videoId);
  assert.deepEqual([A.ignoredVideos(db).length, A.foreverVideos(db).length], [0, 2]); assert.equal(A.foreverVideos(db).find((v: any) => v.id === a.videoId)!.ignoredReason, "[forever] waiting for a catalog entry");
  A.addAlias(db, "erector-spinae", "iliocostalis"); assert.deepEqual(A.reclassifySkipped(db), { mapped: 0, stillSkipped: 0 }); assert.equal(A.videosForMuscle(db, "erector-spinae").length, 0); // forever means forever
  setSetting(db, "catalogFingerprint", "stale"); assert.deepEqual(A.upgradeIfCatalogChanged(db), { mapped: 0, stillSkipped: 0 }); assert.equal(A.foreverVideos(db).length, 2); // a catalog upgrade leaves them alone too
  assert.equal(A.resetToAutomatic(db, a.videoId), "map"); assert.equal(A.videosForMuscle(db, "erector-spinae").length, 1); // un-ignore re-evaluates with today's rules
  assert.equal(A.resetToAutomatic(db, b.videoId), "skip"); assert.deepEqual([A.foreverVideos(db).length, A.ignoredVideos(db).length], [0, 1]); assert.match(A.ignoredVideos(db)[0].ignoredReason!, /^\[auto\]/);
  assert.equal(A.ignoreVideo(db, b.videoId, "[forever] sneaky"), undefined); assert.equal(A.foreverVideos(db).length, 0); // the plain ignore cannot fake the forever marker
});
test("reset to automatic discards manual choices but keeps your notes", () => {
  const db = fresh(); const r = A.importVideo(db, { url: url(ID1), title: "Quad release", slugs: ["deltoid"], notes: "keep me" }) as any;
  assert.equal(A.videosForMuscle(db, "deltoid").length, 1); assert.equal(A.resetToAutomatic(db, r.videoId), "map");
  assert.deepEqual([A.videosForMuscle(db, "deltoid").length, A.videosForMuscle(db, "quadriceps").length], [0, 1]); assert.equal(A.videosForMuscle(db, "quadriceps")[0].notes, "keep me");
  assert.throws(() => A.resetToAutomatic(db, 9999), /not found/);
});
test("aliases you add can be removed; built-in ones cannot", () => {
  const db = fresh(); A.addAlias(db, "soleus", "Deep Calf"); const m = () => A.listMuscles(db).find(x => x.slug === "soleus")!;
  assert.deepEqual(m().userAliases, ["Deep Calf"]); assert.ok(m().aliases.includes("calf") && !m().userAliases.includes("calf"));
  assert.throws(() => A.removeAlias(db, "soleus", "calf"), /Built-in/); assert.throws(() => A.removeAlias(db, "soleus", "never added"), /not found/);
  assert.deepEqual(A.removeAlias(db, "soleus", "deep calf").includes("Deep Calf"), false); assert.deepEqual(m().userAliases, []); seedCatalog(db); assert.deepEqual(m().userAliases, []); // stays removed after re-seeding
});
test("undo routes over HTTP", () => withServer(async port => {
  await call(port, "POST", "/api/admin/import-url", { headers: H, body: { url: url(ID1), title: "Calf release" } }); const q = () => call(port, "GET", "/api/admin/review").then(r => JSON.parse(r.text));
  const id = (await call(port, "GET", "/api/muscles/gastrocnemius/videos").then(r => JSON.parse(r.text)))[0].id;
  assert.equal((await call(port, "POST", "/api/admin/unassign", { headers: H, body: { videoId: id, slug: "deltoid" } })).status, 400);
  assert.equal(JSON.parse((await call(port, "POST", "/api/admin/unassign", { headers: H, body: { videoId: id, slug: "gastrocnemius" } })).text).remaining, 1); // calf maps to gastrocnemius + soleus
  assert.equal((await call(port, "POST", "/api/admin/ignore-forever", { headers: H, body: { videoId: id, note: "x" } })).status, 200);
  let r = await q(); assert.deepEqual([r.ignored.length, r.forever.length], [0, 1]);
  assert.equal(JSON.parse((await call(port, "POST", "/api/admin/reset-video", { headers: H, body: { videoId: id } })).text).result, "map"); r = await q(); assert.deepEqual([r.ignored.length, r.forever.length], [0, 0]);
  assert.equal((await call(port, "POST", "/api/admin/reset-video", { headers: H, body: { videoId: 99999 } })).status, 404);
  assert.equal((await call(port, "POST", "/api/admin/alias/remove", { headers: H, body: { slug: "soleus", alias: "calf" } })).status, 400);
  await call(port, "POST", "/api/admin/alias", { headers: H, body: { slug: "soleus", alias: "my alias" } }); assert.equal((await call(port, "POST", "/api/admin/alias/remove", { headers: H, body: { slug: "soleus", alias: "my alias" } })).status, 200);
}));
