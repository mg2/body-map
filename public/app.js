"use strict";
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v); }
  for (const x of kids.flat(Infinity)) { if (x === false || x == null) continue; e.append(x.nodeType ? x : document.createTextNode(String(x))); } return e; }; // text only: never innerHTML for external data
const add = (el, ...kids) => { for (const k of kids.flat(Infinity)) if (k !== false && k != null) el.append(k); }; // append that skips false/null (a bare append() would print "false")
async function api(path, o = {}) {
  if (window.StaticApi) return StaticApi.request(path, o); // GitHub Pages: static files for reads, committed ops for writes
  const init = { method: o.method || (o.json !== undefined || o.body !== undefined ? "POST" : "GET"), headers: { "x-mmap": "1" } };
  if (o.json !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(o.json); } else if (o.body !== undefined) init.body = o.body;
  let r; try { r = await fetch(path, init); } catch { throw new Error("Cannot reach the local server. Is it running?"); }
  const d = (r.headers.get("content-type") || "").includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; }
const toast = (m, bad) => { const t = $("#toast"); t.textContent = ""; t.append(h("span", { class: "card " + (bad ? "err" : ""), style: "display:inline-block;pointer-events:auto" }, m)); clearTimeout(toast.t); toast.t = setTimeout(() => (t.textContent = ""), 6000); };
const STATIC = !!window.StaticApi, isAdmin = () => !STATIC || StaticApi.isAdmin(), H = p => (STATIC ? StaticApi.href(p) : p);
const QUEUED = "Saved to GitHub. Live in about 1–2 minutes; the result appears in the box at the bottom right.";
/** Re-render `box` without losing your place: the page keeps its height while redrawing (so the browser never clamps the scroll
 *  to the top), then the card you were looking at goes back to the same spot on screen. If that card is gone (ignored, removed),
 *  the next one takes its place. Open notes and unsaved note text survive the redraw. */
async function keepPlace(box, render) {
  const cards = [...box.querySelectorAll("[data-key]")], top = box.getBoundingClientRect().top;
  const i = cards.findIndex(c => c.getBoundingClientRect().bottom > 8), anchors = i < 0 ? [] : cards.slice(i).map(c => ({ key: c.dataset.key, y: c.getBoundingClientRect().top }));
  const kept = new Map(cards.map(c => { const d = c.querySelector("details"), t = c.querySelector("textarea"); return [c.dataset.key, { open: !!d?.open, text: t && t.value !== t.defaultValue ? t.value : null }]; }));
  const y0 = window.scrollY; box.style.minHeight = box.offsetHeight + "px";
  try { await render(); } finally {
    for (const c of box.querySelectorAll("[data-key]")) { const k = kept.get(c.dataset.key); if (!k) continue; const d = c.querySelector("details"), t = c.querySelector("textarea"); if (d && k.open) d.open = true; if (t && k.text !== null) t.value = k.text; }
    box.style.minHeight = "";
    const esc = s => (window.CSS?.escape ? CSS.escape(s) : s), a = anchors.find(a => box.querySelector(`[data-key="${esc(a.key)}"]`));
    if (a) window.scrollBy(0, box.querySelector(`[data-key="${esc(a.key)}"]`).getBoundingClientRect().top - (anchors[0].y));
    else if (anchors.length || box.getBoundingClientRect().top !== top) window.scrollTo(0, Math.min(y0, document.documentElement.scrollHeight));
  } }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { if (e.queued) toast(QUEUED); else toast(e.message, true); } }; // e.queued: GitHub Pages saved the change; it goes live with the next deploy
