import { CATALOG, DEEP } from "./catalog.ts";
import { ART, VIEWBOX, regionPath, regionsOfView, warpEllipse, type ArtView } from "./artmap.ts";
export type MapView = ArtView;
export type MapState = "approved" | "pending" | "none";
/** Targets drawn as a frame around the whole map (plus a labelled tab) instead of a body shape. The client keeps the frame at the viewport edges while zooming. */
export const FRAME_SLUGS = new Set(["full-body"]);
// Schematic fallback shapes for muscles the artwork does not draw (deep, facial, small). slug -> [view, cx, cy, rx, ry, rotation?] on a 200x440 canvas;
// they are warped onto the artwork figure (see artmap.ts) and mirrored automatically for bilateral muscles.
export const SHAPES: Record<string, [MapView, number, number, number, number, number?][]> = {
  "sternocleidomastoid":[["anterior",91,55,5,12]], "deltoid":[["anterior",62,82,12,12],["posterior",62,82,12,12]],
  "pectoralis-major":[["anterior",82,100,17,12]], "biceps-brachii":[["anterior",52,118,7,18]], "forearm-flexors":[["anterior",44,162,6,20]],
  "rectus-abdominis":[["anterior",100,152,9,32]], "external-obliques":[["anterior",76,158,8,24]], "hip-flexors":[["anterior",85,205,8,10]],
  "tensor-fasciae-latae":[["anterior",66,214,5,10]], "quadriceps":[["anterior",80,252,15,40]], "rectus-femoris":[["anterior",82,248,6,34]],
  "vastus-lateralis":[["anterior",69,256,6,30]], "vastus-medialis":[["anterior",90,276,5,13]], "adductor-group":[["anterior",93,232,4,16]],
  "tibialis-anterior":[["anterior",80,345,6,28]], "fibularis-group":[["anterior",68,345,4,26]],
  "trapezius-group":[["posterior",90,82,14,30]], "upper-trapezius":[["posterior",88,62,12,9]], "middle-trapezius":[["posterior",90,85,10,8]],
  "lower-trapezius":[["posterior",93,108,7,10]], "levator-scapulae":[["posterior",80,66,4,8]], "rhomboids":[["posterior",89,96,6,7]],
  "latissimus-dorsi":[["posterior",78,132,13,24]], "triceps-brachii":[["posterior",52,118,7,20]], "forearm-extensors":[["posterior",44,162,6,20]],
  "erector-spinae":[["posterior",94,150,5,30]], "quadratus-lumborum":[["posterior",86,182,5,9]], "gluteus-maximus":[["posterior",84,214,14,14]],
  "gluteus-medius":[["posterior",72,198,8,7]], "hamstring-group":[["posterior",80,264,15,38]], "biceps-femoris":[["posterior",70,262,6,30]],
  "semitendinosus":[["posterior",85,258,5,30]], "semimembranosus":[["posterior",92,268,4,22]], "gastrocnemius":[["posterior",78,335,8,24]],
  "soleus":[["posterior",78,372,6,14]], "plantar-fascia-foot":[["anterior",78,408,10,10],["posterior",78,408,10,10]],
  "piriformis":[["posterior",80,203,10,3.5]], "gluteus-minimus":[["posterior",66,206,4,5]], "deep-hip-rotators":[["posterior",76,214,8,3]],
  "rotator-cuff":[["posterior",78,90,8,13]], "supraspinatus":[["posterior",76,77,5,3.5]], "infraspinatus":[["posterior",76,92,6,6]],
  "teres-minor":[["posterior",68,100,4,3]], "teres-major":[["posterior",70,108,5,3.5]], "subscapularis":[["anterior",66,97,4,5]],
  "serratus-anterior":[["anterior",68,125,4,12]], "pectoralis-minor":[["anterior",76,95,5,4]], "scalenes":[["anterior",86,56,3,7]],
  "suboccipitals":[["posterior",94,46,5,3]], "neck-extensors":[["posterior",96,53,3.5,6]], "masseter":[["anterior",89,37,4,4]], "temporalis":[["anterior",88,23,4,5]],
  "multifidus":[["posterior",97,172,2.5,12]], "popliteus":[["posterior",80,306,4,3]], "tibialis-posterior":[["posterior",83,355,3,9]],
  "brachioradialis":[["anterior",47,142,3.5,9]], "brachialis":[["anterior",57,132,3,6]],
  "hand-muscles":[["anterior",49,198,6,6],["posterior",49,198,6,6]], "achilles-ankle":[["anterior",78,393,5,5],["posterior",78,393,4,6]],
  "longus-colli":[["anterior",97,54,2,7]], "vastus-intermedius":[["anterior",80,258,3,22]], "sartorius":[["anterior",78,252,2,46,-12]],
  "flexor-hallucis-longus":[["posterior",74,352,3,10]], "flexor-digitorum-longus":[["posterior",87,356,2.5,8]], "plantaris":[["posterior",82,322,2,7]],
  "diaphragm":[["anterior",100,121,13,4]], "intercostals":[["anterior",80,126,6,12]], "sternalis":[["anterior",100,100,2.5,10]], "coracobrachialis":[["anterior",57,106,2.5,8]],
  "serratus-posterior-inferior":[["posterior",86,142,6,3.5]], "anconeus":[["posterior",47,139,3,4]], "extensor-digitorum-longus":[["anterior",74,340,2.5,22]], "extensor-hallucis-longus":[["anterior",77,368,2,9]],
  "knee-region":[["anterior",80,306,5,5],["posterior",80,309,5,6]], "frontalis":[["anterior",100,17,8,3]], "corrugator-supercilii":[["anterior",95,22,2.5,1.5]], "procerus":[["anterior",100,25,1.5,2.5]],
  "nasalis":[["anterior",95,31,2.5,2]], "depressor-anguli-oris":[["anterior",96,40,2.5,2.5]], "digastric":[["anterior",95,44,3.5,2]], "mylohyoid":[["anterior",100,42,4,1.6]],
};
/** Pointed, faceted stand-in for a muscle (matches the angular body-muscles artwork). flip=-1 mirrors it for the opposite side. */
function facet(cx: number, cy: number, rx: number, ry: number, flip = 1): string {
  const f = (n: number) => Math.round(n * 100) / 100; let pts: [number, number][];
  if (ry >= rx * 1.25) pts = [[0, -ry], [rx * .9, -ry * .5], [rx, ry * .05], [rx * .6, ry * .72], [0, ry], [-rx * .6, ry * .72], [-rx, ry * .05], [-rx * .9, -ry * .5]]; // vertical spindle
  else if (rx >= ry * 1.25) pts = [[-rx, 0], [-rx * .5, -ry * .9], [rx * .2, -ry], [rx, -ry * .1], [rx * .55, ry * .8], [-rx * .3, ry * .9]]; // horizontal lozenge
  else pts = [[0, -ry], [rx, 0], [0, ry], [-rx, 0]]; // diamond
  return "M" + pts.map(([x, y]) => `${f(cx + flip * x)},${f(cy + y)}`).join(" L") + " Z";
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
export const elementId = (view: MapView, slug: string) => `muscle-${view}-${slug}`;
const LABEL: Record<MapState, string> = { approved: "has approved videos", pending: "has pending video suggestions", none: "no approved videos" };

export function renderBodyMap(view: MapView, states: Record<string, MapState> = {}, selected?: string): string {
  const parts: { tier: number; key: number; html: string }[] = [];
  for (const m of CATALOG) {
    const st = states[m.slug] ?? "none"; const art = ART[m.slug]?.[view];
    const label = `${m.commonName}${m.isGroup ? " (group)" : ""}, ${m.anatomicalName}${DEEP.has(m.slug) ? " (deep muscle, approximate position)" : ""}: ${LABEL[st]}`;
    const wrap = (inner: string, clip = false, extra = "") => `<g id="${elementId(view, m.slug)}"${clip ? ` clip-path="url(#clip-${view})"` : ""} class="muscle ${st}${selected === m.slug ? " selected" : ""}${extra}" data-slug="${m.slug}" role="button" tabindex="0" aria-pressed="${selected === m.slug}" aria-label="${esc(label)}"><title>${esc(label)}</title>${inner}</g>`;
    if (FRAME_SLUGS.has(m.slug)) { const [vx, vy, vw, vh] = VIEWBOX[view].split(" ").map(Number); // sensible default geometry; the client re-fits it to the viewport on every zoom/pan
      parts.push({ tier: 2, key: 0, html: wrap(`<rect class="fbframe" x="${vx + 0.6}" y="${vy + 0.6}" width="${vw - 1.2}" height="${vh - 1.2}" rx="1.2"/><g class="fbtab" transform="translate(${vx + 1.5} ${vy + 1.5}) scale(0.1)"><rect width="84" height="24" rx="6"/><text x="42" y="16" text-anchor="middle">${esc(m.commonName)}</text></g>`, false, " fullbody") }); continue; }
    if (art) { parts.push({ tier: 0, key: -art.length, html: wrap(art.map(id => `<path d="${esc(regionPath(id))}"/>`).join("")) }); continue; } // artwork: groups (more regions) underneath
    for (const [v, cx, cy, rx, ry, rot] of SHAPES[m.slug] ?? []) {
      if (v !== view) continue;
      const ell = (x: number, sign: number) => { const w = warpEllipse(view, x, cy, rx, ry); return `<path d="${facet(w.cx, w.cy, w.rx, w.ry, sign)}"${rot ? ` transform="rotate(${sign * rot} ${w.cx} ${w.cy})"` : ""}/>`; };
      parts.push({ tier: 1, key: -(rx * ry), html: wrap(m.side === "midline" || cx === 100 ? ell(100, 1) : ell(cx, 1) + ell(200 - cx, -1), true) }); // schematic: larger shapes underneath smaller ones; clipped to the body outline
    }
  }
  parts.sort((a, b) => a.tier - b.tier || a.key - b.key);
  return `<svg viewBox="${VIEWBOX[view]}" role="group" aria-label="${view === "anterior" ? "Front" : "Back"} view of the body" xmlns="http://www.w3.org/2000/svg">
<defs><clipPath id="clip-${view}">${regionsOfView(view).map(r => `<path d="${esc(r.path)}"/>`).join("")}</clipPath><pattern id="hatch-${view}" width="0.7" height="0.7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="0.7" stroke="currentColor" stroke-width="0.1" opacity=".55"/></pattern></defs>
<g class="silhouette" aria-hidden="true">${regionsOfView(view).map(r => `<path d="${esc(r.path)}"/>`).join("")}</g>
${parts.map(p => p.html).join("\n")}
</svg>`;
}
