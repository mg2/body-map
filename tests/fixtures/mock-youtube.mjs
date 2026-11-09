// Test double for the YouTube Data API, preloaded into gh-run (node --import). Existing videos come back unchanged; MOCK_NEW (json file) adds new uploads on top. MOCK_YT_FAIL=1: quota error.
import { readFileSync, existsSync } from "node:fs";
const state = JSON.parse(readFileSync("state/db.json", "utf8")).tables;
const extra = existsSync(process.env.MOCK_NEW ?? "") ? JSON.parse(readFileSync(process.env.MOCK_NEW, "utf8")) : []; // [{id,title,collection}]
const settings = Object.fromEntries(state.settings.map(s => [s.key, s.value]));
const playlistColl = {}; for (const [k, v] of Object.entries(settings)) if (/uploadsPlaylistId$/.test(k)) playlistColl[v] = k.startsWith("yoga.") ? "yoga" : "release";
const real = globalThis.fetch;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (u, init) => {
  const url = new URL(String(u)); if (url.hostname !== "www.googleapis.com") return real(u, init);
  if (process.env.MOCK_YT_FAIL) return json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
  const p = url.pathname.split("/").pop();
  if (p === "playlistItems") {
    const coll = playlistColl[url.searchParams.get("playlistId")]; const page = +(url.searchParams.get("pageToken") ?? 0);
    const ids = [...extra.filter(v => v.collection === coll).map(v => v.id), ...state.videos.filter(v => v.collection === coll && v.import_source === "youtube-sync").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).map(v => v.youtube_video_id)];
    const slice = ids.slice(page * 50, page * 50 + 50);
    return json({ items: slice.map(videoId => ({ contentDetails: { videoId } })), ...(ids.length > page * 50 + 50 ? { nextPageToken: String(page + 1) } : {}) });
  }
  if (p === "videos") {
    const items = url.searchParams.get("id").split(",").map(id => { const n = extra.find(v => v.id === id); const v = state.videos.find(x => x.youtube_video_id === id);
      if (n) return { id, snippet: { title: n.title, description: "", publishedAt: new Date().toISOString(), channelTitle: n.collection === "yoga" ? "Yoga With Kassandra" : "Elite Massage and Injury Rehab", thumbnails: { high: { url: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" } } }, contentDetails: { duration: "PT600S" }, status: {} };
      if (!v) return null;
      return { id, snippet: { title: v.title, description: v.description ?? "", publishedAt: v.published_at, channelId: v.channel_id, channelTitle: v.channel_title, thumbnails: { high: { url: v.thumbnail_url } } }, contentDetails: v.duration_seconds == null ? {} : { duration: `PT${v.duration_seconds}S` }, status: {} }; }).filter(Boolean);
    return json({ items });
  }
  if (p === "channels") return json({ items: [{ id: "UCmock", snippet: { title: "Mock" }, contentDetails: { relatedPlaylists: { uploads: "UUmock" } } }] });
  return json({ error: { errors: [{ reason: "notFound" }] } }, 404);
};
