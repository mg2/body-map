import { writeFileSync } from "node:fs";
import { renderBodyMap } from "../src/lib/bodymap.ts";
import { CATALOG } from "../src/lib/catalog.ts";
// Demo states only: no real video data. Used to show the three visual states.
const demo = { "quadriceps": "approved", "upper-trapezius": "approved", "gastrocnemius": "pending" } as const;
const css = `body{font:15px system-ui;margin:1rem;color:#1a1a1a;background:#fff}@media(prefers-color-scheme:dark){body{color:#eee;background:#14161a}}
svg{width:min(46vw,300px);height:auto;color:#2a6f97}.silhouette *{fill:none;stroke:currentColor;stroke-opacity:.35;stroke-width:1}
.muscle{cursor:pointer;outline:none}#anterior .muscle ellipse{fill:url(#hatch-anterior)}#posterior .muscle ellipse{fill:url(#hatch-posterior)}.muscle ellipse{stroke:currentColor;stroke-width:.8;transition:fill .15s}
.muscle.approved ellipse{fill:currentColor;fill-opacity:.55;stroke-width:2.2}.muscle.pending ellipse{stroke-dasharray:3 2;stroke-width:1.6}
.muscle:hover ellipse{fill-opacity:.8;stroke-width:2.6}.muscle:focus-visible ellipse{stroke:#d97706;stroke-width:3.2}.muscle.selected ellipse{stroke:#d97706;stroke-width:3}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}.row{display:flex;gap:1rem;flex-wrap:wrap}button{font:inherit;padding:.4rem .8rem}#info{min-height:3em}`;
const body = (v: "anterior" | "posterior") => renderBodyMap(v, demo);
const data = JSON.stringify(Object.fromEntries(CATALOG.map(m => [m.slug, `${m.commonName}${m.isGroup ? " (group)" : ""} - ${m.anatomicalName} - region: ${m.region}`]))).replace(/</g, "\\u003c");
writeFileSync("public/bodymap-preview.html", `<!doctype html><meta charset="utf-8"><title>Body map preview</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
<h1>Body map preview</h1><p><small>Demo highlight states only (solid = approved videos, dashed = pending, hatched = none). No real video data.</small></p>
<p><button data-v="anterior" aria-pressed="true">Front</button> <button data-v="posterior" aria-pressed="false">Back</button></p><p id="info" aria-live="polite">Select a muscle.</p>
<div class="row"><div id="anterior">${body("anterior")}</div><div id="posterior" hidden>${body("posterior")}</div></div>
<script>const D=${data};const info=document.getElementById("info");
function pick(g){document.querySelectorAll(".selected").forEach(e=>{e.classList.remove("selected");e.setAttribute("aria-pressed","false")});g.classList.add("selected");g.setAttribute("aria-pressed","true");info.textContent=D[g.dataset.slug]}
document.querySelectorAll(".muscle").forEach(g=>{g.addEventListener("click",()=>pick(g));g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick(g)}})});
document.querySelectorAll("button[data-v]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("button[data-v]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));for(const v of["anterior","posterior"])document.getElementById(v).hidden=v!==b.dataset.v}))</script>`);
console.log("wrote public/bodymap-preview.html");
