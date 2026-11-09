import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, seedCatalog, setSetting, getSetting } from "../src/lib/db.ts";
import { runSync, parseDuration } from "../src/lib/sync.ts";
import { ignoreForever } from "../src/lib/admin.ts";
import { CATALOG } from "../src/lib/catalog.ts";
import { renderBodyMap, SHAPES, elementId, FRAME_SLUGS } from "../src/lib/bodymap.ts";
import { ART } from "../src/lib/artmap.ts";
import { matchVideo } from "../src/lib/matching.ts";

const sleep = async () => {};
const vid = (id: string, title: string, over: any = {}) => ({ id, snippet: { title, description: "", publishedAt: "2026-01-01T00:00:00Z", channelId: "UCx", channelTitle: "Elite Massage and Injury Rehab", thumbnails: { high: { url: "https://i.ytimg.com/x.jpg" } } }, contentDetails: { duration: "PT45S" }, ...over });
const ID = (n: number) => `vid${String(n).padStart(8, "0")}`;
function fakeYT(videos: any[], opts: { quotaAfter?: number; pageSize?: number } = {}) {
  const calls: string[] = []; const size = opts.pageSize ?? 50;
  const impl = (async (input: URL) => {
    const u = new URL(String(input)); calls.push(u.pathname.split("/").pop()!);
    if (opts.quotaAfter !== undefined && calls.length > opts.quotaAfter) return new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 });
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname.endsWith("/channels")) return ok({ items: [{ id: "UC" + "a".repeat(22), snippet: { title: "Elite Massage and Injury Rehab" }, contentDetails: { relatedPlaylists: { uploads: "UUup" } } }] });
    if (u.pathname.endsWith("/playlistItems")) { const start = Number(u.searchParams.get("pageToken") ?? 0); const page = videos.slice(start, start + size);
      return ok({ items: page.map(v => ({ contentDetails: { videoId: v.id } })), ...(start + size < videos.length ? { nextPageToken: String(start + size) } : {}) }); }
    if (u.pathname.endsWith("/videos")) { const ids = u.searchParams.get("id")!.split(","); return ok({ items: videos.filter(v => ids.includes(v.id) && !v.hidden) }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const fresh = () => { const db = openDb(); seedCatalog(db); return db; };
const count = (db: any, sql: string) => (db.prepare(sql).get() as any).n as number;

test("ISO-8601 duration parsing", () => { assert.equal(parseDuration("PT1M5S"), 65); assert.equal(parseDuration("PT1H"), 3600); assert.equal(parseDuration("garbage"), null); });

test("no API key: fails clearly, records a failed run, fabricates nothing", async () => {
  const db = fresh(); const rep = await runSync({ db, mode: "full", sleep });
  assert.equal(rep.status, "failed"); assert.match(rep.errors[0], /YOUTUBE_API_KEY/);
  assert.equal(count(db, "SELECT COUNT(*) n FROM videos"), 0); assert.equal(count(db, "SELECT COUNT(*) n FROM sync_runs WHERE status='failed'"), 1);
});
test("full sync: resolves channel once, auto-maps release titles, skips the rest", async () => {
  const db = fresh(); const yt = fakeYT([vid(ID(1), "How to release your upper traps"), vid(ID(2), "How to release your lower back"), vid(ID(3), "How to release your quads and calves", { contentDetails: { duration: "PT4M" } }), vid(ID(4), "Gym tour vlog")]);
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: yt.impl, mode: "full", sleep });
  assert.equal(rep.status, "successful"); assert.deepEqual([rep.added, rep.autoMapped, rep.ignored, rep.awaitingReview], [4, 2, 2, 0]);
  assert.equal(getSetting(db, "uploadsPlaylistId"), "UUup");
  assert.equal(count(db, "SELECT COUNT(*) n FROM videos WHERE is_short_candidate=1"), 3);
  assert.equal(count(db, "SELECT COUNT(*) n FROM mappings WHERE review_status='approved'"), 4);
  const again = await runSync({ db, apiKey: "KEY", fetchImpl: yt.impl, mode: "full", sleep });
  assert.deepEqual([again.added, again.skipped], [0, 4]); assert.equal(yt.calls.filter(c => c === "channels").length, 1); // handle not re-resolved
});
test("dry run writes nothing", async () => {
  const db = fresh(); const rep = await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT([vid(ID(1), "Lats release")]).impl, mode: "full", dryRun: true, sleep });
  assert.equal(rep.added, 1); assert.equal(count(db, "SELECT COUNT(*) n FROM videos"), 0); assert.equal(count(db, "SELECT COUNT(*) n FROM sync_runs"), 0); assert.equal(getSetting(db, "channelId"), undefined);
});
test("incremental stops once caught up; full pages everything", async () => {
  const vs = Array.from({ length: 6 }, (_, i) => vid(ID(i), `Lats release ${i}`)); const db = fresh();
  await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs, { pageSize: 2 }).impl, mode: "full", sleep });
  const yt = fakeYT(vs, { pageSize: 2 }); const inc = await runSync({ db, apiKey: "KEY", fetchImpl: yt.impl, mode: "incremental", sleep });
  assert.equal(inc.scanned, 2); assert.equal(yt.calls.filter(c => c === "playlistItems").length, 1);
});
test("ignored videos and manual decisions survive later syncs", async () => {
  const db = fresh(); const vs = [vid(ID(1), "Hamstrings release")];
  await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs).impl, mode: "full", sleep });
  db.prepare("UPDATE videos SET processing_status='ignored', ignored_reason='generic', notes='mine'").run();
  db.prepare("UPDATE mappings SET review_status='rejected', mapping_source='manual'").run();
  vs[0] = vid(ID(1), "Hamstrings release (new title)", { contentDetails: { duration: "PT50S" } });
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs).impl, mode: "full", sleep });
  assert.equal(rep.updated, 1);
  const v = db.prepare("SELECT title,processing_status,ignored_reason,notes FROM videos").get() as any;
  assert.deepEqual([v.title, v.processing_status, v.ignored_reason, v.notes], ["Hamstrings release (new title)", "ignored", "generic", "mine"]);
  assert.equal(count(db, "SELECT COUNT(*) n FROM mappings WHERE review_status='rejected'"), 1); assert.equal(count(db, "SELECT COUNT(*) n FROM mappings"), 1);
});
test("deleted/private videos are flagged unavailable, not removed", async () => {
  const db = fresh(); const vs = [vid(ID(1), "Lats release")]; await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs).impl, mode: "full", sleep });
  vs[0].hidden = true; await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs).impl, mode: "full", sleep });
  assert.equal(count(db, "SELECT COUNT(*) n FROM videos WHERE availability_status='unavailable'"), 1);
});
test("quota error mid-sync keeps progress and reports partial success", async () => {
  const vs = Array.from({ length: 4 }, (_, i) => vid(ID(i), `Lats ${i}`)); const db = fresh();
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs, { pageSize: 2, quotaAfter: 3 }).impl, mode: "full", sleep });
  assert.equal(rep.status, "partially-successful"); assert.match(rep.errors[0], /quota/); assert.equal(count(db, "SELECT COUNT(*) n FROM videos"), 2);
});
test("transient 503 is retried a limited number of times", async () => {
  const db = fresh(); let n = 0; const inner = fakeYT([vid(ID(1), "Lats")]).impl;
  const flaky = (async (u: URL) => String(u).includes("playlistItems") && n++ < 2 ? new Response("{}", { status: 503 }) : inner(u)) as unknown as typeof fetch;
  assert.equal((await runSync({ db, apiKey: "KEY", fetchImpl: flaky, mode: "full", sleep })).status, "successful");
  const dead = (async (u: URL) => String(u).includes("playlistItems") ? new Response("{}", { status: 503 }) : inner(u)) as unknown as typeof fetch;
  assert.equal((await runSync({ db: fresh(), apiKey: "KEY", fetchImpl: dead, mode: "full", sleep })).status, "failed");
});
test("overlapping real syncs are blocked by the lock", async () => {
  const db = fresh(); db.prepare("INSERT INTO sync_runs(sync_type,status,started_at) VALUES('full','running',?)").run(new Date().toISOString());
  await assert.rejects(runSync({ db, apiKey: "KEY", fetchImpl: fakeYT([]).impl, mode: "full", sleep }), /already running/);
});

