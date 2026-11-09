import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChannelInput, fetchChannelTitles, formatTitles } from "../channel-titles.mjs";

const UC = "UC" + "k".repeat(22), sleep = async () => {};
const item = (id: string, title: string, d = "2026-01-02T03:04:05Z") => ({ snippet: { title, publishedAt: "2030-01-01T00:00:00Z", resourceId: { videoId: id } }, contentDetails: { videoPublishedAt: d } });
function fakeYT(pages: any[][], opts: { channels?: any; status?: number; reason?: string } = {}) {
  const calls: URL[] = []; const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  const impl = (async (input: URL) => { const u = new URL(String(input)); calls.push(u); const path = u.pathname.split("/").pop();
    if (opts.status) return new Response(JSON.stringify({ error: { errors: [{ reason: opts.reason ?? "" }] } }), { status: opts.status });
    if (path === "channels") return ok(opts.channels ?? { items: [{ id: UC, snippet: { title: "Yoga With Kassandra" }, contentDetails: { relatedPlaylists: { uploads: "UUk" } } }] });
    const i = Number(u.searchParams.get("pageToken") ?? 0); return ok({ items: pages[i], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) }); }) as unknown as typeof fetch;
  return { impl, calls };
}
const run = (api: ReturnType<typeof fakeYT>, extra: any = {}) => fetchChannelTitles({ apiKey: "SECRETKEY", channel: "@yogawithkassandra", fetchImpl: api.impl, sleep, ...extra });

