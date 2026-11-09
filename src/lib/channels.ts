import type { Db } from "./db.ts";
import { getSetting, setSetting } from "./db.ts";
/** Two video collections, each from one YouTube channel: "release" (muscle-release videos, the original channel) and "yoga". */
export type Collection = "release" | "yoga";
export type CollFilter = Collection | "all";
export const COLLECTIONS: Collection[] = ["release", "yoga"];
export const COLLECTION_LABEL: Record<Collection, string> = { release: "Muscle release", yoga: "Yoga" };
export const DEFAULT_YOGA_HANDLE = "@yogawithkassandra";
export const parseCollection = (v: unknown): CollFilter => (v === "release" || v === "yoga" ? v : "all");
// The original channel keeps its legacy un-prefixed setting keys (so existing databases keep working); other collections use "<collection>.<key>".
const key = (c: Collection, k: string) => (c === "release" ? k : `${c}.${k}`);
export const getChan = (db: Db, c: Collection, k: string) => getSetting(db, key(c, k));
export const setChan = (db: Db, c: Collection, k: string, v: string) => setSetting(db, key(c, k), v);
export const clearChan = (db: Db, c: Collection, ks: string[]) => { const st = db.prepare("DELETE FROM settings WHERE key=?"); for (const k of ks) st.run(key(c, k)); };
export interface ChannelCfg { collection: Collection; handle?: string; channelId?: string; uploadsPlaylistId?: string; title?: string; expectedTitle?: string; enabled: boolean; configured: boolean }
export function channelConfig(db: Db, c: Collection): ChannelCfg {
  const handle = getChan(db, c, "channelHandle") ?? (c === "release" ? "@EliteMassageBoulder" : undefined);
  const expectedTitle = getChan(db, c, "creatorName") ?? (c === "release" ? "Elite Massage and Injury Rehab" : undefined);
  const channelId = getChan(db, c, "channelId");
  return { collection: c, handle, channelId, uploadsPlaylistId: getChan(db, c, "uploadsPlaylistId"), title: getChan(db, c, "channelTitle"), expectedTitle, enabled: getChan(db, c, "enabled") !== "0", configured: !!(handle || channelId) };
}
/** Called at start-up by the app and the CLIs: the yoga channel is pre-configured but can be changed or disabled in Admin. */
export function ensureDefaultChannels(db: Db) { if (!getChan(db, "yoga", "channelHandle") && !getChan(db, "yoga", "channelId")) setChan(db, "yoga", "channelHandle", DEFAULT_YOGA_HANDLE); }