const apiQ = (p, o) => api(p, o).catch(e => { if (e.queued) return { queued: true }; throw e; }); // for handlers that queue several changes in a loop
const REGIONS = { "full-body": "Full body", "head-neck": "Head and neck", shoulders: "Shoulders", chest: "Chest", "upper-back": "Upper back", "lower-back": "Lower back", "upper-arms": "Upper arms", forearms: "Forearms", hands: "Hands", abdomen: "Abdomen", "hips-glutes": "Hips and gluteal region", "front-thighs": "Front thighs", "back-thighs": "Back thighs", "inner-thighs": "Inner thighs", "outer-thighs": "Outer thighs", knees: "Knees", calves: "Calves", shins: "Shins", ankles: "Ankles", feet: "Feet" };
try { var PREV_VISIT = localStorage.getItem("mmap:lastVisit"); localStorage.setItem("mmap:lastVisit", new Date().toISOString()); } catch { var PREV_VISIT = null; } // for "new since your last visit"
const COLL_LABEL = { release: "Muscle release", yoga: "Yoga" };
const CREATOR_FALLBACK = { release: "Elite Massage and Injury Rehab", yoga: "Yoga With Kassandra" };
const creatorOf = v => v.channelTitle || CREATOR_FALLBACK[v.collection] || ""; // attribution comes from the video's own channel
let SAVED_COLL = "all"; try { const c = localStorage.getItem("mmap:collection"); if (["all", "release", "yoga"].includes(c)) SAVED_COLL = c; } catch { /* keep default */ }
const S = { collection: SAVED_COLL, view: "anterior", slug: null, region: null, muscles: [], zoom: 1, cx: 15.75, cy: 46.5, lastView: "anterior" };
const by = slug => S.muscles.find(m => m.slug === slug);
const fmtLen = sec => { const s = Math.max(0, Math.round(sec)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, "0"); return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss} h` : `${mm}:${ss} min`; };
/** Yoga length filter: "Min [ ] Max [ ] minutes". Empty = no limit, both ends included, remembered on this device for every muscle.
 *  Videos whose length is unknown are always shown (so nothing disappears silently). */
const LEN_KEY = "mmap:yogaLen";
const lenGet = () => { try { const o = JSON.parse(localStorage.getItem(LEN_KEY) || "{}"); return { min: typeof o.min === "string" ? o.min : "", max: typeof o.max === "string" ? o.max : "" }; } catch { return { min: "", max: "" }; } };
const lenSet = o => { try { localStorage.setItem(LEN_KEY, JSON.stringify(o)); } catch { /* storage blocked: filter still works for this page */ } };
const lenNum = raw => { const t = String(raw).trim().replace(",", "."); if (!t) return { v: null }; const n = Number(t); return Number.isFinite(n) && n >= 0 && n <= 10000 ? { v: n } : { bad: true }; };
function yogaList(vids) {
  const st = lenGet(), list = h("div", {}), info = h("p", { class: "small mut", "aria-live": "polite", style: "margin:.3rem 0" });
  const inp = (label, key) => { const i = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", value: st[key], size: 4, maxlength: 6, "aria-label": `${label} length in minutes`, style: "width:3.6rem;margin-left:.25rem" });
    i.addEventListener("input", () => { st[key] = i.value; lenSet(st); draw(); }); return i; };
  const min = inp("Minimum", "min"), max = inp("Maximum", "max");
  const clear = h("button", { type: "button", onclick: () => { st.min = st.max = ""; min.value = max.value = ""; lenSet(st); draw(); } }, "Clear");
  function draw() {
    const a = lenNum(st.min), b = lenNum(st.max); list.textContent = ""; info.className = "small mut";
    for (const [i, x] of [[min, a], [max, b]]) i.setAttribute("aria-invalid", String(!!x.bad));
    if (a.bad || b.bad) { info.className = "small err"; info.textContent = "Please enter minutes as a number from 0 to 10000 (e.g. 20 or 7.5)."; add(list, ...vids.map(v => videoCard(v, S.slug, isAdmin()))); return; }
    if (a.v !== null && b.v !== null && a.v > b.v) { info.className = "small err"; info.textContent = "Min is larger than Max: no video can match."; return; }
    const ok = v => v.durationSeconds == null || ((a.v === null || v.durationSeconds >= a.v * 60) && (b.v === null || v.durationSeconds <= b.v * 60));
    const shown = vids.filter(ok), unknown = shown.filter(v => v.durationSeconds == null).length, active = a.v !== null || b.v !== null;
    clear.hidden = !active && !st.min && !st.max;
    info.textContent = !active ? "" : shown.length ? `Showing ${shown.length} of ${vids.length} yoga videos${unknown ? ` (${unknown} with unknown length always shown)` : ""}.` : `No yoga video for this muscle is ${a.v !== null && b.v !== null ? `${a.v}–${b.v}` : a.v !== null ? `at least ${a.v}` : `at most ${b.v}`} minutes long (${vids.length} without the filter).`;
    add(list, ...shown.map(v => videoCard(v, S.slug, isAdmin()))); }
  draw();
  return [h("div", { class: "row small lenfilter", role: "group", "aria-label": "Filter yoga videos by length" }, h("label", {}, "Min", min), h("label", {}, "Max", max), h("span", { class: "mut" }, "minutes"), clear), info, list];
}
const fmtDate = d => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "date unknown");
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

const applyOnly = () => $("#map").classList.toggle("only", $("#onlyVideos").checked && S.muscles.some(m => m.videoCount > 0));
let musReq = 0;
async function loadMuscles() { const my = ++musReq, list = await api(`/api/muscles?collection=${S.collection}`); if (my !== musReq) return; S.muscles = list; renderAllList(); } // newest request wins
let mapReq = 0, detReq = 0; // "newest request wins": a slower, older response must never overwrite a newer drawing
async function refreshMap() {
  const my = ++mapReq, coll = S.collection, view = S.view;
  const svg = STATIC ? await StaticApi.mapSvg(view, coll) : await fetch(`/api/map?view=${view}&collection=${coll}${S.slug ? "&selected=" + encodeURIComponent(S.slug) : ""}`).then(r => r.text()); // server-rendered, escaped SVG
  if (my !== mapReq) return;
  $("#map").innerHTML = svg; $("#map").dataset.coll = coll; if (S.slug) $("#map").querySelectorAll(`[data-slug="${S.slug}"]`).forEach(g => { g.classList.add("selected"); g.setAttribute("aria-pressed", "true"); }); /* static maps carry no selection */ applyOnly(); applyView(); for (const v of ["anterior", "posterior"]) $("#v-" + v).setAttribute("aria-pressed", String(v === S.view)); }
function crumbs() { const n = $("#crumbs"); n.textContent = "";
  n.append(h("button", { onclick: () => select(null) }, "Whole body"));
  if (S.region) { n.append(" › ", h("button", { onclick: () => { S.slug = null; refreshMap(); detail(); crumbs(); } }, REGIONS[S.region] || S.region)); }
  if (S.slug) n.append(" › ", h("strong", {}, by(S.slug)?.commonName || S.slug)); }
const select = guard(async (slug, region) => {
  S.slug = slug; S.region = slug ? (by(slug)?.region === "full-body" ? null : by(slug)?.region) : region || null; // Full body is its own crumb, not a region of the body
  const m = slug && by(slug); if (m && m.view !== "both" && m.view !== S.view) S.view = m.view;
  await refreshMap(); crumbs(); await detail(); if (slug) $("#detail h2")?.focus(); });
function renderAllList() { const box = $("#allList"); box.textContent = "";
  for (const [r, label] of Object.entries(REGIONS)) { const ms = S.muscles.filter(m => m.region === r); if (!ms.length) continue;
    box.append(h("h3", { class: "small" }, label), h("div", {}, ms.map(m => h("button", { onclick: () => select(m.slug), style: "margin:.15rem" }, m.commonName, m.videoCount ? ` (${m.videoCount})` : "")))); } }
function search() { const q = $("#q").value.trim().toLowerCase(), box = $("#results"); box.textContent = ""; if (!q) return;
  const hits = S.muscles.filter(m => [m.commonName, m.anatomicalName, ...m.aliases].some(x => x.toLowerCase().includes(q))).sort((a, b) => b.videoCount - a.videoCount).slice(0, 10);
  if (!hits.length) box.append(h("li", { class: "mut small" }, "No matching muscle."));
  for (const m of hits) box.append(h("li", {}, h("button", { onclick: () => { select(m.slug); box.textContent = ""; } }, `${m.commonName} — ${m.anatomicalName}`, m.isGroup ? " (group)" : "", m.videoCount ? ` · ${m.videoCount} video${m.videoCount > 1 ? "s" : ""}` : ""))); }

function videoCard(v, slug, admin) {
  const canPlay = YT_ID.test(v.youtubeVideoId) && !v.unavailable;
  const media = h("button", { class: "thumb", type: "button", disabled: !canPlay, "aria-label": canPlay ? `Play video: ${v.title}` : `Video unavailable: ${v.title}`, onclick: () => openPlayer(v) },
    v.thumbnailUrl ? h("img", { src: v.thumbnailUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("div", { class: "noimg" }, canPlay ? "" : "No thumbnail"), canPlay && h("span", { class: "playicon", "aria-hidden": "true" }, "▶"));
  const notes = h("textarea", { rows: 2, "aria-label": "Your private note", style: "width:100%", maxlength: 5000 }, v.notes || "");
  return h("article", { class: "vid" + (v.isPrimary ? " primary" : ""), "data-key": "v" + v.id }, media, h("div", {},
    h("h3", { style: "margin:0 0 .2rem;font-size:1rem" }, v.title),
    h("div", { class: "small mut" }, `${fmtDate(v.publishedAt)}${v.durationSeconds ? " · " + fmtLen(v.durationSeconds) : ""} · ${creatorOf(v)} (YouTube)`),
    h("div", { class: "small", style: "margin:.3rem 0" }, v.isPrimary && h("span", { class: "tag ok" }, "★ Primary"), v.collection && S.collection === "all" && h("span", { class: "tag" }, COLL_LABEL[v.collection] || v.collection), v.isShort && h("span", { class: "tag" }, "Short (likely)"), v.unavailable && h("span", { class: "tag warn" }, "⚠ may be unavailable")),
    h("a", { href: v.canonicalUrl, target: "_blank", rel: "noopener noreferrer" }, "Watch on YouTube ↗"),
    admin && h("div", { class: "row small", style: "margin-top:.4rem" }, !v.isPrimary && h("button", { onclick: guard(async () => { await api("/api/admin/primary", { json: { videoId: v.id, slug } }); toast("Primary video set."); detail(); }) }, "Make primary"),
      h("button", { onclick: guard(async () => { const r = await api("/api/admin/unassign", { json: { videoId: v.id, slug } }); if (r.queued) return toast(QUEUED); await loadMuscles(); await refreshMap(); await detail(); toast(r.remaining ? `Removed from ${by(slug)?.commonName}. It stays on ${r.remaining} other muscle(s).` : "Removed. No muscle left, so the video is back in Admin → Skipped videos."); }) }, `Remove from ${by(slug)?.commonName || "this muscle"}`),
      h("button", { onclick: guard(async () => { if (!confirm("Discard all manual choices for this video and let the app decide again from its title?")) return; const r = await api("/api/admin/reset-video", { json: { videoId: v.id } }); if (r.queued) return toast(QUEUED); await loadMuscles(); await refreshMap(); await detail(); toast(r.result === "map" ? "Reset: mapped automatically from the title." : "Reset: nothing in the title matches, so it is now in Skipped videos."); }) }, "Reset to automatic"),
      h("button", { onclick: guard(async () => { await api("/api/admin/ignore", { json: { videoId: v.id, reason: "Removed from this library" } }); await loadMuscles(); await refreshMap(); detail(); toast("Video ignored (restorable in Admin)."); }) }, "Ignore")),
    h("details", { class: "small" }, h("summary", {}, STATIC ? "My note (public: stored in the GitHub repository)" : "My private note"), notes, h("button", { onclick: guard(async () => { await api("/api/admin/notes", { json: { videoId: v.id, notes: notes.value } }); toast("Note saved locally."); }) }, "Save note"))));
}
function openPlayer(v) { // large pop-up player (native <dialog>: Esc closes, focus is trapped, clicking outside closes)
  if (!YT_ID.test(v.youtubeVideoId)) return; const dlg = $("#player"); dlg.textContent = "";
  dlg.append(h("div", { class: "bar" }, h("strong", {}, v.title), h("button", { type: "button", "aria-label": "Close video", onclick: () => dlg.close() }, "✕")),
    h("div", { class: "frame" }, h("iframe", { src: `https://www.youtube-nocookie.com/embed/${v.youtubeVideoId}?rel=0&autoplay=1`, title: v.title, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", referrerpolicy: "strict-origin-when-cross-origin" })),
    h("div", { class: "bar small" }, h("a", { href: v.canonicalUrl, target: "_blank", rel: "noopener noreferrer" }, "Watch on YouTube ↗"), h("span", { class: "mut" }, creatorOf(v))));
  dlg.showModal(); }
