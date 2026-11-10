"""Browser end-to-end checks.

Fast, focused run: python3 tests/e2e.py --only <section>
Full release run:  python3 tests/e2e.py
Needs: pip install playwright && playwright install chromium
"""
import argparse, os, subprocess, time, sys, urllib.request, re
from playwright.sync_api import sync_playwright

SECTIONS = ("smoke", "build-info", "bulk-undo", "theme", "mobile")
parser = argparse.ArgumentParser()
parser.add_argument("--only", choices=SECTIONS, help="run one isolated browser section instead of the release suite")
args = parser.parse_args()

srv = subprocess.Popen(["node", "tests/e2e-server.ts"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
srv.stdout.readline(); U = "http://localhost:4567"; ok = []
def check(name, cond): ok.append(cond); print(("PASS " if cond else "FAIL ") + name)

def run_only(name, b):
  """Small sections deliberately start from the clean E2E server state and do not depend on the full suite."""
  if name == "smoke":
    pg = b.new_page(viewport={"width": 1100, "height": 800}); pg.goto(U); pg.wait_for_selector("#map svg")
    check("smoke: home and body map render", "Select an area of the body" in pg.inner_text("#detail") and pg.locator("#map svg").is_visible())
    pg.locator("#map [data-slug=quadriceps] path").first.dispatch_event("click"); pg.wait_for_selector("#detail article")
    check("smoke: selecting a mapped muscle shows its video", "[TEST] How to release your quads" in pg.inner_text("#detail")); pg.close()
  elif name == "build-info":
    pg = b.new_page(viewport={"width": 1100, "height": 800}); pg.goto(U); pg.wait_for_selector("#map svg"); pg.click("#tab-admin"); pg.wait_for_selector("#adminPane > #buildInfo")
    check("build-info: version and local build time are the first Admin line", re.fullmatch(r"v0\.20\.3 · gebaut \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}", pg.inner_text("#adminPane > #buildInfo")) is not None and pg.locator("#adminPane > :first-child").get_attribute("id") == "buildInfo"); pg.close()
  elif name == "bulk-undo":
    pg = b.new_page(viewport={"width": 1100, "height": 800}); pg.on("dialog", lambda d: d.accept()); pg.goto(U); pg.wait_for_selector("#map svg")
    pg.evaluate("""async () => { for (let i = 1; i <= 105; i++) await fetch('/api/admin/import-url', { method: 'POST', headers: { 'x-mmap': '1', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://youtu.be/onlyBulk' + String(i).padStart(3, '0'), title: '[TEST] Calm evening flow ' + i, collection: 'yoga' }) }); }""")
    pg.click("#tab-admin"); pg.wait_for_selector("#adminPane h2:has-text('Skipped videos (107)')")
    skipped = pg.locator("#adminPane section:has(h2:has-text('Skipped videos'))")
    skipped.locator("select[aria-label='Show collection']").select_option("yoga")
    check("bulk-undo: focused run created and filtered 105 Yoga rows", "Showing 25 of 105" in skipped.inner_text())
    skipped.locator("button:has-text('Ignore forever: all 105 auto-skipped Yoga videos')").click()
    pg.wait_for_selector("#adminPane h2:has-text('Skipped videos (2)')"); pg.wait_for_selector("#foreverBox summary:has-text('Ignored forever (105)')")
    check("bulk-undo: bulk ignore moved all 105 Yoga rows", True)
    box = pg.locator("#foreverBox")
    if not box.evaluate("el => el.open"):
      box.locator("summary").click()
    undo = box.locator("button:has-text('Undo bulk ignore: 105 Yoga videos')"); undo.wait_for(state="visible"); undo.click()
    pg.wait_for_selector("#adminPane h2:has-text('Skipped videos (107)')"); pg.wait_for_selector("#foreverBox summary:has-text('Ignored forever (0)')")
    check("bulk-undo: undo returned all rows to the automatic flow", True); pg.close()
  elif name == "theme":
    pg = b.new_page(viewport={"width": 1000, "height": 700}); pg.goto(U); pg.wait_for_selector("#map svg")
    pg.click("#accentPicker [data-accent=green]"); check("theme: preset applies", pg.evaluate("document.documentElement.dataset.accent") == "green")
    pg.fill("#accentCustom", "#ff8800"); check("theme: custom colour applies", pg.evaluate("document.documentElement.dataset.accent") == "custom" and pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()") == "#ff8800"); pg.close()
  elif name == "mobile":
    pg = b.new_page(viewport={"width": 390, "height": 800}); pg.goto(U); pg.wait_for_selector("#map svg")
    check("mobile: map renders without horizontal page scroll", pg.locator("#map svg").is_visible() and pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")); pg.close()

try:
  with sync_playwright() as p:
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    b = p.chromium.launch(**({"executable_path": executable} if executable else {}))
    if args.only:
      run_only(args.only, b); b.close(); print(f"{sum(ok)}/{len(ok)} passed ({args.only})"); raise SystemExit(0 if all(ok) else 1)
    pg = b.new_page(viewport={"width": 1100, "height": 800}); errs = []; dialogs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None); pg.on("pageerror", lambda e: errs.append(str(e))); ACCEPT = [False]; pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept() if ACCEPT[0] else d.dismiss()))
    pg.goto(U); pg.wait_for_selector("#map svg")
    check("home message shown", "Select an area of the body" in pg.inner_text("#detail"))
    check("disclaimer shown", "does not provide diagnosis" in pg.inner_text("main#library"))
    check("quads were mapped automatically from the title (no approval step)", pg.locator("#map [data-slug=quadriceps].approved").count() == 1)
    check("map shows only muscles with videos", pg.locator("#map [data-slug=quadriceps] path").first.is_visible() and not pg.locator("#map [data-slug=deltoid] path").first.is_visible())
    pg.locator("#map [data-slug=quadriceps] path").first.scroll_into_view_if_needed()
    pt = pg.evaluate("""(() => { const g = document.querySelector('#map [data-slug=quadriceps]'); const svg = g.ownerSVGElement;
      for (const path of g.querySelectorAll('path')) { const b = path.getBBox(); const m = path.getScreenCTM();
        for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { const p = svg.createSVGPoint(); p.x = b.x + b.width * i / 12; p.y = b.y + b.height * j / 12;
          if (!path.isPointInFill(p)) continue; const s = p.matrixTransform(m); const hit = document.elementFromPoint(s.x, s.y);
          if (hit && hit.closest('[data-slug]') && hit.closest('[data-slug]').dataset.slug === 'quadriceps') return [s.x, s.y]; } } return null; })()""")
    check("a real mouse click lands on the quadriceps artwork", pt is not None); pg.mouse.click(pt[0], pt[1])
    pg.wait_for_selector("#detail article")
    check("click mapped muscle shows its video", "[TEST] How to release your quads" in pg.inner_text("#detail") and "Watch on YouTube" in pg.inner_text("#detail"))
    check("breadcrumb Whole body > region > muscle", "Whole body" in pg.inner_text("#crumbs") and "Front thighs" in pg.inner_text("#crumbs") and "Quads" in pg.inner_text("#crumbs"))
    pg.click("#detail button.thumb"); pg.wait_for_selector("dialog#player[open] iframe")
    check("embed uses youtube-nocookie only", pg.get_attribute("#player iframe", "src").startswith("https://www.youtube-nocookie.com/embed/"))
    bb = pg.locator("#player iframe").bounding_box(); check("pop-up player is large (>=600px wide, 16:9)", bb["width"] >= 600 and abs(bb["width"] / bb["height"] - 16 / 9) < 0.05)
    pg.keyboard.press("Escape"); pg.wait_for_selector("dialog#player:not([open])", state="attached"); pg.wait_for_selector("#player iframe", state="detached", timeout=5000); check("Esc closes the player and removes the iframe (stops playback)", pg.locator("#player iframe").count() == 0)
    pg.click("#detail button.thumb"); pg.wait_for_selector("dialog#player[open] iframe"); pg.click("#player button[aria-label='Close video']"); pg.wait_for_selector("dialog#player:not([open])", state="attached"); check("close button works", True)
    pg.click("#detail button.thumb"); pg.wait_for_selector("dialog#player[open] iframe"); pg.mouse.click(5, 5); pg.wait_for_selector("dialog#player:not([open])", state="attached"); check("clicking outside closes the player", True)
    # ---- zoom: wheel anchored at the cursor, limits, drag-to-pan without selecting
    pg.click("#zreset"); pg.wait_for_selector("#detail:has-text('Select an area')")
    pg.locator("#map [data-slug=quadriceps] path").first.scroll_into_view_if_needed()
    pt = pg.evaluate("""(() => { const g = document.querySelector('#map [data-slug=quadriceps]'); const svg = g.ownerSVGElement; for (const path of g.querySelectorAll('path')) { const b = path.getBBox(), m = path.getScreenCTM();
      for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { const p = svg.createSVGPoint(); p.x = b.x + b.width * i / 12; p.y = b.y + b.height * j / 12; if (!path.isPointInFill(p)) continue;
        const s = p.matrixTransform(m), hit = document.elementFromPoint(s.x, s.y); if (hit && hit.closest('[data-slug]') && hit.closest('[data-slug]').dataset.slug === 'quadriceps') return [s.x, s.y]; } } return null; })()""")
    H = lambda: pg.evaluate("document.querySelector('#map svg').viewBox.baseVal.height"); Z = lambda: float(pg.evaluate("document.querySelector('#map').style.getPropertyValue('--z')") or 1)
    UNDER = lambda: pg.evaluate("([x, y]) => document.elementFromPoint(x, y)?.closest('[data-slug]')?.dataset.slug ?? null", pt)
    h0 = H(); pg.mouse.move(*pt); pg.mouse.wheel(0, -400); pg.wait_for_timeout(100)
    check("mouse wheel zooms in", h0 / H() > 1.5 and Z() > 1.5)
    check("zoom is anchored: the muscle under the cursor stays under the cursor", UNDER() == "quadriceps")
    for _ in range(12): pg.mouse.wheel(0, -600)
    pg.wait_for_timeout(100); check("zoom in is capped at 6x", Z() == 6.0)
    for _ in range(14): pg.mouse.wheel(0, 700)
    pg.wait_for_timeout(100); check("wheel back out returns to 1x with the whole figure in view", Z() == 1.0 and abs(H() - h0) < 0.01)
    pg.mouse.move(*pt); pg.mouse.wheel(0, -500); pg.wait_for_timeout(100); pt2 = pt
    VB = lambda: pg.evaluate("(() => { const v = document.querySelector('#map svg').viewBox.baseVal; return [v.x, v.y]; })()"); s0 = VB()
    pg.mouse.move(*pt2); pg.mouse.down(); pg.mouse.move(pt2[0] - 40, pt2[1] - 90, steps=8); pg.mouse.up(); pg.wait_for_timeout(100)
    s1 = VB()
    check("dragging pans the zoomed map", s1 != s0); check("a drag does not select the muscle underneath", "Select an area" in pg.inner_text("#detail"))
    pg.click("#zin"); z1 = Z(); pg.click("#zout"); check("+ / − buttons still work", z1 > 1 and Z() < z1)
    pg.click("#zreset"); pg.wait_for_selector("#detail:has-text('Select an area')"); check("Reset returns to 1x", Z() == 1.0)
    pg.locator("#map [data-slug=quadriceps] path").first.dispatch_event("click"); pg.wait_for_selector("#detail article")
    pg.click("#v-posterior"); pg.wait_for_selector("#map svg[aria-label^=Back]")
    check("back view has lats, not pecs", pg.locator("#map [data-slug=latissimus-dorsi]").count() == 1 and pg.locator("#map [data-slug=pectoralis-major]").count() == 0)
    check("back view: upper traps mapped automatically", pg.locator("#map [data-slug=upper-trapezius].approved").count() == 1)
    pg.uncheck("#onlyVideos"); check("toggle reveals muscles without videos", pg.locator("#map [data-slug=deltoid] path").first.is_visible())
    pg.focus("#map [data-slug=deltoid]"); pg.keyboard.press("Enter"); pg.wait_for_selector("#detail h2:has-text('Deltoid')")
    check("keyboard selection works; empty state shown", "No videos for this muscle" in pg.inner_text("#detail"))
    pg.fill("#q", "glute"); check("search by alias", pg.locator("#results button:has-text('Glutes')").count() == 1)
    pg.fill("#q", "latissimus"); check("search by anatomical name", pg.locator("#results button:has-text('Lats')").count() == 1)
    pg.click("#zreset"); pg.wait_for_selector("#detail:has-text('Select an area')", timeout=5000); check("reset clears selection", True)
    bad = pg.evaluate("""async () => { const bad = []; for (const m of S.muscles) { await select(m.slug); const t = document.querySelector('#detail').innerText;
      if (/\\b(false|null|undefined|NaN)\\b|\\[object/.test(t)) bad.push(m.slug + ': ' + t.slice(0, 90).replace(/\\n/g, ' | ')); } await select(null); return bad; }""")
    check(f"no stray false/null/undefined text on any of the catalog's muscles ({pg.evaluate('S.muscles.length')} checked)", not bad); print("   ", bad[:3])
    pg.fill("#q", "procerus"); pg.click("#results button"); pg.wait_for_selector("#detail h2:has-text('Procerus')")
    check("muscle detail shows its short description", "bridge of the nose" in pg.inner_text("#detail"))
    pg.click("#zreset"); pg.wait_for_selector("#detail:has-text('Select an area')")
    # ---- global collection switch: All / Muscle release / Yoga
    def vis(slug): return pg.locator(f"#map [data-slug={slug}] path").first.is_visible()
    def pick(c): pg.click(f"#collSwitch [data-coll={c}]"); pg.wait_for_selector(f"#collSwitch [data-coll={c}][aria-checked=true]"); pg.wait_for_selector(f"#map[data-coll={c}]"); pg.wait_for_selector(f"#detail[data-done^='{c}:']")  # wait until the map AND the detail panel have been redrawn for this collection
    check("the switch has All / Muscle release / Yoga and starts on All", pg.locator("#collSwitch [role=radio]").count() == 3 and pg.get_attribute("#collSwitch [data-coll=all]", "aria-checked") == "true" and pg.inner_text("#collSwitch").split() == ["All", "Muscle", "release", "Yoga"])
    pg.check("#onlyVideos"); pg.click("#v-anterior"); pick("yoga"); check("Yoga: only yoga muscles light up (neck muscle yes, quads no)", vis("sternocleidomastoid") and not vis("quadriceps"))
    pick("release"); check("Muscle release: only the original videos light up (quads yes, neck no)", vis("quadriceps") and not vis("sternocleidomastoid")); pick("all"); check("All: both collections light up", vis("quadriceps") and vis("sternocleidomastoid"))
    pg.fill("#q", "upper trap"); pg.click("#results button:has-text('Upper traps')"); pg.wait_for_selector("#detail[data-done='all:upper-trapezius']")
    check("All: the muscle page groups its videos by collection", pg.locator("#detail button.thumb").count() == 2 and "Muscle release (1)" in pg.inner_text("#detail") and "Yoga (1)" in pg.inner_text("#detail") and "matched by the body area or pose" in pg.inner_text("#detail"))
    cards = pg.locator("#detail article"); check("each card credits its own creator (not a hard-coded name)", "Elite Massage and Injury Rehab" in cards.nth(0).inner_text() and "Yoga With Kassandra" in cards.nth(1).inner_text() and "Elite Massage" not in cards.nth(1).inner_text())
    pg.locator("#detail article").nth(1).locator("button.thumb").click(); pg.wait_for_selector("dialog#player[open]"); check("the pop-up player credits the yoga creator too", "Yoga With Kassandra" in pg.inner_text("#player") and "Elite Massage" not in pg.inner_text("#player")); pg.keyboard.press("Escape"); pg.wait_for_selector("dialog#player:not([open])", state="attached")
    pick("yoga"); pg.wait_for_selector("#detail[data-done='yoga:upper-trapezius']"); check("Yoga: the same muscle shows only its yoga video", pg.locator("#detail button.thumb").count() == 1 and "Yoga for the Neck" in pg.inner_text("#detail") and "Muscle release (" not in pg.inner_text("#detail"))
    pick("release"); pg.wait_for_selector("#detail[data-done='release:upper-trapezius']"); check("Muscle release: the same muscle shows only its release video", pg.locator("#detail button.thumb").count() == 1 and "upper traps" in pg.inner_text("#detail").lower() and "Yoga for the Neck" not in pg.inner_text("#detail"))
    pg.fill("#q", "scalene"); pg.click("#results button:has-text('Scalenes')"); pg.wait_for_selector("#detail[data-done='release:scalenes']")
    check("empty in this collection but present in the other: says so and offers 'Show all videos'", "No muscle-release videos" in pg.inner_text("#detail") and pg.locator("#detail button:has-text('Show all videos')").count() == 1)
    pg.click("#detail button:has-text('Show all videos')"); pg.wait_for_selector("#detail[data-done='all:scalenes']"); pg.wait_for_selector("#detail h3:has-text('Yoga (1)')"); check("'Show all videos' switches to All and shows the yoga video", True)
    pick("yoga"); pg.click("#zreset"); pg.wait_for_selector("#detail:has-text('Select an area')"); pg.wait_for_selector("#detail ul.list li")
    rec = pg.inner_text("#detail ul.list"); check("Recently added follows the switch (Yoga: only yoga videos)", pg.locator("#detail ul.list li").count() == 3 and "Yoga for the Neck" in rec and "Yoga for Wrists" in rec and "Full Body Vinyasa" in rec and "quads" not in rec)
    # ---- Full body: a frame around the whole map + a labelled tab, clickable like a muscle
    pick("all"); pg.check("#onlyVideos"); pg.click("#zreset"); pg.wait_for_selector("#detail[data-done='all:']")
    FB = "#map [data-slug=full-body]"
    check("Full body frame and tab are drawn (the collection has a full-body video)", pg.locator(FB + " .fbframe").is_visible() and pg.locator(FB + " .fbtab").is_visible() and "Full body" in (pg.text_content(FB + " .fbtab") or ""))
    check("the target is accessible: button role, label, focusable", pg.get_attribute(FB, "role") == "button" and pg.get_attribute(FB, "tabindex") == "0" and "Full body" in pg.get_attribute(FB, "aria-label") and "has approved videos" in pg.get_attribute(FB, "aria-label"))
    pg.click("#v-posterior"); pg.wait_for_selector("#map svg[aria-label^=Back]"); check("it is on the back view too", pg.locator(FB + " .fbframe").is_visible()); pg.click("#v-anterior"); pg.wait_for_selector("#map svg[aria-label^=Front]")
    pick("release"); check("hidden when the collection has no full-body videos (Muscle release)", not pg.locator(FB + " .fbframe").is_visible()); pg.uncheck("#onlyVideos"); check("...but shown, dashed and muted, when 'only muscles with videos' is off", pg.locator(FB + " .fbframe").is_visible() and pg.locator("#map .fullbody.none").count() == 1); pg.check("#onlyVideos"); pick("all")
    EDGE = """() => { const f = document.querySelector('#map .fbframe').getBoundingClientRect(), w = document.querySelector('#mapwrap').getBoundingClientRect(); return [f.left - w.left, f.top - w.top, w.right - f.right, w.bottom - f.bottom]; }"""
    e1 = pg.evaluate(EDGE); check(f"the frame hugs the map edges ({[round(x) for x in e1]} px from each edge)", all(2 <= x <= 12 for x in e1))
    bx = pg.locator("#mapwrap").bounding_box(); pg.mouse.move(bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2)
    for _ in range(4): pg.mouse.wheel(0, -400)
    pg.wait_for_timeout(150); e2 = pg.evaluate(EDGE); check(f"...and still does after zooming in ({[round(x) for x in e2]} px), because it follows the viewport", pg.evaluate("S.zoom") > 2 and all(2 <= x <= 12 for x in e2))
    pg.click("#zreset"); pg.wait_for_selector("#detail[data-done='all:']")
    pt = pg.evaluate("""() => { const f = document.querySelector('#map .fbframe').getBoundingClientRect(); return [f.left, f.top + f.height * 0.45]; }""")
    check("a real mouse click lands on the frame's outline", pg.evaluate("([x, y]) => document.elementFromPoint(x, y)?.classList.contains('fbframe')", pt)); pg.mouse.click(*pt); pg.wait_for_selector("#detail[data-done='all:full-body']")
    check("clicking the frame opens the Full body page with its video(s) and description", "Full body" in pg.inner_text("#detail h2") and "whole body rather than one area" in pg.inner_text("#detail") and "Not tied to one area" in pg.inner_text("#detail") and "Simplified anatomy" not in pg.inner_text("#detail") and "Whole body · Full body" not in pg.inner_text("#detail") and pg.locator("#detail button.thumb").count() == 1 and "Full Body Vinyasa" in pg.inner_text("#detail") and "matched by the body area or pose" not in pg.inner_text("#detail"))
    check("the breadcrumb reads Whole body > Full body (no duplicate)", pg.inner_text("#crumbs").count("Full body") == 1 and "Whole body" in pg.inner_text("#crumbs")); check("the frame shows the selected state", pg.locator("#map .fullbody.selected").count() == 1)
    pg.click("#zreset"); pg.wait_for_selector("#detail[data-done='all:']"); pg.locator(FB + " .fbtab rect").click(); pg.wait_for_selector("#detail[data-done='all:full-body']"); check("clicking the labelled tab works too", True)
    pg.click("#zreset"); pg.wait_for_selector("#detail[data-done='all:']"); pg.focus(FB); pg.keyboard.press("Enter"); pg.wait_for_selector("#detail[data-done='all:full-body']"); check("the keyboard works (focus + Enter)", True)
    pg.click("#zreset"); pg.wait_for_selector("#detail[data-done='all:']"); pg.fill("#q", "full body"); check("search finds it by name and alias", pg.locator("#results button:has-text('Full body')").count() == 1); pg.fill("#q", "total body"); check("...including the alias 'total body'", pg.locator("#results button:has-text('Full body')").count() == 1); pg.fill("#q", "")
    pick("yoga"); pg.locator(FB + " .fbframe").scroll_into_view_if_needed(); check("it also shows in the Yoga collection", pg.locator(FB + " .fbframe").is_visible()); pg.click("#zreset"); pg.wait_for_selector("#detail[data-done='yoga:']")  # leave the page in Yoga mode, as the reload check below expects
    pg.reload(); pg.wait_for_selector("#map svg"); check("the choice is remembered after a reload", pg.get_attribute("#collSwitch [data-coll=yoga]", "aria-checked") == "true" and pg.evaluate("S.collection") == "yoga" and vis("sternocleidomastoid") and not vis("quadriceps"))
    pick("all"); pg.click("#zreset"); pg.wait_for_selector("#detail:has-text('Select an area')")
    pg.click("#tab-admin"); pg.wait_for_selector("text=Skipped videos (2)")
    disp = lambda s: pg.evaluate("(s) => getComputedStyle(document.querySelector(s)).display", s)
    check("the Admin tab REPLACES the Library (it does not show both at once)", disp("#library") == "none" and disp("#adminPane") != "none" and pg.evaluate("document.documentElement.scrollHeight") < 6000 and not pg.locator("#map svg").is_visible())
    check("Admin starts with version and local build time", re.fullmatch(r"v0\.20\.3 · gebaut \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}", pg.inner_text("#adminPane > #buildInfo")) is not None and pg.locator("#adminPane > :first-child").get_attribute("id") == "buildInfo")
    check("no review queue and no badge: only a Skipped list", pg.locator("#pendingBadge").is_hidden() and pg.locator("#adminPane section:has-text('Needs a decision')").is_hidden())
    stray = pg.evaluate("""() => { const c = document.querySelector('#adminPane').cloneNode(true); c.querySelectorAll('pre').forEach(p => p.remove()); const t = c.innerText; const m = t.match(/\\b(false|null|undefined|NaN)\\b|\\[object[^\\]]*\\]/); return m ? m[0] + ' @ ' + t.slice(Math.max(0, m.index - 40), m.index + 40) : null; }""")
    check("no stray false/null/undefined text on the Admin screen", stray is None); print("   ", stray)
    check("hostile title rendered as text, not executed", pg.locator("#adminPane img[src=x]").count() == 0 and "onerror=alert(1)" in pg.inner_text("#adminPane") and not dialogs)
    check("skip reason is explained", "Skipped automatically" in pg.inner_text("#adminPane"))
    card = pg.locator("#adminPane article", has_text="Lower back")
    card.locator("select").select_option("quadratus-lumborum"); card.locator("button:has-text('Add to map')").click(); pg.wait_for_selector("text=Skipped videos (1)")
    check("a skipped video can be assigned to a muscle by hand", True)
    pg.click("#tab-library"); vbw = pg.evaluate("document.querySelector('#map svg').viewBox.baseVal.width")  # the "Add to map" above redrew the map while the Library tab was hidden
    check("returning to Library after an Admin action: the map is still drawn (no zero-size view)", vbw > 5 and pg.locator("#map [data-slug=quadriceps] path").first.is_visible()); check("...and the Library tab hides Admin again", disp("#adminPane") == "none" and disp("#library") != "none"); pg.click("#tab-admin"); pg.wait_for_selector("#adminPane h2:has-text('Skipped videos')")
    pg.click("#adminPane button:has-text('Re-check skipped')"); pg.wait_for_selector("#toast >> text=Re-checked")
    check("re-check action works", True)
    sk = pg.locator("#adminPane article", has_text="Shoulder tightness"); opts = []
    for _ in range(60):  # the pane re-renders after "Re-check", so wait until the dropdown really exists instead of reading it mid-render
        opts = [o.strip() for o in sk.locator("select option").all_inner_texts()][1:]
        if len(opts) > 60: break
        pg.wait_for_timeout(100)
    check(f"Add muscle dropdown is sorted A-Z ({len(opts)} muscles)", len(opts) > 60 and opts == sorted(opts, key=str.casefold)); print("   ", opts[:4])
    sk.locator("button:has-text('Ignore forever')").click(); pg.wait_for_selector("text=Skipped videos (0)")
    check("ignore forever takes it out of Skipped", pg.locator("#adminPane summary:has-text('Ignored forever (1)')").count() == 1)
    pg.click("#adminPane summary:has-text('Ignored forever')"); pg.click("#adminPane button:has-text('Un-ignore')"); pg.wait_for_selector("text=Skipped videos (1)")
    check("un-ignore returns it to the automatic flow", pg.locator("#adminPane summary:has-text('Ignored forever (0)')").count() == 1)
    pg.click("#tab-library"); pg.fill("#q", "quad"); pg.click("#results button:has-text('Quads')"); pg.wait_for_selector("#detail article")
    pg.click("#detail button:has-text('Ignore')"); pg.wait_for_selector("#toast >> text=Video ignored")
    pg.click("#tab-admin"); pg.wait_for_selector("text=Skipped videos (2)")
    c2 = pg.locator("#adminPane article", has_text="How to release your quads"); check("ignored video shows your reason", "Removed from this library" in c2.inner_text())
    c2.locator("select").select_option("quadriceps"); c2.locator("button:has-text('Add to map')").click(); pg.wait_for_selector("text=Skipped videos (1)")
    check("ignored video restored to the map", True)
    pg.click("#tab-library"); pg.fill("#q", "quad"); pg.click("#results button:has-text('Quads')"); pg.wait_for_selector("#detail article")
    pg.click("#detail button:has-text('Remove from Quads')"); pg.wait_for_selector("#toast >> text=back in Admin")
    check("remove-from-muscle takes the video off that muscle", "No videos for this muscle" in pg.inner_text("#detail"))
    pg.click("#tab-admin"); pg.wait_for_selector("text=Skipped videos (2)"); c3 = pg.locator("#adminPane article", has_text="How to release your quads")
    check("it returned to Skipped with an 'Unassigned by you' reason", "Unassigned by you" in c3.inner_text())
    c3.locator("button:has-text('Reset to automatic')").click(); pg.wait_for_selector("text=Skipped videos (1)"); check("reset to automatic re-maps it from the title", True)
    asec = pg.locator("#adminPane section:has(h2:has-text('Aliases'))"); asec.locator("select").select_option("deltoid"); asec.locator("input").fill("test alias xyz"); asec.locator("button:has-text('Add alias')").click()
    pg.wait_for_selector("#adminPane .chip:has-text('test alias xyz')"); pg.click("#adminPane .chip:has-text('test alias xyz') button"); pg.wait_for_selector("#adminPane >> text=You haven’t added any aliases.")
    check("an added alias is listed and can be removed", True)
    imp = pg.locator("#adminPane section:has(h2:has-text('Import a YouTube link'))"); check("link import offers both collections", imp.locator("select[aria-label=Collection] option").count() == 2)
    imp.locator("input[type=url]").fill("https://youtu.be/yogaTest001"); imp.locator("input").nth(1).fill("[TEST] Yoga for Hips & Glutes"); imp.locator("select[aria-label=Collection]").select_option("yoga"); n0 = int(pg.evaluate("document.querySelector('#adminPane').dataset.render || 0")); imp.locator("button:has-text('Import')").click(); pg.wait_for_selector("#toast >> text=Added to the map")
    for _ in range(100):  # a successful import re-renders the pane shortly after the toast: wait for that render before touching other controls
        if int(pg.evaluate("document.querySelector('#adminPane').dataset.render || 0")) > n0: break
        pg.wait_for_timeout(100)
    check("a link imported as Yoga is matched by area (no release word needed)", True)
    check("Skipped cards say which collection they belong to", "Muscle release" in pg.locator("#adminPane section:has(h2:has-text('Skipped videos'))").inner_text())
    check("settings default to the muscle-release channel", "@EliteMassageBoulder" in (pg.get_attribute("#adminPane input[placeholder^='Currently']", "placeholder") or ""))
    pg.select_option("#adminPane select[aria-label='Channel to configure']", "yoga"); check("switching the settings to the yoga channel shows its handle", "@yogawithkassandra" in (pg.get_attribute("#adminPane input[placeholder^='Currently']", "placeholder") or ""))
    pg.select_option("#adminPane select[aria-label=Channel]", "yoga"); pg.click("#adminPane button:has-text('Sync now')"); pg.wait_for_selector("#adminPane pre:has-text('Status: ')", timeout=40000)
    check("syncing only the yoga channel reports its own error (no network in this test)", (lambda out: "[yoga]" in out and "Errors:" in out and out.count("Could not reach") == 1)(pg.locator("#adminPane pre:has-text('Status: ')").first.inner_text()))
    pg.click("#tab-library"); pick("yoga"); check("the imported yoga link is on the yoga map, and not on the release map", vis("hip-flexors")); pick("release"); check("...not in the muscle-release collection", not vis("hip-flexors")); pick("all")
    pg.click("#tab-admin"); pg.wait_for_selector("#adminPane[data-render]")  # back to Admin: the Library really is hidden now
    pg.fill("#adminPane input[type=url]", "https://youtube.com.evil.io/watch?v=aaaaaaaaaaa"); pg.click("#adminPane button:has-text('Import')"); pg.wait_for_selector("#toast >> text=Not a valid YouTube")
    check("impostor URL rejected with a clear message", True)
    check("diagnostics shows key configured but never the key", "youtubeApiKeyConfigured\": true" in pg.inner_text("#adminPane") and "E2E-SECRET" not in pg.content())
    pg.click("#adminPane button:has-text('Sync now')"); pg.wait_for_selector("#adminPane pre:has-text('Status: ')", timeout=40000)
    check("sync failure is shown clearly (no usable API/network), app stays usable", "Status: failed" in pg.inner_text("#adminPane") and "Could not reach" in pg.inner_text("#adminPane"))
    pg.click("#tab-library"); pg.screenshot(path="/tmp/desktop.png")
    # ---- long lists: 105 auto-skipped yoga videos (like the real channel, where most titles are full-body/vlogs)
    pg.evaluate("""async () => { for (let i = 1; i <= 105; i++) await fetch('/api/admin/import-url', { method: 'POST', headers: { 'x-mmap': '1', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://youtu.be/bulkYoga' + String(i).padStart(3, '0'), title: '[TEST] Calm evening flow ' + i, collection: 'yoga' }) }); }""")
    pg.click("#tab-admin"); pg.wait_for_selector("#adminPane h2:has-text('Skipped videos (106)')")
    SEL = "#adminPane select[aria-label='Show collection'] >> nth=0"; SHOWING = lambda: pg.locator("#adminPane section:has(h2:has-text('Skipped videos')) p:has-text('Showing')").first.inner_text()
    check("with >100 skipped videos the list starts on the muscle-release ones", pg.input_value(SEL) == "release" and SHOWING() == "Showing 1 of 1")
    pg.select_option(SEL, "yoga"); check("filtering to Yoga pages the list: 25 of 105 cards rendered, not all of them", SHOWING() == "Showing 25 of 105" and pg.locator("#adminPane section:has(h2:has-text('Skipped videos')) article").count() == 25)
    pg.click("#adminPane section:has(h2:has-text('Skipped videos')) button:has-text('Show 25 more')"); check("'Show 25 more' reveals the next page", SHOWING() == "Showing 50 of 105")
    pg.fill("#adminPane section:has(h2:has-text('Skipped videos')) input[type=search]", "flow 10"); check("title search filters the list (flow 10, 100-105)", SHOWING() == "Showing 7 of 7"); pg.fill("#adminPane section:has(h2:has-text('Skipped videos')) input[type=search]", "")
    ACCEPT[0] = True; pg.click("#adminPane button:has-text('Ignore forever: all 105 auto-skipped Yoga videos')"); ACCEPT[0] = False
    pg.wait_for_selector("#adminPane h2:has-text('Skipped videos (1)')"); pg.wait_for_selector("#adminPane summary:has-text('Ignored forever (105)')")
    check("bulk ignore forever moves all 105 and leaves the muscle-release skip alone", True)
    forever = pg.locator("#foreverBox")
    if not forever.evaluate("el => el.open"): forever.locator("summary").click()
    undo = forever.locator("button:has-text('Undo bulk ignore: 105 Yoga videos')"); undo.wait_for(state="visible"); undo.click(); pg.wait_for_selector("#adminPane h2:has-text('Skipped videos (106)')"); pg.wait_for_selector("#adminPane summary:has-text('Ignored forever (0)')")
    check("the bulk undo returns them to the automatic flow", True)
    pg.click("#tab-library")
    # ---- "new since your last visit" (first visit shows no badge; an older stored visit marks the recent videos)
    c1 = b.new_context(); p1 = c1.new_page(); p1.goto(U); p1.wait_for_selector("#detail:has-text('Recently added')"); check("first visit: no 'new' badge", p1.locator("#newBadge").count() == 0); c1.close()
    c2 = b.new_context(); c2.add_init_script("if (!localStorage.getItem('mmap:lastVisit')) localStorage.setItem('mmap:lastVisit', '2000-01-01T00:00:00.000Z')"); p2 = c2.new_page(); p2.goto(U); p2.wait_for_selector("#newBadge")
    n_recent = p2.locator("#detail ul.list li").count(); check("returning visit: every recent video is marked NEW and counted", n_recent >= 2 and p2.inner_text("#newBadge").startswith(f"{n_recent} new since your last visit") and p2.locator("#detail .tag:has-text('NEW')").count() == n_recent); c2.close()
    # ---- accent colour: presets + custom, in light and dark mode
    def rgbv(css):
        css = css.strip()
        if css.startswith("#"):
            h = css[1:]; h = "".join(c * 2 for c in h) if len(h) == 3 else h; return [int(h[i:i + 2], 16) for i in (0, 2, 4)]
        return [float(x) for x in re.findall(r"[\d.]+", css)[:3]]
    def lum(c): f = lambda v: (v / 255) / 12.92 if v / 255 <= 0.03928 else (((v / 255) + 0.055) / 1.055) ** 2.4; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2])
    def cr(a, b): x, y = sorted([lum(rgbv(a)), lum(rgbv(b))], reverse=True); return (x + .05) / (y + .05)
    GET = """() => { const cs = getComputedStyle(document.documentElement), btn = getComputedStyle(document.querySelector('#v-anterior'));
      return { acc: cs.getPropertyValue('--acc'), on: cs.getPropertyValue('--on-acc'), sel: cs.getPropertyValue('--sel'), fill: cs.getPropertyValue('--fill'), card: cs.getPropertyValue('--card'), svg: getComputedStyle(document.querySelector('#map svg')).color, bg: btn.backgroundColor, fg: btn.color, kind: document.documentElement.dataset.accent }; }"""
    for scheme in ("light", "dark"):
        cx = b.new_context(color_scheme=scheme, viewport={"width": 1000, "height": 700}); ap = cx.new_page(); ap.goto(U); ap.wait_for_selector("#map svg"); accs = set(); ok_all = True; worst = 99
        for kind in ("blue", "green", "red", "yellow"):
            ap.click(f"#accentPicker [data-accent={kind}]"); v = ap.evaluate(GET); accs.add(v["acc"].strip())
            good = rgbv(v["svg"]) == rgbv(v["acc"]) and cr(v["fg"], v["bg"]) >= 4.5 and cr(v["acc"], v["card"]) >= 3 and cr(v["sel"], v["card"]) >= 3 and v["sel"].strip() != v["acc"].strip() and v["kind"] == kind
            worst = min(worst, cr(v["fg"], v["bg"])); ok_all &= good
            if not good: print("   ", scheme, kind, v)
        check(f"{scheme} mode: 4 distinct accents; map follows; button text >= 4.5:1; accent and selection readable (worst button contrast {worst:.1f})", ok_all and len(accs) == 4)
        ap.click("#accentPicker [data-accent=green]"); ap.reload(); ap.wait_for_selector("#map svg"); v = ap.evaluate(GET)
        check(f"{scheme} mode: the chosen accent is remembered after a reload", v["kind"] == "green" and ap.get_attribute("#accentPicker [data-accent=green]", "aria-checked") == "true" and ap.get_attribute("#accentPicker [data-accent=blue]", "aria-checked") == "false")
        for hexcol in ("#ff8800", "#223344", "#f5e663"):
            ap.fill("#accentCustom", hexcol); v = ap.evaluate(GET)
            check(f"{scheme} mode: custom colour {hexcol} applies to the map, with readable button text ({cr(v['fg'], v['bg']):.1f}:1)", v["kind"] == "custom" and rgbv(v["svg"]) == rgbv(hexcol) and rgbv(v["fill"]) == rgbv(hexcol) and cr(v["fg"], v["bg"]) >= 4.5 and v["sel"].strip() != v["acc"].strip())
        ap.reload(); ap.wait_for_selector("#map svg"); v = ap.evaluate(GET); check(f"{scheme} mode: the custom colour is remembered", v["kind"] == "custom" and rgbv(v["acc"]) == rgbv("#f5e663"))
        ap.click("#accentPicker [data-accent=blue]"); check(f"{scheme} mode: back to the default blue", ap.evaluate(GET)["kind"] == "blue"); cx.close()
    # ---- pinch zoom with real touch events (CDP)
    tctx = b.new_context(viewport={"width": 390, "height": 800}, has_touch=True); tp = tctx.new_page(); tp.goto(U); tp.wait_for_selector("#map svg"); cdp = tctx.new_cdp_session(tp)
    bx = tp.locator("#mapwrap").bounding_box(); mx, my = bx["x"] + bx["width"] / 2, bx["y"] + min(bx["height"], 400) / 2
    def touch(kind, pts): cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
    touch("touchStart", [(mx - 20, my), (mx + 20, my)])
    for k in range(1, 9): touch("touchMove", [(mx - 20 - k * 10, my), (mx + 20 + k * 10, my)])
    touch("touchEnd", []); tp.wait_for_timeout(150); tz = float(tp.evaluate("document.querySelector('#map').style.getPropertyValue('--z')") or 1)
    check("pinch (touch) zooms in", tz > 1.5); tctx.close()
    m = b.new_page(viewport={"width": 390, "height": 800}); m.goto(U); m.wait_for_selector("#map svg")
    check("mobile: no horizontal page scroll", m.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")); m.screenshot(path="/tmp/mobile.png", full_page=True)
    check("no console/CSP errors", not [e for e in errs if "Failed to load resource" not in e]); print("console errors:", errs[:3])
    b.close()
finally: srv.terminate()
print(f"{sum(ok)}/{len(ok)} passed"); sys.exit(0 if all(ok) else 1)
