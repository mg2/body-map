import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Artwork: body-muscles by Ivan Vulovic, Apache-2.0 (see src/vendor/body-muscles). Path data unchanged; mapping and warping below are this app's own.
export type ArtView = "anterior" | "posterior";
export interface Region { id: string; name: string; view: "front" | "back"; path: string }
export const REGIONS: Region[] = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../vendor/body-muscles/regions.json"), "utf8"));
const byId = new Map(REGIONS.map(r => [r.id, r]));
export const regionPath = (id: string) => byId.get(id)!.path;
export const regionsOfView = (v: ArtView) => REGIONS.filter(r => r.view === (v === "anterior" ? "front" : "back"));
export const VIEWBOX: Record<ArtView, string> = { anterior: "-1.25 -1 34 95", posterior: "35.5 -1 34 95" };
const L = (b: string) => [`${b}-left`, `${b}-right`];
/** catalog slug -> artwork regions that draw it. A slug may use several regions (e.g. upper+lower chest). Group slugs reuse their children's regions and are drawn underneath. */
export const ART: Record<string, Partial<Record<ArtView, string[]>>> = {
  "sternocleidomastoid": { anterior: L("neck") },
  "deltoid": { anterior: [...L("shoulder-front"), ...L("shoulder-side")], posterior: L("deltoid-rear") },
  "biceps-brachii": { anterior: L("biceps") }, "forearm-flexors": { anterior: L("forearm"), posterior: L("forearm-flexors") },
  "pectoralis-major": { anterior: [...L("chest-upper"), ...L("chest-lower")] }, "rectus-abdominis": { anterior: [...L("abs-upper"), ...L("abs-lower")] },
  "serratus-anterior": { anterior: L("serratus-anterior") }, "external-obliques": { anterior: L("obliques") }, "hip-flexors": { anterior: L("hip-flexor") },
  "quadriceps": { anterior: L("quads") }, "adductor-group": { anterior: L("adductors") }, "tibialis-anterior": { anterior: L("tibialis-anterior") },
  "plantar-fascia-foot": { anterior: L("foot"), posterior: L("foot-back") }, "knee-region": { anterior: L("knee"), posterior: L("knee-back") }, "hand-muscles": { anterior: L("hand"), posterior: L("hand-back") },
  "trapezius-group": { posterior: [...L("traps-upper"), ...L("traps-mid"), ...L("traps-lower")] }, "upper-trapezius": { posterior: L("traps-upper") },
  "middle-trapezius": { posterior: L("traps-mid") }, "lower-trapezius": { posterior: L("traps-lower") },
  "latissimus-dorsi": { posterior: [...L("lats-upper"), ...L("lats-mid"), ...L("lats-lower")] }, "triceps-brachii": { posterior: [...L("triceps-long"), ...L("triceps-lateral")] },
  "forearm-extensors": { posterior: L("forearm-extensors") }, "erector-spinae": { posterior: L("lower-back-erectors") }, "quadratus-lumborum": { posterior: L("lower-back-ql") },
  "gluteus-maximus": { posterior: L("gluteus-maximus") }, "gluteus-medius": { posterior: L("gluteus-medius") },
  "gastrocnemius": { posterior: [...L("calves-gastroc-medial"), ...L("calves-gastroc-lateral")] }, "soleus": { posterior: L("calves-soleus") },
  "hamstring-group": { posterior: [...L("hamstrings-medial"), ...L("hamstrings-lateral")] }, "biceps-femoris": { posterior: L("hamstrings-lateral") }, "neck-extensors": { posterior: ["nape"] },
};
/** Regions that are drawn as body outline only (no matching catalog muscle). */
export const DECORATIVE = ["head", "face", "head-back", "elbow-left", "elbow-right", "spine"];

// Schematic fallback shapes (for muscles the artwork doesn't draw) are authored on a 200x440 canvas and warped onto the artwork figure
// with landmark bands: [my y, art y, art units per canvas unit horizontally]. Landmarks were measured from the artwork's region bounding boxes.
const CENTER: Record<ArtView, number> = { anterior: 15.75, posterior: 52.5 };
const BANDS: Record<ArtView, number[][]> = {
  anterior: [[11, 0, .265], [45, 13.05, .265], [82, 19.47, .226], [100, 21.45, .22], [118, 26.8, .206], [152, 39.1, .15], [205, 45.75, .2], [252, 51.2, .295], [306, 67, .215], [345, 77.5, .2275], [408, 89.7, .161], [440, 93, .161]],
  posterior: [[11, 0, .265], [45, 11.9, .265], [62, 14.5, .27], [82, 17.65, .28], [120, 25.4, .217], [132, 27, .186], [182, 38.1, .25], [214, 46.3, .29], [264, 58.6, .28], [306, 65.9, .185], [335, 72.2, .17], [372, 81.7, .168], [408, 89.3, .13], [440, 93, .13]],
};
const r2 = (n: number) => Math.round(n * 100) / 100;
export function warpEllipse(view: ArtView, cx: number, cy: number, rx: number, ry: number) {
  const b = BANDS[view]; let i = 0; while (i < b.length - 2 && cy > b[i + 1][0]) i++;
  const [y0, a0, s0] = b[i], [y1, a1, s1] = b[i + 1]; const t = Math.min(1, Math.max(0, (cy - y0) / (y1 - y0))); const k = (a1 - a0) / (y1 - y0);
  const sx = s0 + (s1 - s0) * t;
  return { cx: r2(CENTER[view] + (cx - 100) * sx), cy: r2(a0 + (a1 - a0) * t), rx: r2(Math.max(rx * sx, 0.3)), ry: r2(Math.max(ry * k, 0.3)) };
}
