// Dry-run the title matcher on a text file of titles (one per line, or "date | title"): prints coverage and writes match-report.txt. No network, no database.
import { readFileSync, writeFileSync } from "node:fs";
import { CATALOG } from "../lib/catalog.ts";
import { classifyYoga } from "../lib/yoga.ts";
import { classifyUpload } from "../lib/matching.ts";
const args = process.argv.slice(2), file = args.find(a => !a.startsWith("--")), kind = args.includes("--release") ? "release" : "yoga";
if (!file) { console.error("Usage: npm run match-report -- titles.txt [--release]   (default: yoga rules)"); process.exit(2); }
const titles = readFileSync(file, "utf8").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.replace(/^\d{4}-\d{2}-\d{2}\s*\|\s*/, ""));
const rows = titles.map(t => ({ t, c: kind === "yoga" ? classifyYoga(t, CATALOG) : classifyUpload(t, CATALOG, ["release"]) }));
const mapped = rows.filter(r => r.c.kind === "map"), skipped = rows.filter(r => r.c.kind === "skip");
const reasons = new Map<string, number>(); for (const r of skipped) reasons.set((r.c as any).reason, (reasons.get((r.c as any).reason) ?? 0) + 1);
const perMuscle = new Map<string, number>(); for (const r of mapped) for (const m of (r.c as any).matches) perMuscle.set(m.slug, (perMuscle.get(m.slug) ?? 0) + 1);
const out = [`Matcher: ${kind}   Titles: ${titles.length}   Mapped: ${mapped.length} (${Math.round(100 * mapped.length / titles.length)}%)   Skipped: ${skipped.length}`, "", "== Skip reasons ==", ...[...reasons].map(([r, n]) => `${n}\t${r}`), "",
  "== Videos per muscle ==", ...[...perMuscle].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n}\t${s}`), "", "== MAPPED (title -> muscles) ==", ...mapped.map(r => `${r.t}\n    -> ${(r.c as any).matches.map((m: any) => m.slug).join(", ")}`), "", "== SKIPPED ==", ...skipped.map(r => r.t)].join("\n");
writeFileSync("match-report.txt", out + "\n"); console.log(out.split("\n").slice(0, 3 + reasons.size + 2).join("\n") + "\n\nFull report: match-report.txt");
