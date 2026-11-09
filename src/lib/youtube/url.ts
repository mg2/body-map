const VIDEO_HOSTS = new Set(["youtube.com","www.youtube.com","m.youtube.com","youtu.be","youtube-nocookie.com","www.youtube-nocookie.com"]);
const CHANNEL_HOSTS = new Set(["youtube.com","www.youtube.com","m.youtube.com"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function toUrl(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u;
  } catch { return null; }
}

export interface ParsedVideo { videoId: string; canonicalUrl: string; isShortUrl: boolean }

export function parseYouTubeVideoUrl(input: string): ParsedVideo | null {
  const u = toUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (!VIDEO_HOSTS.has(host)) return null;
  const p = u.pathname.split("/").filter(Boolean);
  let id: string | undefined; let isShortUrl = false;
  if (host === "youtu.be") id = p[0];
  else if (p[0] === "watch") id = u.searchParams.get("v") ?? undefined;
  else if (p[0] === "shorts") { id = p[1]; isShortUrl = true; }
  else if (p[0] === "embed") id = p[1];
  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}`, isShortUrl };
}

export type ChannelRef = { kind: "handle" | "id" | "custom"; value: string };

export function parseChannelRef(input: string): ChannelRef | null {
  const s = input.trim();
  if (/^@[A-Za-z0-9._-]{3,30}$/.test(s)) return { kind: "handle", value: s };
  if (CHANNEL_ID.test(s)) return { kind: "id", value: s };
  const u = toUrl(s);
  if (!u || !CHANNEL_HOSTS.has(u.hostname.toLowerCase())) return null;
  const p = u.pathname.split("/").filter(Boolean);
  if (p[0]?.startsWith("@") && /^@[A-Za-z0-9._-]{3,30}$/.test(decodeURIComponent(p[0]))) return { kind: "handle", value: decodeURIComponent(p[0]) };
  if (p[0] === "channel" && p[1] && CHANNEL_ID.test(p[1])) return { kind: "id", value: p[1] };
  if (p[0] === "c" && p[1] && /^[A-Za-z0-9._-]+$/.test(p[1])) return { kind: "custom", value: p[1] };
  return null;
}