$("#player").addEventListener("click", e => { if (e.target === $("#player")) $("#player").close(); });
$("#player").addEventListener("close", () => { $("#player").textContent = ""; }); // removing the iframe stops playback
const renderDetail = async () => { const my = ++detReq, live = $("#detail"), box = h("div", {}); delete live.dataset.done; crumbs();
  try { await drawDetail(my, box); } finally { if (my === detReq) live.replaceChildren(...box.childNodes); } };
const drawDetail = async (my, box) => {
  if (S.slug) { const m = by(S.slug), vids = await api(`/api/muscles/${S.slug}/videos?collection=${S.collection}`); if (my !== detReq) return;
    add(box, h("h2", { tabindex: -1 }, m.commonName), h("p", { class: "mut" }, m.slug === "full-body" ? "Not tied to one area of the body" : `${m.anatomicalName}${m.isGroup ? " · muscle group" : ""} · ${REGIONS[m.region] || m.region}`), m.description && h("p", {}, m.description),
      m.aliases.length > 0 && h("p", { class: "small" }, "Also known as: ", m.aliases.join(", ")),
      m.slug !== "full-body" && h("p", { class: "small mut" }, "Simplified anatomy for orientation, not exact clinical anatomy. Deep muscles are drawn at an approximate surface position."));
    const yogaNote = h("p", { class: "small mut" }, "Yoga videos are matched by the body area or pose named in their title, so they usually involve several muscles of that area.");
    if (!vids.length) { const who = { all: "No videos", release: "No muscle-release videos", yoga: "No yoga videos" }[S.collection];
      add(box, h("p", {}, `${who} for this muscle yet. New uploads are added automatically after a sync, or you can import a link in Admin.`));
      if (S.collection !== "all") { const other = await api(`/api/muscles/${S.slug}/videos?collection=all`); if (my !== detReq) return; if (other.length) add(box, h("p", { class: "small" }, `${other.length} video${other.length > 1 ? "s" : ""} for this muscle ${other.length > 1 ? "are" : "is"} in the other collection. `, h("button", { onclick: () => setCollection("all") }, "Show all videos"))); } return; }
    if (S.collection === "all") { for (const k of ["release", "yoga"]) { const g = vids.filter(v => v.collection === k); if (!g.length) continue; add(box, h("h3", { class: "grp" }, `${COLL_LABEL[k]} (${g.length})`), k === "yoga" && S.slug !== "full-body" && yogaNote.cloneNode(true), ...(k === "yoga" ? yogaList(g) : g.map(v => videoCard(v, S.slug, isAdmin())))); } }
    else add(box, S.collection === "yoga" && S.slug !== "full-body" && yogaNote, ...(S.collection === "yoga" ? yogaList(vids) : vids.map(v => videoCard(v, S.slug, isAdmin())))); return; }
  if (S.region) { box.append(h("h2", {}, REGIONS[S.region] || S.region), h("ul", { class: "list" }, S.muscles.filter(m => m.region === S.region).map(m => h("li", {}, h("button", { onclick: () => select(m.slug) }, m.commonName))))); return; }
  box.append(h("p", {}, "Select an area of the body, then choose a muscle to view the creator’s related videos."));
  const rec = await api(`/api/recent?collection=${S.collection}`); if (my !== detReq) return; if (!rec.length) box.append(h("p", { class: "mut" }, "No videos yet. Open Admin to run a sync or import a YouTube link."));
  else { const isNew = v => !!PREV_VISIT && !!v.discoveredAt && v.discoveredAt > PREV_VISIT, n = rec.filter(isNew).length;
    add(box, h("h3", {}, "Recently added ", n > 0 && h("span", { class: "badge", id: "newBadge" }, `${n} new since your last visit`)),
      h("ul", { class: "list" }, rec.map(v => h("li", { class: "small" }, isNew(v) && h("span", { class: "tag ok" }, "NEW"), S.collection === "all" && h("span", { class: "tag" }, COLL_LABEL[v.collection] || ""), `${fmtDate(v.publishedAt)} · `, h("a", { href: v.canonicalUrl, target: "_blank", rel: "noopener noreferrer" }, v.title))))); } };
