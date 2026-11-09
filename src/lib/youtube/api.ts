// Server-side only. Never import from client components. The key is never logged or returned.
export class YouTubeApiError extends Error {
  code: "no-key" | "invalid-key" | "api-disabled" | "quota" | "not-found" | "ambiguous" | "mismatch" | "network" | "http";
  constructor(code: YouTubeApiError["code"], message: string) { super(message); this.code = code; }
}
export interface ResolvedChannel { channelId: string; title: string; description: string; uploadsPlaylistId: string; thumbnailUrl?: string; customUrl?: string }
type Fetch = typeof fetch;

export const maskKey = (k?: string) => (k ? `…${k.slice(-4)}` : "(not set)");

export async function resolveChannelByHandle(
  opts: { apiKey?: string; handle?: string; channelId?: string; expectedTitle?: string; fetchImpl?: Fetch; timeoutMs?: number }
): Promise<ResolvedChannel> {
  if (!opts.apiKey) throw new YouTubeApiError("no-key", "YOUTUBE_API_KEY is not set in .env.local (restart the server after editing).");
  const f = opts.fetchImpl ?? fetch;
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,contentDetails");
  if (opts.channelId) url.searchParams.set("id", opts.channelId); else url.searchParams.set("forHandle", opts.handle ?? "");
  url.searchParams.set("fields", "items(id,snippet(title,description,customUrl,thumbnails/default/url),contentDetails/relatedPlaylists/uploads)");
  url.searchParams.set("key", opts.apiKey);
  let res: Response;
  try { res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) }); }
  catch { throw new YouTubeApiError("network", "Could not reach the YouTube API (network error or timeout)."); }
  if (!res.ok) throw await classifyHttpError(res);
  const data = await res.json() as { items?: any[] };
  if (!data.items?.length) throw new YouTubeApiError("not-found", `No channel found for ${opts.handle ?? opts.channelId}.`);
  if (data.items.length > 1) throw new YouTubeApiError("ambiguous", "More than one channel returned; refusing to guess.");
  const c = data.items[0];
  const title: string = c.snippet?.title ?? "";
  if (opts.expectedTitle) { if (title.trim().toLowerCase() !== opts.expectedTitle.trim().toLowerCase()) throw new YouTubeApiError("mismatch", `Channel title "${title}" does not match expected "${opts.expectedTitle}".`); }
  else if (opts.handle && !opts.channelId && c.snippet?.customUrl && c.snippet.customUrl.toLowerCase() !== opts.handle.toLowerCase()) // no title to compare: the returned channel must carry the handle we asked for
    throw new YouTubeApiError("mismatch", `The channel found is ${c.snippet.customUrl}, not ${opts.handle}.`);
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  if (!c.id || !uploads) throw new YouTubeApiError("http", "Response lacked channel ID or uploads playlist.");
  return { channelId: c.id, title, description: c.snippet?.description ?? "", uploadsPlaylistId: uploads, thumbnailUrl: c.snippet?.thumbnails?.default?.url, customUrl: c.snippet?.customUrl };
}

export async function classifyHttpError(res: Response): Promise<YouTubeApiError> {
  const body = await res.json().catch(() => ({})) as { error?: { errors?: { reason?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason ?? "";
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return new YouTubeApiError("quota", "YouTube API quota exceeded; try again after the daily reset.");
  if (reason === "keyInvalid" || res.status === 400) return new YouTubeApiError("invalid-key", "API key rejected as invalid.");
  if (reason === "accessNotConfigured" || reason === "serviceDisabled") return new YouTubeApiError("api-disabled", "YouTube Data API v3 is not enabled for this project.");
  if (res.status === 403) return new YouTubeApiError("invalid-key", "Request forbidden: check key restrictions (API restriction must include YouTube Data API v3).");
  return new YouTubeApiError("http", `YouTube API returned HTTP ${res.status}.`);
}

export interface VideoMeta { title: string; description: string; publishedAt?: string; thumbnailUrl?: string; durationSeconds: number | null; channelId?: string; channelTitle?: string }
export async function fetchVideoMeta(apiKey: string, videoId: string, f: Fetch = fetch): Promise<VideoMeta> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails"); url.searchParams.set("id", videoId); url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", "items(snippet(title,description,publishedAt,channelId,channelTitle,thumbnails(high/url,default/url)),contentDetails/duration)");
  let res: Response;
  try { res = await f(url, { signal: AbortSignal.timeout(10_000) }); } catch { throw new YouTubeApiError("network", "Could not reach the YouTube API."); }
  if (!res.ok) throw await classifyHttpError(res);
  const it = ((await res.json()) as { items?: any[] }).items?.[0];
  if (!it) throw new YouTubeApiError("not-found", "Video not found (deleted, private, or wrong ID).");
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(it.contentDetails?.duration ?? "");
  return { title: it.snippet?.title ?? "", description: it.snippet?.description ?? "", publishedAt: it.snippet?.publishedAt, thumbnailUrl: it.snippet?.thumbnails?.high?.url ?? it.snippet?.thumbnails?.default?.url,
    durationSeconds: m ? +(m[1] ?? 0) * 86400 + +(m[2] ?? 0) * 3600 + +(m[3] ?? 0) * 60 + +(m[4] ?? 0) : null, channelId: it.snippet?.channelId, channelTitle: it.snippet?.channelTitle };
}
