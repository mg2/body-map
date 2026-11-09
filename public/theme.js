"use strict";
// Accent colour: four soft presets plus a custom colour. Stored only in this browser (localStorage). Loaded in <head> so there is no flash of the default colour.
(() => {
  const KEY = "mmap:accent", root = document.documentElement, PRESETS = ["blue", "green", "red", "yellow"], DARK_TEXT = "#10151b";
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = h => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hsl2hex = (h, s, l) => { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); }; return `#${f(0)}${f(8)}${f(4)}`; };
  const hue = hex => { const [r, g, b] = rgb(hex).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 30; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const valid = a => a && (PRESETS.includes(a.kind) || (a.kind === "custom" && /^#[0-9a-f]{6}$/i.test(a.color || "")));
  function apply(a) {
    root.setAttribute("data-accent", a.kind); for (const k of ["--acc", "--on-acc", "--sel", "--fill"]) root.style.removeProperty(k);
    if (a.kind === "custom") { root.style.setProperty("--acc", a.color); root.style.setProperty("--fill", a.color); root.style.setProperty("--on-acc", ratio(a.color, "#ffffff") >= ratio(a.color, DARK_TEXT) ? "#ffffff" : DARK_TEXT); root.style.setProperty("--sel", hsl2hex((hue(a.color) + 180) % 360, 0.7, 0.5)); }
  }
  let cur = { kind: "blue" }; try { const s = JSON.parse(localStorage.getItem(KEY)); if (valid(s)) cur = s; } catch { /* storage unavailable: keep default */ }
  apply(cur);
  const save = a => { cur = a; apply(a); try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ } mark(); };
  function mark() { document.querySelectorAll("#accentPicker [data-accent]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.accent === cur.kind))); const c = document.getElementById("accentCustom"); if (c && cur.kind === "custom") c.value = cur.color; }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#accentPicker button[data-accent]").forEach(b => b.addEventListener("click", () => save({ kind: b.dataset.accent })));
    const c = document.getElementById("accentCustom"); if (c) c.addEventListener("input", () => save({ kind: "custom", color: c.value.toLowerCase() }));
    mark();
  });
})();
