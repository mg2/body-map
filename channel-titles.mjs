#!/usr/bin/env node
// Download every upload title of a YouTube channel into a .txt file, using the OFFICIAL YouTube Data API v3 (no page scraping).
//
//   npm run titles -- https://youtube.com/@yogawithkassandra
//   node --env-file=.env.local channel-titles.mjs @yogawithkassandra --out titles.txt
//
// Options:  --details   write "YYYY-MM-DD | title" instead of just the title
//           --out FILE  output file (default: <channel>-titles.txt in the current folder)
// Needs YOUTUBE_API_KEY (put it in .env.local; it is never printed or written anywhere). Cost: about 1 quota unit per 50 videos.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_API = "https://www.googleapis.com/youtube/v3";
const PLACEHOLDER_TITLES = new Set(["Private video", "Deleted video"]); // what the API returns for videos you can't see

/** Accepts @handle, a bare handle, youtube.com/@handle[/videos|/shorts|...], or youtube.com/channel/UC... */
export function parseChannelInput(input) {
  const s = String(input ?? "").trim();
  if (/^@?[A-Za-z0-9._-]{3,30}$/.test(s) && !/^UC[\w-]{22}$/.test(s)) return { kind: "handle", value: s.startsWith("@") ? s : `@${s}` };
  if (/^UC[\w-]{22}$/.test(s)) return { kind: "id", value: s };
  let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname.toLowerCase())) return null;
  const p = u.pathname.split("/").filter(Boolean);
  if (p[0]?.startsWith("@")) { const h = decodeURIComponent(p[0]); return /^@[A-Za-z0-9._-]{3,30}$/.test(h) ? { kind: "handle", value: h } : null; }
  if (p[0] === "channel" && /^UC[\w-]{22}$/.test(p[1] ?? "")) return { kind: "id", value: p[1] };
  return null; // /c/name and /user/name can't be resolved reliably by the official API
}

class ApiError extends Error {}
const explain = (status, reason) =>
  reason === "quotaExceeded" || reason === "dailyLimitExceeded" ? "YouTube API quota exceeded. Try again after the daily reset (midnight Pacific time)."
  : reason === "keyInvalid" || status === 400 ? "The API key was rejected as invalid. Re-copy it into .env.local and restart."
  : reason === "accessNotConfigured" || reason === "serviceDisabled" ? "YouTube Data API v3 is not enabled for this Google Cloud project. Enable it in APIs & Services > Library."
  : status === 403 ? "Request forbidden. If you restricted the key, its API restriction must include YouTube Data API v3."
  : `YouTube API returned HTTP ${status}.`;

async function call(base, path, params, { apiKey, fetchImpl, sleep, stats }) {
  const url = new URL(`${base}/${path}`); for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v); url.searchParams.set("key", apiKey);
  for (let attempt = 0; ; attempt++) {
    let res; stats.requests++;
    try { res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) }); } catch { res = null; }
    if (res?.ok) return res.json();
    const transient = !res || res.status === 429 || res.status >= 500;
    if (transient && attempt < 3) { await sleep(500 * 2 ** attempt); continue; } // limited retries with backoff, never infinite
    if (!res) throw new ApiError("Could not reach the YouTube API (network error or timeout).");
    const body = await res.json().catch(() => ({})); throw new ApiError(explain(res.status, body?.error?.errors?.[0]?.reason ?? ""));
  }
}

/** Returns { channel: {id, title}, videos: [{id, title, date}], skipped, requests }. Newest first, duplicates and private/deleted placeholders removed. */
export async function fetchChannelTitles({ apiKey, channel, base = DEFAULT_API, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), onProgress = () => {} }) {
  if (!apiKey) throw new ApiError("YOUTUBE_API_KEY is not set. Put it in .env.local (YOUTUBE_API_KEY=...) and run via `npm run titles` or `node --env-file=.env.local channel-titles.mjs`.");
  const ref = typeof channel === "string" ? parseChannelInput(channel) : channel; if (!ref) throw new ApiError("Unrecognised channel. Use @handle, https://youtube.com/@handle or https://youtube.com/channel/UC...");
  const ctx = { apiKey, fetchImpl, sleep, stats: { requests: 0 } };
  const ch = await call(base, "channels", { part: "snippet,contentDetails", [ref.kind === "handle" ? "forHandle" : "id"]: ref.value, fields: "items(id,snippet/title,contentDetails/relatedPlaylists/uploads)" }, ctx);
  if (!ch.items?.length) throw new ApiError(`No channel found for ${ref.value}.`); if (ch.items.length > 1) throw new ApiError("More than one channel matched; refusing to guess.");
  const c = ch.items[0], uploads = c.contentDetails?.relatedPlaylists?.uploads; if (!c.id || !uploads) throw new ApiError("The API response had no uploads playlist for this channel.");
  const videos = [], seen = new Set(); let skipped = 0, pageToken;
  do {
    const page = await call(base, "playlistItems", { part: "snippet,contentDetails", playlistId: uploads, maxResults: "50", pageToken, fields: "nextPageToken,items(snippet(title,publishedAt,resourceId/videoId),contentDetails/videoPublishedAt)" }, ctx);
    for (const it of page.items ?? []) {
      const id = it.snippet?.resourceId?.videoId, title = String(it.snippet?.title ?? "").replace(/\s+/g, " ").trim();
      if (!id || seen.has(id)) continue; seen.add(id);
      if (!title || PLACEHOLDER_TITLES.has(title)) { skipped++; continue; }
      videos.push({ id, title, date: String(it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? "").slice(0, 10) });
    }
    pageToken = page.nextPageToken; onProgress({ found: videos.length, requests: ctx.stats.requests });
  } while (pageToken);
  return { channel: { id: c.id, title: c.snippet?.title ?? "" }, videos, skipped, requests: ctx.stats.requests };
}

export const formatTitles = (videos, { details = false } = {}) => videos.map(v => (details ? `${v.date || "????-??-??"} | ${v.title}` : v.title)).join("\n") + "\n";

async function main(argv, env) {
  const flags = new Set(argv.filter(a => a === "--details")); const oi = argv.indexOf("--out"); const out = oi >= 0 ? argv[oi + 1] : null;
  const input = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
  if (!input || (oi >= 0 && !out)) { console.error("Usage: npm run titles -- <@handle | channel URL> [--details] [--out file.txt]\nExample: npm run titles -- https://youtube.com/@yogawithkassandra"); return 2; }
  try {
    const r = await fetchChannelTitles({ apiKey: env.YOUTUBE_API_KEY, channel: input, base: env.YT_API_BASE_URL || DEFAULT_API, onProgress: p => process.stdout.write(`\r  ${p.found} titles so far (${p.requests} API requests)…`) });
    const handle = parseChannelInput(input)?.kind === "handle" ? parseChannelInput(input).value.slice(1) : r.channel.title;
    const file = out || `${handle.replace(/[^A-Za-z0-9._-]+/g, "_").toLowerCase()}-titles.txt`;
    writeFileSync(file, formatTitles(r.videos, { details: flags.has("--details") }), "utf8");
    console.log(`\nChannel: ${r.channel.title} (${r.channel.id})\nSaved ${r.videos.length} titles to ${file}` + (r.skipped ? `\nSkipped ${r.skipped} private/deleted videos` : "") + `\nAPI requests used: ${r.requests}`);
    return 0;
  } catch (e) { console.error(`\nError: ${e instanceof ApiError ? e.message : "unexpected failure (" + (e?.message ?? e) + ")"}`); return 1; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv.slice(2), process.env);