test("channel input forms: handle, bare handle, URLs, channel id; everything else is rejected", () => {
  const h = { kind: "handle", value: "@yogawithkassandra" };
  for (const x of ["@yogawithkassandra", "yogawithkassandra", "https://youtube.com/@yogawithkassandra", "https://www.youtube.com/@yogawithkassandra/videos", "youtube.com/@yogawithkassandra/shorts", "https://m.youtube.com/@yogawithkassandra?si=abc"]) assert.deepEqual(parseChannelInput(x), h, x);
  assert.deepEqual(parseChannelInput(`https://www.youtube.com/channel/${UC}`), { kind: "id", value: UC }); assert.deepEqual(parseChannelInput(UC), { kind: "id", value: UC });
  for (const x of ["https://evil.com/@yogawithkassandra", "https://youtube.com.evil.io/@yogawithkassandra", "https://www.youtube.com/c/customname", "https://www.youtube.com/user/old", "", "a b", "@x", null]) assert.equal(parseChannelInput(x as any), null, String(x));
});
test("downloads every title across pages: newest first, de-duplicated, placeholders and blanks skipped, whitespace tidied", async () => {
  const api = fakeYT([[item("a1", "First  video\n(with   spaces)"), item("a2", "Private video"), item("a3", "Second"), item("a1", "Duplicate of first")], [item("b1", "Deleted video"), item("b2", "Third", "2025-12-31T00:00:00Z"), item("b3", "   ")]]);
  const r = await run(api); assert.deepEqual(r.videos.map(v => v.title), ["First video (with spaces)", "Second", "Third"]); assert.deepEqual(r.videos.map(v => v.date), ["2026-01-02", "2026-01-02", "2025-12-31"]); // real publish date, not the playlist-add date
  assert.deepEqual([r.skipped, r.requests, r.channel.title, r.channel.id], [3, 3, "Yoga With Kassandra", UC]);
  assert.equal(api.calls[0].searchParams.get("forHandle"), "@yogawithkassandra"); assert.ok(api.calls.slice(1).every(u => u.searchParams.get("playlistId") === "UUk" && u.searchParams.get("maxResults") === "50")); assert.ok(api.calls.every(u => u.searchParams.get("key") === "SECRETKEY"));
  assert.ok(api.calls.every(u => !u.pathname.endsWith("/search")), "never uses the expensive search endpoint");
});
test("a channel id is looked up with id=, not forHandle", async () => {
  const api = fakeYT([[item("a1", "T")]]); await fetchChannelTitles({ apiKey: "K", channel: `https://www.youtube.com/channel/${UC}`, fetchImpl: api.impl, sleep }); assert.equal(api.calls[0].searchParams.get("id"), UC); assert.equal(api.calls[0].searchParams.get("forHandle"), null);
});
test("output formats: plain titles (default) or 'date | title'", () => {
  const v = [{ id: "a", title: "One", date: "2026-01-02" }, { id: "b", title: "Two", date: "" }]; assert.equal(formatTitles(v), "One\nTwo\n"); assert.equal(formatTitles(v, { details: true }), "2026-01-02 | One\n????-??-?? | Two\n");
});
test("clear errors, and the key never leaks into them", async () => {
  const err = async (p: Promise<unknown>) => p.then(() => "no error", (e: Error) => e.message);
  assert.match(await err(fetchChannelTitles({ channel: "@yogawithkassandra", fetchImpl: fakeYT([]).impl, sleep })), /YOUTUBE_API_KEY is not set.*\.env\.local/);
  assert.match(await err(run(fakeYT([], { channels: { items: [] } }))), /No channel found for @yogawithkassandra/); assert.match(await err(run(fakeYT([], { channels: { items: [{ id: "1" }, { id: "2" }] } }))), /More than one channel/);
  assert.match(await err(run(fakeYT([], { channels: { items: [{ id: UC, snippet: { title: "x" } }] } }))), /no uploads playlist/); assert.match(await err(run(fakeYT([[]], {}), { channel: "https://evil.com/@x" })), /Unrecognised channel/);
  for (const [status, reason, re] of [[403, "quotaExceeded", /quota exceeded/i], [400, "keyInvalid", /rejected as invalid/], [403, "accessNotConfigured", /not enabled/], [403, "", /restricted the key/], [404, "", /HTTP 404/]] as const) { const m = await err(run(fakeYT([], { status, reason }))); assert.match(m, re); assert.ok(!m.includes("SECRETKEY")); }
});
test("transient failures are retried a limited number of times, then reported", async () => {
  let n = 0; const good = fakeYT([[item("a1", "Only")]]); const flaky = (async (u: URL) => (n++ < 2 ? new Response("{}", { status: 503 }) : good.impl(u))) as unknown as typeof fetch;
  assert.equal((await run(good, { fetchImpl: flaky })).videos.length, 1); let calls = 0; const dead = (async () => { calls++; return new Response("{}", { status: 503 }); }) as unknown as typeof fetch;
  await assert.rejects(run(good, { fetchImpl: dead }), /HTTP 503/); assert.equal(calls, 4); // 1 try + 3 retries, never infinite
  let net = 0; await assert.rejects(run(good, { fetchImpl: (async () => { net++; throw new Error("offline"); }) as unknown as typeof fetch }), /Could not reach the YouTube API/); assert.equal(net, 4);
});
// ---- the real command-line tool against a fake local YouTube server
function cli(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; out: string; err: string }>(ok => { const p = spawn(process.execPath, ["channel-titles.mjs", ...args], { env: { PATH: process.env.PATH ?? "", ...env } }); let out = "", err = ""; p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (err += d)); p.on("close", code => ok({ code, out, err })); });
}
test("CLI: writes the txt file, prints a summary, never prints the key; usage and key errors have exit codes", async () => {
  const srv = http.createServer((req, res) => { const u = new URL(req.url!, "http://x"); res.setHeader("content-type", "application/json"); const path = u.pathname.split("/").pop();
    if (path === "channels") return void res.end(JSON.stringify({ items: [{ id: UC, snippet: { title: "Yoga With Kassandra" }, contentDetails: { relatedPlaylists: { uploads: "UUk" } } }] }));
    const first = !u.searchParams.get("pageToken"); res.end(JSON.stringify({ items: first ? [item("a1", "Neck & Shoulder Stretch"), item("a2", "Private video")] : [item("b1", "Hips & Glutes")], ...(first ? { nextPageToken: "2" } : {}) })); });
  await new Promise<void>(r => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${(srv.address() as any).port}/youtube/v3`; const dir = mkdtempSync(join(tmpdir(), "titles-")); const out = join(dir, "t.txt");
  try {
    const r = await cli(["https://youtube.com/@yogawithkassandra", "--out", out], { YOUTUBE_API_KEY: "TOPSECRET123", YT_API_BASE_URL: base }); assert.equal(r.code, 0, r.err);
    assert.equal(readFileSync(out, "utf8"), "Neck & Shoulder Stretch\nHips & Glutes\n"); assert.match(r.out, /Saved 2 titles to .*t\.txt/); assert.match(r.out, /Skipped 1 private\/deleted/); assert.match(r.out, /Yoga With Kassandra/); assert.ok(!(r.out + r.err).includes("TOPSECRET123"));
    const d = await cli(["@yogawithkassandra", "--details", "--out", out], { YOUTUBE_API_KEY: "TOPSECRET123", YT_API_BASE_URL: base }); assert.equal(d.code, 0); assert.match(readFileSync(out, "utf8"), /^2026-01-02 \| Neck & Shoulder Stretch\n2026-01-02 \| Hips & Glutes\n$/);
    const nokey = await cli(["@yogawithkassandra"], { YT_API_BASE_URL: base }); assert.equal(nokey.code, 1); assert.match(nokey.err, /YOUTUBE_API_KEY is not set/); const usage = await cli([], {}); assert.equal(usage.code, 2); assert.match(usage.err, /Usage:/);
    const bad = await cli(["https://evil.com/@x"], { YOUTUBE_API_KEY: "K", YT_API_BASE_URL: base }); assert.equal(bad.code, 1); assert.match(bad.err, /Unrecognised channel/);
  } finally { srv.close(); }
});