// data-done = "<collection>:<muscle>" once the panel is completely drawn for that state (tests wait for it; a stale response never sets it)
const detail = guard(async () => { const next = detReq + 1; await keepPlace($("#detail"), renderDetail); if (detReq === next) $("#detail").dataset.done = `${S.collection}:${S.slug || ""}`; });



// ---------------- Admin
const field = (label, input) => h("label", { class: "small", style: "display:block;margin:.4rem 0" }, label, h("br"), input);
const muscleLabel = m => m.commonName + (m.isGroup ? " (group)" : "");
const muscleSelect = () => h("select", {}, h("option", { value: "" }, "Add muscle…"), [...S.muscles].sort((a, b) => muscleLabel(a).localeCompare(muscleLabel(b), undefined, { sensitivity: "base" })).map(m => h("option", { value: m.slug }, muscleLabel(m))));
async function badge() { const d = await api("/api/admin/diagnostics"); const b = $("#pendingBadge"); b.hidden = !d.counts.awaitingReview; b.textContent = d.counts.awaitingReview; }
function reviewCard(v, skipped) {
  const chosen = new Map(v.suggestions.map(s => [s.slug, s])); const chips = h("div", {});
  const draw = () => { chips.textContent = ""; for (const [slug, x] of chosen) chips.append(h("label", { class: "chip small" }, h("input", { type: "checkbox", checked: true, "data-slug": slug }), by(slug)?.commonName || slug, x && h("span", { class: "mut" }, ` (${Math.round(x.confidence * 100)}% · ${x.reason})`))); };
  draw(); const sel = muscleSelect(); sel.addEventListener("change", () => { if (sel.value && !chosen.has(sel.value)) { chosen.set(sel.value, null); draw(); } sel.value = ""; });
  const reason = h("input", { placeholder: "Reason to ignore (optional)", maxlength: 300 });
  const why = (v.ignoredReason || "Ignored").replace(/^\[auto\] /, "Skipped automatically: ");
  const after = async () => { await loadMuscles(); await refreshMap(); renderAdmin(); };
  return h("article", { class: "vid", "data-key": "r" + v.id }, h("div", {}, v.thumbnailUrl ? h("img", { src: v.thumbnailUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : "", h("a", { href: v.canonicalUrl, target: "_blank", rel: "noopener noreferrer", class: "small" }, "Open on YouTube ↗")),
    h("div", {}, h("h3", { style: "margin:0;font-size:1rem" }, v.title), h("div", { class: "small mut" }, `${fmtDate(v.publishedAt)}${v.durationSeconds ? " · " + fmtLen(v.durationSeconds) : ""} · ${COLL_LABEL[v.collection] || ""} · source: ${v.source}${v.isShort ? " · short (likely)" : ""}`),
      skipped && h("div", { class: "small warn" }, why), h("div", { class: "small mut" }, skipped ? "To put it on the map, choose the muscle(s):" : "Choose the muscle(s):"), chips, sel,
      h("div", { class: "row", style: "margin-top:.4rem" }, h("button", { class: "on", onclick: guard(async () => { const slugs = [...chips.querySelectorAll("input:checked")].map(i => i.dataset.slug); await api("/api/admin/approve", { json: { videoId: v.id, slugs } }); toast("Added to the map."); await after(); }) }, "Add to map"),
        skipped && h("button", { onclick: guard(async () => { const r = await api("/api/admin/reset-video", { json: { videoId: v.id } }); if (r.queued) return toast(QUEUED); toast(r.result === "map" ? "Mapped automatically from the title." : "Still no match in the title."); await after(); }) }, "Reset to automatic"),
        skipped && h("button", { onclick: guard(async () => { await api("/api/admin/ignore-forever", { json: { videoId: v.id } }); toast("Ignored forever (undo under “Ignored forever” below)."); await after(); }) }, "Ignore forever"),
        !skipped && reason, !skipped && h("button", { onclick: guard(async () => { await api("/api/admin/ignore", { json: { videoId: v.id, reason: reason.value } }); toast("Skipped."); await after(); }) }, "Skip"))));
}
function foreverCard(v) {
  const note = (v.ignoredReason || "").replace(/^\[forever\]\s*/, "");
  return h("article", { class: "vid", "data-key": "f" + v.id }, h("div", {}, v.thumbnailUrl ? h("img", { src: v.thumbnailUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : "", h("a", { href: v.canonicalUrl, target: "_blank", rel: "noopener noreferrer", class: "small" }, "Open on YouTube ↗")),
    h("div", {}, h("h3", { style: "margin:0;font-size:1rem" }, v.title), h("div", { class: "small mut" }, `${fmtDate(v.publishedAt)} · ${COLL_LABEL[v.collection] || ""} · ignored forever${note ? ": " + note : ""}`),
      h("div", { class: "row", style: "margin-top:.4rem" }, h("button", { onclick: guard(async () => { const r = await api("/api/admin/reset-video", { json: { videoId: v.id } }); if (r.queued) return toast(QUEUED); toast(r.result === "map" ? "Un-ignored and mapped automatically." : "Un-ignored. It is back in Skipped videos."); await loadMuscles(); await refreshMap(); renderAdmin(); }) }, "Un-ignore"))));
}
const listState = { skipped: { coll: null, q: "", limit: 25 }, forever: { coll: "all", q: "", limit: 25 } };
/** Long lists (hundreds of auto-skipped videos): collection filter, title search, 25 at a time, and an optional bulk action for the chosen collection. */
function pagedCards(all, st, render, bulk) {
  const count = c => all.filter(v => c === "all" || v.collection === c).length, list = h("div", {}), bulkBox = h("div", {});
  const sel = h("select", { "aria-label": "Show collection" }, [["all", "All"], ["release", "Muscle release"], ["yoga", "Yoga"]].map(([k, l]) => h("option", { value: k, selected: st.coll === k }, `${l} (${count(k)})`)));
  const q = h("input", { type: "search", placeholder: "Search titles…", value: st.q, "aria-label": "Search titles" });
  const draw = () => { const t = st.q.trim().toLowerCase(), items = all.filter(v => (st.coll === "all" || v.collection === st.coll) && (!t || v.title.toLowerCase().includes(t)));
    list.textContent = ""; add(list, h("p", { class: "small mut" }, `Showing ${Math.min(st.limit, items.length)} of ${items.length}`), ...items.slice(0, st.limit).map(render), items.length > st.limit && h("button", { onclick: () => { st.limit += 25; draw(); } }, "Show 25 more"));
    bulkBox.textContent = ""; add(bulkBox, bulk && bulk(st.coll)); };
  // once you pick a filter yourself (touched), it is remembered instead of following the list size
  sel.addEventListener("change", () => { st.coll = sel.value; st.touched = true; st.limit = 25; draw(); }); q.addEventListener("input", () => { st.q = q.value; st.limit = 25; draw(); });
  draw(); return h("div", {}, h("div", { class: "row" }, h("label", { class: "small" }, "Show: ", sel), q), bulkBox, list); }
function userAliasList() {
  const rows = S.muscles.flatMap(m => (m.userAliases || []).map(a => ({ m, a })));
  return rows.length ? h("div", {}, h("div", { class: "small mut" }, "Aliases you added:"), rows.map(({ m, a }) => h("span", { class: "chip small" }, `${m.commonName}: ${a}`, h("button", { "aria-label": `Remove alias ${a} from ${m.commonName}`, title: "Remove this alias",
    onclick: guard(async () => { await api("/api/admin/alias/remove", { json: { slug: m.slug, alias: a } }); await loadMuscles(); toast("Alias removed. Videos it already mapped keep their mapping; use “Reset to automatic” on a video to re-evaluate it."); renderAdmin(); }) }, "✕"))))
    : h("div", { class: "small mut" }, "You haven’t added any aliases.");
}
const summarize = r => `Status: ${r.status}\nScanned ${r.scanned}, added ${r.added}, updated ${r.updated}, skipped ${r.skipped}\nAuto-mapped ${r.autoMapped}, awaiting review ${r.awaitingReview}, ignored ${r.ignored}\nAPI requests ${r.apiRequests}${r.dryRun ? "\n(dry run: nothing saved)" : ""}${r.errors.length ? "\nErrors: " + r.errors.join("; ") : ""}\nStarted ${r.startedAt}\nFinished ${r.finishedAt}`;
let adminRenders = 0; // completed Admin renders (the pane re-renders after many actions; tests wait for the next one)
function renderLogin() { const P = $("#adminPane"); P.textContent = "";
  const pw = h("input", { type: "password", autocomplete: "current-password", style: "width:100%", "aria-label": "Admin password" }), keep = h("input", { type: "checkbox", checked: true }), msg = h("p", { class: "small", "aria-live": "polite" });
  const go = guard(async () => { msg.textContent = "Checking…"; try { await StaticApi.unlock(pw.value, keep.checked); } catch (e) { msg.textContent = e.message; msg.className = "small err"; return; } pw.value = ""; toast("Logged in."); renderAdmin(); detail(); });
  pw.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  P.append(h("section", { class: "card", style: "max-width:28rem" }, h("h2", {}, "Admin login"), field("Password", pw), h("label", { class: "small", style: "display:block;margin:.4rem 0" }, keep, " Remember this device"), h("button", { class: "on", onclick: go }, "Log in"), msg)); pw.focus(); }
const staticCard = () => h("section", { class: "card" }, h("h2", {}, "Hosting: GitHub Pages"), h("p", { class: "small mut" }, "Changes are saved as commits in the GitHub repository. A GitHub Action applies them and republishes the site, usually within 1–2 minutes. YouTube is also checked automatically every 6 hours; checks that find nothing new are only listed in the repository’s Actions tab, not under History."),
  h("button", { onclick: () => { if (confirm("Log out on this device? You will need the password again.")) { StaticApi.logout(); renderAdmin(); detail(); } } }, "Log out on this device"));
const renderAdmin = guard(async () => { const P = $("#adminPane"); if (STATIC && !isAdmin()) return renderLogin(); if (!P.childElementCount) P.textContent = "Loading…";
  const [diag, rev, runs] = await Promise.all([api("/api/admin/diagnostics"), api("/api/admin/review"), api("/api/admin/sync-runs")]); await badge();
  const forever = $("#foreverBox")?.open; await keepPlace(P, async () => { P.textContent = "";
  const out = h("pre", { "aria-live": "polite", hidden: true }); const show = t => { out.hidden = false; out.textContent = t; };
  const scope = h("select", { "aria-label": "Channel" }, h("option", { value: "all" }, "Both channels"), h("option", { value: "release" }, "Muscle release only"), h("option", { value: "yoga" }, "Yoga only")); const scopes = () => (scope.value === "all" ? ["release", "yoga"] : [scope.value]);
  const syncBtn = (label, body) => h("button", { onclick: guard(async () => { show("Working…"); try { const r = await apiQ("/api/admin/sync", { json: { ...body, collection: scope.value } }); if (r.queued) show("Sync requested. GitHub runs it in about 1–2 minutes; the result appears at the bottom right and under History."); else show(summarize(r)); } finally { if (!STATIC) { await loadMuscles(); await refreshMap(); setTimeout(renderAdmin, 2500); } } }) }, label);
  P.append(...(STATIC ? [staticCard()] : []), h("section", { class: "card", hidden: !rev.queue.length }, h("h2", {}, `Needs a decision (${rev.queue.length})`), rev.queue.map(v => reviewCard(v, false))),
    h("section", { class: "card" }, h("h2", {}, "Import a YouTube link"), (() => { const url = h("input", { type: "url", style: "width:100%", placeholder: "https://www.youtube.com/watch?v=…  or youtu.be/…  or /shorts/…" }), title = h("input", { placeholder: "Title (only needed without an API key)", style: "width:100%" }), pick = muscleSelect(), picked = new Set(), tags = h("span", {}), coll = h("select", { "aria-label": "Collection" }, h("option", { value: "release" }, "Muscle release"), h("option", { value: "yoga" }, "Yoga"));
      pick.addEventListener("change", () => { if (pick.value) { picked.add(pick.value); tags.textContent = [...picked].map(s => by(s).commonName).join(", "); } pick.value = ""; });
      return h("div", {}, field("Video URL", url), field("Title", title), field("Collection (yoga links are matched by body area or pose in the title)", coll), h("div", { class: "row" }, pick, tags), h("button", { onclick: guard(async () => { const r = await api("/api/admin/import-url", { json: { url: url.value, title: title.value, slugs: [...picked], collection: coll.value } }); if (r.queued) { url.value = title.value = ""; picked.clear(); tags.textContent = ""; return toast(QUEUED); }
        const msg = { added: r.processing === "ignored" ? "Saved, but no muscle was recognised in the title, so it is in Skipped videos. Assign it there." : "Added to the map.", duplicate: "Already in your library (no duplicate created).", invalid: r.error, "needs-metadata": "No API key available: please type a title.", "api-error": `YouTube lookup failed: ${r.error}. Type a title to add it anyway.` }[r.status]; toast(msg, ["invalid", "needs-metadata", "api-error"].includes(r.status)); if (r.status === "added") { url.value = title.value = ""; picked.clear(); tags.textContent = ""; await loadMuscles(); await refreshMap(); renderAdmin(); } }) }, "Import")); })()),
    h("section", { class: "card" }, h("h2", {}, "Synchronize with YouTube"), h("p", { class: "small mut" }, diag.youtubeApiKeyConfigured ? "API key configured." : "No API key configured yet. See README → Google Cloud setup. The rest of the app works without it."),
      h("div", { class: "row" }, h("label", { class: "small" }, "Channel: ", scope), syncBtn("Sync now (incremental)", { mode: "incremental" }), syncBtn("Full sync", { mode: "full" }), syncBtn("Dry run", { mode: "full", dryRun: true }),
        h("button", { onclick: guard(async () => { for (const c of scopes()) { const r = await apiQ("/api/admin/test-api", { json: { collection: c } }); if (r.queued) { toast(QUEUED); continue; } toast(`${r.ok ? "✓" : "✗"} ${r.message}`, !r.ok); } }) }, "Test API connection"),
        h("button", { onclick: guard(async () => { if (confirm("Look up the channel(s) again and re-store the channel ID?")) { for (const c of scopes()) { const r = await apiQ("/api/admin/channel/resolve", { json: { collection: c } }); if (r.queued) { toast(QUEUED); continue; } toast(`Resolved: ${r.title} (${r.channelId})`); } renderAdmin(); } }) }, "Re-resolve channel")), out,
      h("h3", { class: "small" }, "History"), h("ul", { class: "list small" }, runs.length ? runs.map(r => h("li", {}, `#${r.id} ${r.started_at.slice(0, 16).replace("T", " ")} · ${r.sync_type}${r.dry_run ? " (dry)" : ""} · ${r.status} · +${r.videos_added} new, ${r.videos_updated} upd, ${r.videos_awaiting_review} review, ${r.api_requests} API calls`, r.error_summary ? h("div", { class: "err" }, r.error_summary) : "")) : h("li", { class: "mut" }, "No syncs yet."))),
    h("section", { class: "card" }, h("h2", {}, "Settings & diagnostics"), (() => { const cc = h("select", { "aria-label": "Channel to configure" }, h("option", { value: "release" }, "Muscle-release channel"), h("option", { value: "yoga" }, "Yoga channel")), url = h("input", { value: "", placeholder: "", style: "width:100%" }), en = h("input", { type: "checkbox" }), syncCc = () => { const k = diag.channels[cc.value]; url.placeholder = k.handle ? `Currently ${k.handle}` : "https://www.youtube.com/@handle"; en.checked = k.enabled; }; cc.addEventListener("change", syncCc); syncCc(); const cid = h("input", { placeholder: "UC… (stable channel ID, 24 characters)", style: "width:100%" }), off = h("input", { type: "checkbox", checked: diag.networkSyncDisabled }), tf = h("input", { value: (diag.titleFilter || []).join(", "), style: "width:100%" });
      return h("div", {}, field("Channel to configure", cc), field("Channel URL (handle or /channel/ form)", url), h("button", { onclick: guard(async () => { await api("/api/admin/settings", { json: { channelUrl: url.value, collection: cc.value } }); toast("Saved."); renderAdmin(); }) }, "Save channel URL"),
        h("label", { class: "small", style: "display:block;margin:.5rem 0" }, en, " Sync this channel"), h("button", { onclick: guard(async () => { await api("/api/admin/settings", { json: { enabled: en.checked, collection: cc.value } }); toast("Saved."); renderAdmin(); }) }, "Save"),
        field("Muscle-release channel only: index videos whose title contains (comma-separated)", tf), h("button", { onclick: guard(async () => { await api("/api/admin/settings", { json: { titleFilter: tf.value } }); toast("Saved. Use “Re-check skipped videos” to apply it to existing uploads."); renderAdmin(); }) }, "Save title filter"), field("Enter stable channel ID manually (fallback)", cid), h("button", { onclick: guard(async () => { const r = await api("/api/admin/channel", { json: { channelId: cid.value, collection: cc.value } }); if (r.queued) return toast(QUEUED); toast(r.note); renderAdmin(); }) }, "Save channel ID"),
        h("label", { class: "small", style: "display:block;margin:.6rem 0" }, off, " Disable network synchronization (browse and import links only)"), h("button", { onclick: guard(async () => { await api("/api/admin/settings", { json: { networkSyncDisabled: off.checked } }); toast("Saved."); }) }, "Save"));
    })(), h("pre", {}, JSON.stringify(diag, null, 2))),
    h("section", { class: "card" }, h("h2", {}, "Aliases"), (() => { const sel = muscleSelect(), al = h("input", { placeholder: "New alias, e.g. “glute med”" }); return h("div", { class: "row" }, sel, al, h("button", { onclick: guard(async () => { await api("/api/admin/alias", { json: { slug: sel.value, alias: al.value } }); al.value = ""; await loadMuscles(); toast("Alias added. It is used for future matching."); renderAdmin(); }) }, "Add alias")); })(), userAliasList()),
    h("section", { class: "card" }, h("h2", {}, `Skipped videos (${rev.ignored.length})`), h("p", { class: "small mut" }, "Uploads that are not “release” videos, or whose muscle isn’t in the catalog, are skipped automatically and never reach the map. You can assign any of them to a muscle here."),
      h("button", { onclick: guard(async () => { const r = await api("/api/admin/reclassify", { json: {} }); if (r.queued) return toast(QUEUED); toast(`Re-checked: ${r.mapped} added to the map, ${r.stillSkipped} still skipped.`); await loadMuscles(); await refreshMap(); renderAdmin(); }) }, "Re-check skipped videos"),
      rev.ignored.length ? (() => { const st = listState.skipped; if (!st.touched) st.coll = rev.ignored.length > 100 ? "release" : "all"; // until you choose a filter: with hundreds of skipped videos start on the muscle-release ones
        return pagedCards(rev.ignored, st, v => reviewCard({ ...v, suggestions: [] }, true), coll => { const n = rev.ignored.filter(v => v.collection === coll && (v.ignoredReason || "").startsWith("[auto]")).length;
          return coll !== "all" && n ? h("div", { class: "row", style: "margin:.4rem 0" }, h("button", { onclick: guard(async () => { if (!confirm(`Ignore forever all ${n} automatically skipped ${COLL_LABEL[coll]} videos? You can undo this under “Ignored forever”.`)) return; const r = await api("/api/admin/ignore-forever-all", { json: { collection: coll } }); if (r.queued) return toast(QUEUED); toast(`${r.changed} videos ignored forever.`); renderAdmin(); }) }, `Ignore forever: all ${n} auto-skipped ${COLL_LABEL[coll]} videos`)) : null; }); })() : h("p", { class: "mut" }, "None.")),
    h("section", { class: "card" }, h("details", { id: "foreverBox" }, h("summary", {}, h("strong", {}, `Ignored forever (${rev.forever.length})`)), h("p", { class: "small mut" }, "Never shown in Skipped, never re-checked, never mapped automatically. Un-ignore returns a video to the automatic flow."),
      rev.forever.length ? pagedCards(rev.forever, listState.forever, foreverCard, coll => h("div", { class: "row", style: "margin:.4rem 0" }, ["release", "yoga"].filter(c => coll === "all" || coll === c).map(c => { const n = rev.forever.filter(v => v.collection === c && (v.ignoredReason || "").startsWith("[forever] bulk:")).length;
        return n ? h("button", { onclick: guard(async () => { const r = await api("/api/admin/unignore-bulk", { json: { collection: c } }); if (r.queued) return toast(QUEUED); toast(`${r.restored} ${COLL_LABEL[c]} videos restored to the automatic flow (${r.mapped} now on the map).`); await loadMuscles(); await refreshMap(); renderAdmin(); }) }, `Undo bulk ignore: ${n} ${COLL_LABEL[c]} videos`) : null; }))) : h("p", { class: "mut" }, "None."))),
    h("section", { class: "card" }, h("h2", {}, "Backup, export & import"), h("div", { class: "row" }, h("a", { href: H("/api/admin/backup"), download: "" }, "Download database backup"), " · ", h("a", { href: H("/api/admin/export.json"), download: "" }, "Export JSON"), " · ", h("a", { href: H("/api/admin/export.csv"), download: "" }, "Export CSV")),
      (() => { const mk = (label, path, raw, hint) => { const f = h("input", { type: "file", "aria-label": label }); return h("div", { style: "margin:.6rem 0" }, h("div", { class: "small" }, label, hint && h("span", { class: "mut" }, " — " + hint)), f, h("button", { onclick: guard(async () => { const file = f.files[0]; if (!file) throw new Error("Choose a file first."); if (path.includes("restore") && !confirm("Replace ALL local data with this backup? A safety backup is made first.")) return;
        const body = raw ? await file.arrayBuffer() : await file.text(); const r = await api(path, { body: path.includes("json") ? body : body }); show(JSON.stringify(r, null, 2)); await loadMuscles(); await refreshMap(); toast("Done."); }) }, "Upload")); };
        return [mk("Import CSV", "/api/admin/import-csv", false, "columns: platform,url,title,description,publishedAt,muscleSlugs,notes"), mk("Import JSON (merge; never overwrites your review decisions)", "/api/admin/import-json", false), mk("Restore database backup (replaces everything)", "/api/admin/restore", true)]; })(), out)); if (forever) $("#foreverBox").open = true; }); P.dataset.render = String(++adminRenders); });

const tab = t => { $("#library").hidden = t !== "library"; $("#adminPane").hidden = t !== "admin"; for (const n of ["library", "admin"]) $("#tab-" + n).setAttribute("aria-pressed", String(n === t)); if (t === "admin") renderAdmin(); else applyView(); };
$("#tab-library").onclick = () => tab("library"); $("#tab-admin").onclick = () => tab("admin");
for (const v of ["anterior", "posterior"]) $("#v-" + v).onclick = guard(async () => { S.view = v; await refreshMap(); });
// Zoom/pan work by moving the SVG viewBox (no scrolling), so the point under the cursor or fingers stays put.
const FIG = { h0: 95, cy0: 46.5, halfW: 17, cx0: { anterior: 15.75, posterior: 52.5 } }; const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function applyView() {
  const svg = $("#map svg"); if (!svg) return; const r = svg.getBoundingClientRect(), a = r.width / Math.max(r.height, 1);
  if (r.width < 20 || r.height < 20) return; // map not on screen (Admin tab is open): keep the last good view; tab() re-applies it on return
  if (S.lastView !== S.view) { S.cx = FIG.cx0[S.view]; S.lastView = S.view; }
  const h = FIG.h0 / S.zoom, w = h * a, c0 = FIG.cx0[S.view];
  if (S.zoom === 1) { S.cx = c0; S.cy = FIG.cy0; } else { S.cx = clamp(S.cx, c0 - FIG.halfW, c0 + FIG.halfW); S.cy = clamp(S.cy, -1 + h / 2, 94 - h / 2); }
  svg.setAttribute("viewBox", `${S.cx - w / 2} ${S.cy - h / 2} ${w} ${h}`); $("#map").style.setProperty("--z", S.zoom); $("#mapwrap").classList.toggle("zoomed", S.zoom > 1); fitFrame(S.cx - w / 2, S.cy - h / 2, w, h, w / r.width); }
function fitFrame(vx, vy, w, h, k) { // k = figure units per screen pixel. Keeps the Full body frame and its tab at the viewport edges at every zoom and pan
  const fr = $("#map .fbframe"), tab = $("#map .fbtab"), inset = 5 * k;
  if (fr) { fr.setAttribute("x", vx + inset); fr.setAttribute("y", vy + inset); fr.setAttribute("width", Math.max(w - 2 * inset, 0)); fr.setAttribute("height", Math.max(h - 2 * inset, 0)); fr.setAttribute("rx", 8 * k); }
  if (tab) tab.setAttribute("transform", `translate(${vx + 14 * k} ${vy + 14 * k}) scale(${k})`); }
function zoomAt(z, px, py) { // zoom to z, keeping the figure point under screen position (px, py) fixed
  const svg = $("#map svg"), nz = clamp(z, 1, 6); if (!svg) { S.zoom = nz; return; }
  const r = svg.getBoundingClientRect(), a = r.width / r.height, h = FIG.h0 / S.zoom, w = h * a, fx = (px - r.left) / r.width, fy = (py - r.top) / r.height;
  const ax = S.cx - w / 2 + fx * w, ay = S.cy - h / 2 + fy * h; S.zoom = nz; const h2 = FIG.h0 / nz, w2 = h2 * a; S.cx = ax - fx * w2 + w2 / 2; S.cy = ay - fy * h2 + h2 / 2; applyView(); }
const centerZoom = z => { const r = $("#mapwrap").getBoundingClientRect(); zoomAt(z, r.left + r.width / 2, r.top + r.height / 2); };
$("#zin").onclick = () => centerZoom(S.zoom * 1.5); $("#zout").onclick = () => centerZoom(S.zoom / 1.5); $("#zreset").onclick = () => { S.zoom = 1; applyView(); select(null); $("#q").value = ""; $("#results").textContent = ""; };
window.addEventListener("resize", applyView);
{ const w = $("#mapwrap"); let drag = null, dragged = false; const touches = new Map(); let pinch = null; const dist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  w.addEventListener("wheel", e => { e.preventDefault(); zoomAt(S.zoom * Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * 0.0015), e.clientX, e.clientY); }, { passive: false }); // mouse wheel / trackpad pinch
  w.addEventListener("pointerdown", e => { if (e.pointerType === "touch") { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size === 2) { drag = null; pinch = { d: dist(), z: S.zoom }; return; } }
    else if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy }; dragged = false; });
  window.addEventListener("pointermove", e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && touches.size === 2) { const [a, b] = [...touches.values()]; zoomAt(pinch.z * dist() / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); return; }
    if (!drag || S.zoom === 1) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!dragged && Math.hypot(dx, dy) < 5) return; dragged = true; w.classList.add("panning");
    const r = $("#map svg").getBoundingClientRect(), h = FIG.h0 / S.zoom, ww = h * r.width / r.height; S.cx = drag.cx - dx * ww / r.width; S.cy = drag.cy - dy * h / r.height; applyView(); });
  const up = e => { drag = null; w.classList.remove("panning"); setTimeout(() => { dragged = false; }, 0); touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  $("#map").addEventListener("click", e => { if (dragged) { e.stopPropagation(); e.preventDefault(); } }, true); } // a drag must not select the muscle underneath
$("#map").addEventListener("click", e => { const g = e.target.closest("[data-slug]"); if (g) select(g.dataset.slug); });
$("#map").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { const g = e.target.closest("[data-slug]"); if (g) { e.preventDefault(); select(g.dataset.slug); } } });
const markColl = () => document.querySelectorAll("#collSwitch [data-coll]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.coll === S.collection)));
const setCollection = guard(async c => { S.collection = c; try { localStorage.setItem("mmap:collection", c); } catch { /* ignore */ } markColl(); await loadMuscles(); await refreshMap(); await detail(); crumbs(); });
document.querySelectorAll("#collSwitch [data-coll]").forEach(b => b.addEventListener("click", () => setCollection(b.dataset.coll))); markColl();
$("#q").addEventListener("input", search); $("#onlyVideos").addEventListener("change", applyOnly);
window.onStaticUpdate = guard(async () => { await loadMuscles(); await refreshMap(); await detail(); crumbs(); if (!$("#adminPane").hidden) renderAdmin(); });
(guard(async () => { await loadMuscles(); await refreshMap(); await detail(); crumbs(); badge().catch(() => {}); }))();