test("catalog + SVG map are consistent", () => {
  assert.equal(new Set(CATALOG.map(m => m.slug)).size, CATALOG.length);
  for (const m of CATALOG) { if (FRAME_SLUGS.has(m.slug)) continue; /* drawn as the map frame, not a body shape */ const shapes = SHAPES[m.slug]; assert.ok(shapes?.length, `${m.slug} has no shape`);
    for (const view of m.view === "both" ? ["anterior", "posterior"] : [m.view]) assert.ok(shapes.some(s => s[0] === view) || ART[m.slug]?.[view as "anterior" | "posterior"], `${m.slug} missing ${view}`); }
  for (const slug of Object.keys(SHAPES)) assert.ok(CATALOG.some(m => m.slug === slug), `orphan shape ${slug}`);
  for (const view of ["anterior", "posterior"] as const) {
    const svg = renderBodyMap(view, { quadriceps: "approved", gastrocnemius: "pending" }, "quadriceps"); const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map(x => x[1]);
    assert.equal(new Set(ids).size, ids.length); assert.ok(svg.includes(`id="${elementId(view, "latissimus-dorsi")}"`) === (view === "posterior"));
    assert.ok([...svg.matchAll(/<g id="muscle[^>]*>/g)].every(g => /role="button"/.test(g[0]) && /tabindex="0"/.test(g[0]) && /aria-label="[^"]+"/.test(g[0])));
  }
  assert.match(renderBodyMap("anterior", { quadriceps: "approved" }), /class="muscle approved"[^>]*aria-label="Quads \(group\), Quadriceps femoris: has approved videos"/);
});
test("seed is idempotent and keeps user aliases", () => {
  const db = fresh(); db.prepare("UPDATE muscles SET aliases='[\"my alias\"]' WHERE slug='soleus'").run(); seedCatalog(db);
  assert.equal(count(db, "SELECT COUNT(*) n FROM muscles"), CATALOG.length); assert.match((db.prepare("SELECT aliases a FROM muscles WHERE slug='soleus'").get() as any).a, /my alias/);
});
test("catalog matching: specific beats generic sub-phrase", () => {
  const defs = CATALOG;
  assert.deepEqual(matchVideo("Upper traps release", "", defs).autoApprove.map(m => m.slug), ["upper-trapezius"]);
  assert.deepEqual(matchVideo("Traps release", "", defs).autoApprove.map(m => m.slug), ["trapezius-group"]);
  assert.deepEqual(matchVideo("Quad release", "", defs).autoApprove.map(m => m.slug), ["quadriceps"]);
});

test("ignored-forever videos stay ignored forever across syncs, even when their title changes", async () => {
  const db = fresh(); const vs = [vid(ID(1), "How to release your traps")]; await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs).impl, mode: "full", sleep });
  const id = (db.prepare("SELECT id FROM videos").get() as any).id; ignoreForever(db, id, "not for me"); vs[0] = vid(ID(1), "How to release your lats (new title)");
  const rep = await runSync({ db, apiKey: "KEY", fetchImpl: fakeYT(vs).impl, mode: "full", sleep }); assert.equal(rep.updated, 1);
  const v = db.prepare("SELECT title, processing_status s, ignored_reason r FROM videos").get() as any; assert.deepEqual([v.title, v.s, v.r], ["How to release your lats (new title)", "ignored", "[forever] not for me"]);
  assert.equal(count(db, "SELECT COUNT(*) n FROM videos WHERE processing_status IN ('approved','automatically-mapped')"), 0); // and it is not on the map
});
