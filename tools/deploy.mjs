#!/usr/bin/env node
// Upload this version of the app to GitHub (https://github.com/mg2/body-map). Windows: double-click deploy.cmd.
//
//   node tools/deploy.mjs                 test, then upload
//   node tools/deploy.mjs --dry-run       test and show what would change, upload nothing
//   node tools/deploy.mjs --skip-tests    upload without running the test suite (not recommended)
//   node tools/deploy.mjs --yes           do not ask for confirmation
//   node tools/deploy.mjs --repo <url>    another repository (default: https://github.com/mg2/body-map.git, or env BODYMAP_REPO)
//
// What it does:
//  1. runs the test suite;
//  2. clones the repository into a temporary folder (your project folder is never modified);
//  3. replaces the CODE with this version. The LIVE DATA in the repository (state/ and pending ops/) is kept as it is,
//     so changes you made in Admin on the website are never overwritten. Only on the very first upload, when the repository
//     has no data yet, is your local state/db.json uploaded;
//  4. checks that the live data still loads and the site still builds with the new code, and that no API key or token is in the upload;
//  5. commits and pushes. The push starts the GitHub Action, which publishes the site within 1–2 minutes.
// Login: git uses your normal GitHub login (on Windows: Git Credential Manager opens the browser once).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, cpSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), flag = f => args.includes(f);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const REPO = opt("--repo") ?? process.env.BODYMAP_REPO ?? "https://github.com/mg2/body-map.git";
const BRANCH = "main", DRY = flag("--dry-run");
// Everything that belongs to the app. Anything else in the project folder (data/, node_modules/, .env.local, npm shims, downloads) is never uploaded.
export const INCLUDE = [".github", "public", "scripts", "src", "tests", "tools", "package.json", "README.md", "ARCHITECTURE.md", "THIRD_PARTY_NOTICES.md",
  ".gitignore", ".gitattributes", ".env.example", "channel-titles.mjs", "run.bat", "deploy.cmd", "yogawithkassandra_titles.txt", "youtube_titles_export.py"];
const LIVE = ["state", "ops"]; // owned by the website and the Action
const SECRET = [/AIza[0-9A-Za-z_-]{35}/, /github_pat_[0-9A-Za-z_]{40,}/, /\bgh[pousr]_[0-9A-Za-z]{36,}/];

