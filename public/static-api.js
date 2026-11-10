"use strict";
// GitHub Pages mode. Loaded only on the static site (build-site.ts inserts it before app.js); the local server never serves it.
// Reads:  the pre-rendered API files under ./api/ (built by the GitHub Action).
// Writes: each admin action is committed to the repository as ops/<id>.json with a GitHub token; the Action applies it and redeploys (~1–2 min).
// Login:  the token is stored ENCRYPTED in admin-key.json; the admin password decrypts it once, then this device remembers the token.
window.StaticApi = (() => {
  const TOKEN = "mmap:ghToken", PENDING = "mmap:pendingOps";
  const ls = { get: k => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v, keep = true) => { try { (keep ? localStorage : sessionStorage).setItem(k, v); } catch { /* storage blocked */ } },
    del: k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignore */ } } };
  let meta = null;
  async function loadMeta(fresh) {
    if (!meta || fresh) { const r = await fetch(`api/meta.json?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error("Site data missing (api/meta.json)."); meta = await r.json(); }
    return meta; }
  const b64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const bytesToB64 = u => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- reads: map a local-server URL to its pre-rendered file
  function fileFor(path) {
    const u = new URL(path, "http://x"), c = ["release", "yoga"].includes(u.searchParams.get("collection")) ? u.searchParams.get("collection") : "all", p = u.pathname;
    if (p === "/api/muscles") return `api/muscles.${c}.json`;
    if (p === "/api/recent") return `api/recent.${c}.json`;
    let m = p.match(/^\/api\/muscles\/([a-z0-9-]+)\/videos$/); if (m) return `api/videos/${m[1]}.${c}.json`;
    m = p.match(/^\/api\/admin\/(diagnostics|review|sync-runs|reports)$/); if (m) return `api/admin/${m[1]}.json`;
    return null; }
  async function read(path) {
    if (new URL(path, "http://x").pathname === "/api/meta") return loadMeta();
    const f = fileFor(path); if (!f) throw new Error(`Not available on the static site: ${path}`);
    const { build } = await loadMeta(); const r = await fetch(`${f}?b=${build}`);
    if (r.status === 404 && f.startsWith("api/videos/")) return []; if (!r.ok) throw new Error(`Could not load ${f} (${r.status}).`);
    return r.json(); }
  async function mapSvg(view, coll) { const { build } = await loadMeta(); const r = await fetch(`api/map.${view === "posterior" ? "posterior" : "anterior"}.${["release", "yoga"].includes(coll) ? coll : "all"}.svg?b=${build}`); return r.text(); }
  const HREF = { "/api/admin/backup": "api/admin/backup.db", "/api/admin/export.json": "api/admin/export.json", "/api/admin/export.csv": "api/admin/export.csv" };
  const href = p => HREF[p] ?? p;

  // ---- GitHub API
  async function gh(method, path, body, token = ls.get(TOKEN)) {
    const { repo } = await loadMeta(); if (!repo) throw new Error("Repository unknown (api/meta.json has no repo).");
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { method, cache: "no-store", headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(body ? { "content-type": "application/json" } : {}) }, body: body && JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { ls.del(TOKEN); throw Object.assign(new Error("The saved GitHub token is no longer valid (expired or revoked). Please log in again."), { status: 401 }); }
    if ((r.status === 403 || r.status === 404) && method !== "GET") throw Object.assign(new Error(`GitHub refused the change (${r.status}): the token cannot write to ${repo}. It needs access to this repository with "Contents: Read and write"; update the ADMIN_TOKEN secret and log in again.`), { status: r.status });
    if (r.status === 403 && /rate limit/i.test(d.message || "")) throw Object.assign(new Error("GitHub rate limit reached. Please try again in a few minutes."), { status: 403 });
    if (!r.ok) throw Object.assign(new Error(`GitHub: ${d.message || r.status}`), { status: r.status });
    return d; }

  // ---- login
  const isAdmin = () => !!ls.get(TOKEN);
  async function unlock(password, remember) {
    const k = await (await fetch(`admin-key.json?t=${Date.now()}`, { cache: "no-store" })).json();
    if (!k.ct) throw new Error(`Admin login is not set up: add the repository secret(s) ${(k.missing || []).join(" and ")} and re-run the workflow.`);
    const k0 = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64ToBytes(k.salt), iterations: k.iter, hash: "SHA-256" }, k0, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    let token; try { token = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(k.iv) }, key, b64ToBytes(k.ct))); } catch { throw new Error("Wrong password."); }
    await gh("GET", "", undefined, token); // the token itself must still work
    ls.del(TOKEN); ls.set(TOKEN, token, remember); }
  const logout = () => ls.del(TOKEN);

  // ---- writes: one committed file per admin action
  const pending = () => { try { return JSON.parse(ls.get(PENDING) || "[]"); } catch { return []; } };
  const setPending = a => ls.set(PENDING, JSON.stringify(a));
  async function write(path, o) {
    if (!isAdmin()) throw new Error("Please log in to Admin first.");
    const { branch } = await loadMeta();
    const id = new Date().toISOString().replace(/\D/g, "").slice(0, 17) + "-" + Math.random().toString(36).slice(2, 8);
    const op = { id, path, at: new Date().toISOString() };
    if (o.json !== undefined) op.body = o.json;
    else if (o.body instanceof ArrayBuffer) { op.body = bytesToB64(new Uint8Array(o.body)); op.encoding = "base64"; }
    else if (o.body !== undefined) op.body = String(o.body);
    const content = bytesToB64(new TextEncoder().encode(JSON.stringify(op)));
    for (let i = 0; ; i++) {
      try { await gh("PUT", `/contents/ops/${id}.json`, { message: `admin: ${path.replace("/api/admin/", "")}`, content, branch }); break; }
      catch (e) { if ((e.status === 409 || e.status === 422 || e.status >= 500) && i < 4) { await sleep(700 * (i + 1)); continue; } throw e; } }
    setPending([...pending(), { id, path, at: op.at }]); status(); poll();
    throw Object.assign(new Error("Saved to GitHub."), { queued: true, id }); } // ends the calling handler: nothing changes on this page until the Action has applied it
  async function request(path, o = {}) { const post = o.method === "POST" || o.json !== undefined || o.body !== undefined; return post ? write(path, o) : read(path); }
  let busy = Promise.resolve(); // writes are committed one after another (parallel commits to one branch conflict)
  const serial = (path, o) => (busy = busy.catch(() => {}).then(() => request(path, o)));

  // ---- status banner + polling until the Action has applied our changes
  const LABEL = p => p.replace("/api/admin/", "").replace(/[-/]/g, " ");
  function describe(r) { const x = r.result || {};
    if (!r.ok) return `✗ ${LABEL(r.path)}: ${x.error || x.message || "failed"}`;
    if (r.path.endsWith("/sync")) return `✓ Sync ${x.status}: +${x.added} new, ${x.updated} updated${x.dryRun ? " (dry run)" : ""}${x.errors?.length ? " · " + x.errors.join("; ") : ""}`;
    if (r.path.endsWith("/test-api")) return `${x.ok ? "✓" : "✗"} ${x.message}`;
    if (r.path.endsWith("/reclassify")) return `✓ Re-checked: ${x.mapped} added to the map, ${x.stillSkipped} still skipped`;
    if (r.path.endsWith("/import-url")) return `${x.status === "added" ? "✓" : "✗"} Import: ${x.status}${x.error ? " · " + x.error : ""}`;
    if (r.path.endsWith("/channel/resolve")) return `✓ Resolved: ${x.title} (${x.channelId})`;
    return `✓ ${LABEL(r.path)} saved`; }
  let bar = null, timer = null, lastLines = [], applied = 0; // applied: finished "Action done → page refreshed" rounds (lets tests wait without guessing)
  function status(lines = lastLines) { lastLines = lines;
    if (!bar) { bar = document.createElement("div"); bar.id = "ghStatus"; bar.setAttribute("role", "status"); bar.style.cssText = "position:fixed;bottom:4.5rem;right:.5rem;z-index:50;max-width:min(26rem,92vw);background:var(--card);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:.5rem .7rem;font-size:.85rem;box-shadow:0 4px 18px #0003;pointer-events:none"; document.body.append(bar); } // click-through: never blocks the page
    const n = pending().length; bar.textContent = ""; bar.hidden = !n && !lines.length;
    if (n) bar.append(`⏳ ${n} change${n > 1 ? "s" : ""} saved to GitHub, going live in about 1–2 minutes…`);
    for (const l of lines) { const d = document.createElement("div"); d.textContent = l; bar.append(d); }
    if (!n && lines.length) { const b = document.createElement("button"); b.textContent = "OK"; b.style.cssText = "margin-top:.3rem;pointer-events:auto"; b.onclick = () => status([]); bar.append(b); } }
  async function check() {
    const list = pending(); if (!list.length) { clearInterval(timer); timer = null; return; }
    const m = await loadMeta(true).catch(() => null); if (!m) return;
    const done = list.filter(p => m.doneOps.includes(p.id)), stale = list.filter(p => Date.now() - Date.parse(p.at) > 30 * 60_000);
    if (!done.length && !stale.length) return;
    setPending(list.filter(p => !done.includes(p) && !stale.includes(p)));
    const reports = await read("/api/admin/reports").catch(() => []);
    status([...done.map(p => { const r = reports.find(x => x.id === p.id); return r ? describe(r) : `✓ ${LABEL(p.path)} saved`; }), ...stale.map(p => `⚠ ${LABEL(p.path)}: no result after 30 min. Check the Actions tab on GitHub.`)]);
    await window.onStaticUpdate?.(); applied++; if (!pending().length) { clearInterval(timer); timer = null; } }
  function poll() { if (!timer) timer = setInterval(check, 15_000); }
  document.addEventListener("DOMContentLoaded", () => { if (pending().length) { status(); poll(); check(); } });

  return { request: (p, o = {}) => (o.method === "POST" || o.json !== undefined || o.body !== undefined ? serial(p, o) : request(p, o)), mapSvg, href, isAdmin, unlock, logout, pendingCount: () => pending().length, appliedCount: () => applied, repo: async () => (await loadMeta()).repo };
})();
