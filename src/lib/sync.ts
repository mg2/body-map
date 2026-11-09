import type { Db } from "./db.ts";
import { getSetting } from "./db.ts";
import { COLLECTIONS, channelConfig, setChan, type ChannelCfg, type CollFilter, type Collection } from "./channels.ts";
import { insertVideo, titleFilter, tx as adminTx } from "./admin.ts";
import { resolveChannelByHandle, classifyHttpError, YouTubeApiError } from "./youtube/api.ts";

export interface SyncReport { runId: number; status: string; scanned: number; added: number; updated: number; skipped: number; autoMapped: number; awaitingReview: number; ignored: number; apiRequests: number; errors: string[]; startedAt: string; finishedAt: string; dryRun: boolean }
export interface SyncOptions { db: Db; apiKey?: string; fetchImpl?: typeof fetch; mode: "full" | "incremental" | "manual"; dryRun?: boolean; sleep?: (ms: number) => Promise<void>; handle?: string; expectedTitle?: string; collection?: CollFilter }

export function parseDuration(iso: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0) : null;
}
const SHORT_MAX_SECONDS = 180; // convenience guess, not an official Shorts classification

export async function runSync(o: SyncOptions): Promise<SyncReport> {
  const { db } = o; const f = o.fetchImpl ?? fetch; const sleep = o.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const dry = !!o.dryRun; const now = () => new Date().toISOString();
  const r = { scanned: 0, added: 0, updated: 0, skipped: 0, autoMapped: 0, awaitingReview: 0, ignored: 0, apiRequests: 0, errors: [] as string[] };
  const startedAt = now();
  if (dry) db.exec("BEGIN"); // dry run = everything inside one transaction that is rolled back
  else if (db.prepare("SELECT 1 FROM sync_runs WHERE status='running' AND dry_run=0 AND started_at > ?").get(new Date(Date.now() - 30 * 60_000).toISOString()))
    throw new Error("Another synchronization is already running (lock held for up to 30 minutes).");
  const runId = Number(db.prepare("INSERT INTO sync_runs(sync_type,status,dry_run,started_at) VALUES(?,?,?,?)").run(o.mode, "running", dry ? 1 : 0, startedAt).lastInsertRowid);
  const tx = <T>(fn: () => T): T => adminTx(db, fn);

  async function call(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", o.apiKey!);
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined;
      try { res = await f(url, { signal: AbortSignal.timeout(10_000) }); r.apiRequests++; } catch { r.apiRequests++; }
      if (res?.ok) return res.json();
      const transient = !res || res.status === 429 || res.status >= 500;
      if (transient && attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
      throw res ? await classifyHttpError(res) : new YouTubeApiError("network", "Could not reach the YouTube API.");
    }
  }

  /** One channel = one collection. Uses that channel's own stored IDs; a failure here is reported but does not stop the other channel. */
  async function syncChannel(coll: Collection, cfg: ChannelCfg) {
    let uploads = cfg.uploadsPlaylistId; let channelId = cfg.channelId;
    if (!uploads) {
      const ch = await resolveChannelByHandle({ apiKey: o.apiKey, handle: coll === "release" ? (o.handle ?? cfg.handle) : cfg.handle, channelId: channelId || undefined, expectedTitle: coll === "release" ? (o.expectedTitle ?? cfg.expectedTitle) : cfg.expectedTitle, fetchImpl: f });
      r.apiRequests++; tx(() => { setChan(db, coll, "channelId", ch.channelId); setChan(db, coll, "uploadsPlaylistId", ch.uploadsPlaylistId); setChan(db, coll, "channelTitle", ch.title); });
      uploads = ch.uploadsPlaylistId; channelId = ch.channelId;
    }
    const phrases = titleFilter(db); let pageToken: string | undefined;
    do {
      const pl = await call("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(pageToken ? { pageToken } : {}), fields: "nextPageToken,items/contentDetails(videoId)" });
      const ids: string[] = (pl.items ?? []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
      pageToken = pl.nextPageToken;
      if (!ids.length) break;
      const vd = await call("videos", { part: "snippet,contentDetails,status", id: ids.join(","), maxResults: "50", fields: "items(id,snippet(title,description,publishedAt,channelId,channelTitle,thumbnails(high/url,default/url)),contentDetails/duration,status/privacyStatus)" });
      const byId = new Map<string, any>((vd.items ?? []).map((v: any) => [v.id, v]));
      const before = r.added + r.updated;
      tx(() => { for (const id of ids) {
        r.scanned++;
        const v = byId.get(id); const ex = db.prepare("SELECT id,title,description,duration_seconds,availability_status,processing_status FROM videos WHERE youtube_video_id=?").get(id) as any;
        if (!v) { // private/deleted: only flag videos we already know
          if (ex && ex.availability_status !== "unavailable") { db.prepare("UPDATE videos SET availability_status='unavailable', last_checked_at=? WHERE id=?").run(now(), ex.id); r.updated++; } else r.skipped++;
          continue;
        }
        const dur = parseDuration(v.contentDetails?.duration); const title = v.snippet?.title ?? ""; const desc = v.snippet?.description ?? "";
        if (ex) {
          if (ex.title === title && ex.description === desc && ex.duration_seconds === dur && ex.availability_status === "available") { r.skipped++; if (ex.processing_status === "ignored") r.ignored++; continue; }
          // metadata only: never touches mappings, review decisions, notes or ignored state
          db.prepare("UPDATE videos SET title=?,description=?,duration_seconds=?,is_short_candidate=?,availability_status='available',last_checked_at=? WHERE id=?")
            .run(title, desc, dur, dur !== null && dur <= SHORT_MAX_SECONDS ? 1 : 0, now(), ex.id); r.updated++; continue;
        }
        const nid = insertVideo(db, { youtubeVideoId: id, title, description: desc, publishedAt: v.snippet?.publishedAt, thumbnailUrl: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.default?.url, durationSeconds: dur,
          channelId: v.snippet?.channelId ?? channelId, channelTitle: v.snippet?.channelTitle, source: "youtube-sync", requireRelease: coll === "release", phrases, collection: coll });
        const st = (db.prepare("SELECT processing_status s FROM videos WHERE id=?").get(nid) as any).s; r.added++; st === "ignored" ? r.ignored++ : r.autoMapped++;
      } });
      if (o.mode === "incremental" && r.added + r.updated === before) break; // playlist is newest-first: a page with no changes means we've caught up
    } while (pageToken);
  }

  try {
    if (getSetting(db, "networkSyncDisabled") === "1") throw new Error("Network synchronization is disabled in Settings (local-only mode).");
    if (!o.apiKey) throw new YouTubeApiError("no-key", "YOUTUBE_API_KEY is not set in .env.local (restart after editing). No data was fabricated.");
    for (const coll of COLLECTIONS) {
      if (o.collection && o.collection !== "all" && o.collection !== coll) continue;
      const cfg = channelConfig(db, coll); if (!cfg.configured || !cfg.enabled) continue; // e.g. the yoga channel before it is set up, or switched off
      try { await syncChannel(coll, cfg); } catch (e) { r.errors.push((coll === "release" ? "" : `[${coll}] `) + (e as Error).message); }
    }
  } catch (e) { r.errors.push((e as Error).message); }
  const status = r.errors.length ? (r.scanned > 0 ? "partially-successful" : "failed") : "successful";
  const finishedAt = now();
  db.prepare(`UPDATE sync_runs SET status=?,finished_at=?,videos_scanned=?,videos_added=?,videos_updated=?,videos_skipped=?,videos_auto_mapped=?,videos_awaiting_review=?,videos_ignored=?,api_requests=?,error_summary=? WHERE id=?`)
    .run(status, finishedAt, r.scanned, r.added, r.updated, r.skipped, r.autoMapped, r.awaitingReview, r.ignored, r.apiRequests, r.errors.join("; ") || null, runId);
  if (dry) db.exec("ROLLBACK");
  return { runId, status, ...r, startedAt, finishedAt, dryRun: dry };
}
