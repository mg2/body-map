import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeVideoUrl as p, parseChannelRef } from "../src/lib/youtube/url.ts";
import { matchVideo, type MuscleDef } from "../src/lib/matching.ts";
import { resolveChannelByHandle, YouTubeApiError, maskKey } from "../src/lib/youtube/api.ts";

const ID = "dQw4w9WgXcQ";
test("all URL forms canonicalize to one record", () => {
  for (const u of [`https://youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}&t=5`, `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=x`, `https://youtube.com/shorts/${ID}`, `https://youtube.com/embed/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`])
    assert.equal(p(u)?.canonicalUrl, `https://www.youtube.com/watch?v=${ID}`, u);
  assert.equal(p(`https://youtube.com/shorts/${ID}`)?.isShortUrl, true);
});
test("rejects impostors and malformed IDs", () => {
  for (const u of [`https://youtube.com.evil.com/watch?v=${ID}`, `https://evil.com/youtube.com/watch?v=${ID}`, `https://youtu.be.evil.io/${ID}`,
    `https://user@youtube.com/watch?v=${ID}`, `javascript:alert(1)`, `https://youtube.com/watch?v=short`, `https://notyoutube.com/watch?v=${ID}`, "garbage"])
    assert.equal(p(u), null, u);
});
test("channel refs", () => {
  assert.deepEqual(parseChannelRef("https://www.youtube.com/@EliteMassageBoulder"), { kind: "handle", value: "@EliteMassageBoulder" });
  assert.deepEqual(parseChannelRef("https://youtube.com/@EliteMassageBoulder/shorts"), { kind: "handle", value: "@EliteMassageBoulder" });
  assert.equal(parseChannelRef("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")?.kind, "id");
  assert.equal(parseChannelRef("https://www.youtube.com/c/custom-name")?.kind, "custom");
  assert.equal(parseChannelRef("https://evil.com/@EliteMassageBoulder"), null);
});

const cat: MuscleDef[] = [
  { slug: "upper-trapezius", commonName: "Upper traps", anatomicalName: "Trapezius, descending part", aliases: ["upper trap", "upper trapezius", "trap"] },
  { slug: "latissimus-dorsi", commonName: "Lats", anatomicalName: "Latissimus dorsi", aliases: ["lat", "latissimus"] },
  { slug: "gastrocnemius", commonName: "Calf", anatomicalName: "Gastrocnemius", aliases: ["calves"] },
  { slug: "quadriceps", commonName: "Quads", anatomicalName: "Quadriceps femoris", aliases: ["quad", "quadriceps"] },
];
test("alias, plural and hashtag matching auto-approve", () => {
  assert.deepEqual(matchVideo("Release your upper traps fast", "", cat).autoApprove.map(m => m.slug), ["upper-trapezius"]);
  assert.deepEqual(matchVideo("Tight calves?", "", cat).autoApprove.map(m => m.slug), ["gastrocnemius"]);
  const h = matchVideo("Quick release", "#Quads", cat);
  assert.equal(h.autoApprove.length, 0); // description only -> review
  assert.equal(h.needsReview, true);
  assert.equal(matchVideo("Release #quads now", "", cat).autoApprove[0]?.slug, "quadriceps");
});
test("short aliases never match inside words", () => {
  for (const t of ["Plate lifting form", "Latent tension", "Chocolate break", "Related video"])
    assert.equal(matchVideo(t, "", cat).matches.length, 0, t);
});
test("generic region only goes to review", () => {
  const r = matchVideo("Fix your lower back pain", "", cat);
  assert.equal(r.autoApprove.length, 0); assert.equal(r.needsReview, true);
});
test("multiple clear muscles map; too many go to review", () => {
  assert.equal(matchVideo("Lats and upper traps release", "", cat).autoApprove.length, 2);
  assert.equal(matchVideo("Lats, traps, calves, quads", "", cat).needsReview, true);
});

const mk = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as never;
const ok = { items: [{ id: "UC" + "a".repeat(22), snippet: { title: "Elite Massage and Injury Rehab", description: "d" }, contentDetails: { relatedPlaylists: { uploads: "UU" + "a".repeat(22) } } }] };
const run = (f: typeof fetch, apiKey: string | undefined = "KEY1234") => resolveChannelByHandle({ apiKey, handle: "@EliteMassageBoulder", expectedTitle: "Elite Massage and Injury Rehab", fetchImpl: f });
const code = async (pr: Promise<unknown>) => pr.then(() => "ok", (e) => (e as YouTubeApiError).code);
test("channel resolution (mocked, no real quota)", async () => {
  assert.equal((await run(mk(200, ok))).uploadsPlaylistId, "UU" + "a".repeat(22));
  assert.equal(await code(run(mk(200, ok), "")), "no-key");
  assert.equal(await code(run(mk(200, { items: [] }))), "not-found");
  assert.equal(await code(run(mk(200, { items: [ok.items[0], ok.items[0]] }))), "ambiguous");
  assert.equal(await code(run(mk(200, { items: [{ ...ok.items[0], snippet: { title: "Someone Else" } }] }))), "mismatch");
  assert.equal(await code(run(mk(403, { error: { errors: [{ reason: "quotaExceeded" }] } }))), "quota");
  assert.equal(await code(run(mk(400, { error: { errors: [{ reason: "keyInvalid" }] } }))), "invalid-key");
  assert.equal(await code(run(mk(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }))), "api-disabled");
  assert.equal(await code(run((async () => { throw new Error("x"); }) as never)), "network");
});
test("key never leaks in errors or mask", async () => {
  const e = await run(mk(403, { error: {} })).catch((x) => x as Error);
  assert.ok(!String((e as Error).message).includes("KEY1234"));
  assert.equal(maskKey("SECRETKEY1234"), "…1234");
});