const say = m => console.log(m), fail = m => { console.error(`\n✗ ${m}`); process.exit(1); };
function sh(cmd, a, o = {}) {
  const r = spawnSync(cmd, a, { cwd: o.cwd ?? ROOT, encoding: "utf8", stdio: o.inherit ? "inherit" : "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: o.prompt ? "1" : process.env.GIT_TERMINAL_PROMPT ?? "1", ...o.env }, shell: false });
  if (r.error) fail(r.error.code === "ENOENT" ? `"${cmd}" was not found. Install it (git: https://git-scm.com/download/win) and try again.` : r.error.message);
  if (r.status !== 0 && !o.ok) fail(`${cmd} ${a.join(" ")} failed:\n${(r.stderr || r.stdout || "").trim()}`);
  return r;
}
const git = (a, o = {}) => sh("git", a, o);

async function main() {
  say(`Body map upload → ${REPO} (${BRANCH})${DRY ? "  [dry run]" : ""}`);
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 18)) fail(`Node.js ${process.versions.node} is too old; 22.18 or newer is needed.`);
  git(["--version"]);
  for (const f of ["package.json", "src/server.ts", ".github/workflows/pages.yml"]) if (!existsSync(join(ROOT, f))) fail(`${f} is missing: run this from the project folder.`);
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

  if (!flag("--skip-tests")) {
    say("\n1/4 Running tests (about 30 seconds)…");
    const t = sh(process.execPath, ["--test", "--test-reporter=dot", "tests/*.test.ts"], { ok: true });
    if (t.status !== 0) { console.error((t.stdout + t.stderr).split("\n").filter(l => /✖|fail|Error|expected|actual/i.test(l)).slice(0, 40).join("\n")); fail("Tests failed. Nothing was uploaded."); }
    say("    ✓ all tests passed");
  } else say("\n1/4 Tests skipped (--skip-tests)");

  say("\n2/4 Downloading the current repository…");
  const tmp = mkdtempSync(join(tmpdir(), "bodymap-deploy-")), work = join(tmp, "repo");
  try {
    const c = git(["clone", "--quiet", "--depth", "1", "--branch", BRANCH, REPO, work], { cwd: tmp, ok: true, inherit: false });
    if (c.status !== 0) {
      if (/Remote branch .* not found|couldn't find remote ref|empty repository/i.test(c.stderr)) { // repository without a main branch yet
        git(["clone", "--quiet", REPO, work], { cwd: tmp }); git(["checkout", "--quiet", "-B", BRANCH], { cwd: work });
      } else fail(`Could not download ${REPO}:\n${c.stderr.trim()}`);
    }
    const W = (...p) => join(work, ...p);
    const firstUpload = !existsSync(W("state", "db.json"));

    say("\n3/4 Preparing the new version…");
    for (const e of readdirSync(work)) if (e !== ".git" && !LIVE.includes(e)) rmSync(W(e), { recursive: true, force: true }); // old code goes (renamed/deleted files too)
    for (const e of INCLUDE) if (existsSync(join(ROOT, e))) cpSync(join(ROOT, e), W(e), { recursive: true, filter: s => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) && !/[\\/]\.env\.local$/.test(s) });
    if (firstUpload) {
      if (!existsSync(join(ROOT, "state", "db.json"))) fail("The repository has no data yet and there is no local state/db.json. Run: npm run state:from-db");
      mkdirSync(W("state"), { recursive: true }); cpSync(join(ROOT, "state", "db.json"), W("state", "db.json"));
      say("    First upload: your local state/db.json is uploaded as the starting data.");
    } else say("    Live data in the repository (state/, ops/) is kept unchanged.");
    mkdirSync(W("ops"), { recursive: true }); if (!existsSync(W("ops", ".gitkeep"))) writeFileSync(W("ops", ".gitkeep"), "");

    const files = []; const walk = d => { for (const e of readdirSync(d)) { if (e === ".git") continue; const p = join(d, e); statSync(p).isDirectory() ? walk(p) : files.push(p); } }; walk(work);
    for (const f of files) { if (statSync(f).size > 20_000_000) continue; const s = readFileSync(f, "latin1"); const hit = SECRET.find(r => r.test(s)); if (hit) fail(`${relative(work, f)} looks like it contains a secret (${hit.source.slice(0, 12)}…). Remove it; nothing was uploaded.`); }

    // the live data must load and the site must build with the NEW code (catches incompatible changes before they reach the website)
    const site = join(tmp, "site"), pre = sh(process.execPath, ["src/cli/build-site.ts"], { cwd: work, ok: true, env: { SITE_DIR: site, ADMIN_PASSWORD: "", ADMIN_TOKEN: "" } });
    if (pre.status !== 0 || !existsSync(join(site, "index.html"))) fail(`The new code cannot build the site from the live data:\n${(pre.stderr || pre.stdout).trim().split("\n").slice(-15).join("\n")}`);
    rmSync(site, { recursive: true, force: true });
    say("    ✓ live data loads and the site builds with this version");

    git(["add", "-A"], { cwd: work });
    const st = git(["status", "--porcelain"], { cwd: work }).stdout.trim();
    if (!st) { say("\n✓ Nothing to upload: GitHub already has exactly this version."); return; }
    const lines = st.split("\n"); say(`\n    ${lines.length} file(s) change:`); for (const l of lines.slice(0, 40)) say("      " + l); if (lines.length > 40) say(`      … and ${lines.length - 40} more`);
    if (DRY) { say("\n✓ Dry run: nothing was uploaded."); return; }
    if (!flag("--yes") && process.stdin.isTTY) { const rl = createInterface({ input: process.stdin, output: process.stdout }); const a = (await rl.question("\nUpload now? [y/N] ")).trim().toLowerCase(); rl.close(); if (!["y", "yes", "j", "ja"].includes(a)) { say("Cancelled. Nothing was uploaded."); return; } }

    say("\n4/4 Uploading…");
    const id = ["-c", "user.name=" + (git(["config", "user.name"], { ok: true }).stdout.trim() || "body-map deploy"), "-c", "user.email=" + (git(["config", "user.email"], { ok: true }).stdout.trim() || "deploy@body-map.local")];
    git([...id, "commit", "--quiet", "-m", `Deploy app v${version}`], { cwd: work });
    for (let i = 1; ; i++) {
      const p = git(["push", "--quiet", "origin", `HEAD:${BRANCH}`], { cwd: work, ok: true, inherit: true });
      if (p.status === 0) break;
      if (i >= 4) fail("Upload failed (see above). If it says 'Authentication failed', sign in to GitHub in the window git opens, or run: git credential-manager github login");
      say(`    The repository changed meanwhile (probably an Admin change); merging and retrying (${i}/3)…`);
      git(["fetch", "--quiet", "--depth", "50", "origin", BRANCH], { cwd: work }); git([...id, "rebase", "--quiet", `origin/${BRANCH}`], { cwd: work });
    }
    const slug = REPO.replace(/^.*github\.com[/:]/, "").replace(/\.git$/, ""), [owner, name] = slug.split("/");
    say(`\n✓ Uploaded v${version}. The website updates in about 1–2 minutes.`);
    if (owner && name) say(`  Progress: https://github.com/${slug}/actions\n  Website:  https://${owner.toLowerCase()}.github.io/${name}/`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => fail(e.stack || e.message)); // not when imported by the tests
