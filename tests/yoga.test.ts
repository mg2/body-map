// Regression tests for the yoga matcher, using the real titles of the configured yoga channel (public metadata supplied by the user).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG } from "../src/lib/catalog.ts";
import { classifyYoga, AREA_RULES, POSE_RULES, cleanYogaTitle } from "../src/lib/yoga.ts";

const TITLES = readFileSync(new URL("./fixtures/yogawithkassandra_titles.txt", import.meta.url), "utf8").split(/\r?\n/).filter(Boolean);
const slugsOf = (t: string) => { const c = classifyYoga(t, CATALOG); return c.kind === "map" ? c.matches.map(m => m.slug).sort() : null; };
const has = (t: string, ...want: string[]) => { const s = slugsOf(t); assert.ok(s, `should map: ${t}`); for (const w of want) assert.ok(s!.includes(w), `${t} -> missing ${w} (got ${s!.join(",")})`); return s!; };
const lacks = (t: string, ...no: string[]) => { const s = slugsOf(t) ?? []; for (const n of no) assert.ok(!s.includes(n), `${t} -> must not include ${n}`); };

test("every muscle slug used by a yoga rule exists in the catalog", () => {
  const known = new Set(CATALOG.map(m => m.slug));
  for (const r of [...AREA_RULES, ...POSE_RULES]) { assert.ok(r.phrases.length && r.muscles.length, r.key); for (const m of r.muscles) assert.ok(known.has(m), `${r.key}: unknown muscle ${m}`); assert.equal(new Set(r.muscles).size, r.muscles.length, `${r.key}: duplicate muscle`); }
  assert.equal(new Set([...AREA_RULES, ...POSE_RULES].map(r => r.key)).size, AREA_RULES.length + POSE_RULES.length, "rule keys are unique");
});
test("areas in a title map to the muscles of that area", () => {
  has("15 Minute Neck & Shoulder Stretch - Gentle Therapeutic Yoga", "sternocleidomastoid", "scalenes", "upper-trapezius", "deltoid", "rotator-cuff"); lacks("15 Minute Neck & Shoulder Stretch - Gentle Therapeutic Yoga", "erector-spinae");
  has("30 min Gentle Yoga (Safe, Soothing Stretches) - LOWER BACK & HIPS RELIEF", "erector-spinae", "quadratus-lumborum", "piriformis", "hip-flexors", "gluteus-maximus"); lacks("30 min Gentle Yoga (Safe, Soothing Stretches) - LOWER BACK & HIPS RELIEF", "latissimus-dorsi", "trapezius-group"); // "lower back" beats the generic "back"
  has("DAY 29 💚 10 min Morning Yoga & Pilates - HIPS & GLUTES - Yogalates Challenge", "gluteus-maximus", "gluteus-medius", "piriformis", "hip-flexors");
  has("DAY 30 💚 15 min Morning Yoga & Pilates - CORE STRENGTH - Yogalates Challenge", "rectus-abdominis", "external-obliques");
  has("DAY 24 💚 15 min Morning Yoga & Pilates - UPPER BODY - Yogalates Challenge", "pectoralis-major", "deltoid", "latissimus-dorsi", "triceps-brachii");
  has("DAY 26 💚 10 min Morning Yoga & Pilates - SPINE & POSTURE - Yogalates Challenge", "erector-spinae", "multifidus", "rhomboids");
  has("30 min Yoga for Tired Legs - Gentle Yoga for Aching Muscles", "quadriceps", "hamstring-group", "gastrocnemius", "soleus");
  has("5 min Yoga Stretches for Wrists - Best Yoga Poses for Wrists", "forearm-flexors", "forearm-extensors");
  has("5 minute Yoga Feet Stretches - Yoga for Your Feet", "plantar-fascia-foot"); has("Yoga for Upper Back Knots! #shorts", "rhomboids", "middle-trapezius");
  has("Yoga for Headaches & Migraine Relief - Gentle Yoga for Tension Headaches", "suboccipitals", "temporalis"); has("5 min Yoga for Sciatica Pain Relief (TOP 5 POSES)", "piriformis");
});
test("muscle names in a title still work, and more specific phrases beat generic ones", () => {
  has("the BEST IT band stretch for runners", "tensor-fasciae-latae"); has("5 min Yoga for Hips - Stretch Psoas & Hip Flexors", "hip-flexors"); has("Yin Yoga for Quads, Thighs & Hip Flexors", "quadriceps", "hip-flexors", "adductor-group");
  has("15 min Pilates Sculpt - Abs & Booty Burn NO PROPS", "rectus-abdominis", "gluteus-maximus"); has("20 min Yoga for Tight Calves & Ankles", "gastrocnemius", "achilles-ankle");
  has("5 min Yoga for Inner Thighs & Groin (TOP 5 POSES)", "adductor-group");
});
test("poses map to the muscles they typically stretch or work", () => {
  has("30 min Intermediate Vinyasa Yoga - Pigeon Pose Flow (HIP OPENERS)", "piriformis", "hip-flexors"); has("PUPPY POSE - The best chest stretch", "pectoralis-major", "pectoralis-minor", "latissimus-dorsi");
  has("Proper LOW LUNGE form - yoga pose tutorial", "quadriceps", "hip-flexors"); has("Triangle Pose DO'S AND DONT'S #Shorts", "hamstring-group"); has("Reclined Hero Pose Tutorial - Supta Virasana Saddle Pose", "quadriceps");
  has("Seated Twist Tutorial - Ardha Matsyendrasana Pose", "external-obliques", "erector-spinae"); has("Crow Pose Tutorial - How To Do Crow Pose For Beginners Bakasana", "triceps-brachii", "rectus-abdominis");
  has("Yoga to FIX Anterior Pelvic Tilt - Lordosis Yoga Poses #shorts", "hip-flexors", "rectus-abdominis"); lacks("Yoga to FIX Anterior Pelvic Tilt - Lordosis Yoga Poses #shorts", "rhomboids", "pectoralis-major");
});
test("look-alike words are NOT body areas (but they do not stop a real target such as Full body from matching)", () => {
  for (const t of ["TRAVEL YOGA – 10 min Standing HANDS FREE Yoga Flow (Hotel, No Mat, Small Space)", "15 min Morning Yoga Stretch - Hands & Wrists Free Yoga",
    "10 min Morning Yoga Stretch - No Hands Yoga Flow", "10 min HANDS FREE Morning Yoga (no downward dog or plank)", "Sacral Chakra Yin Yoga & Affirmations for Creativity & Sensuality", "Root Chakra & Sacral Chakra Guided Meditation",
    "10 min THIRD EYE CHAKRA Morning Yoga - Gentle Morning Yoga", "Doing Yoga With My Dog", "One year with my baby ❤️🐎", "One Leg Circle PILATES TUTORIAL", "Pilates Single Leg Kick Tutorial", "15 min FeetUp Yoga Stretch",
    "Q&A Coffee Chat: Do I want kids? What's my workout routine? Pet peeves? Anxiety?", "Safari Adventures in South Africa!", "1000 THANK YOUS - 1 Hour Gratitude Yoga (My 1000th class!!!)"])
    assert.equal(classifyYoga(t, CATALOG).kind, "skip", t);
  assert.deepEqual(slugsOf("10 min Morning HANDS FREE - Full Body Stretch & Strengthen (no planks, or downward dog)"), ["full-body"]); assert.deepEqual(slugsOf("15 min Yoga Wheel Full Body Stretch"), ["full-body"]); // only the real target survives: no hand muscles, no planks
  assert.equal(slugsOf("10 min SACRAL CHAKRA Morning Yoga - HIP OPENING Yoga")!.includes("piriformis"), true); // the chakra words are ignored, the hip opening stays
  assert.match((classifyYoga("Hello from Scotland!", CATALOG) as any).reason, /No body area/);
  assert.equal(cleanYogaTitle("HANDS-FREE & NO PROPS").replace(/\s+/g, ""), "&");
});
test("Full body is a target of its own: explicit wording and many-areas routines map to it", () => {
  for (const t of ["20 min Full Body Vinyasa - Stretch & Flow", "30 min Total Body Yoga Workout - Yoga Strength & Sculpt", "Yoga for Travel - Jet Lag Yoga to Stretch Your Entire Body!", "15 Minute Pilates Workout - Full Body Mat Pilates (NO PROPS)", "WHOLE BODY stretch"]) assert.deepEqual(slugsOf(t), ["full-body"], t);
  has("Full Body Yoga with a Hips Focus", "full-body", "piriformis"); // a named area is added, not lost
  const c = classifyYoga("Yoga for Neck, Shoulders, Back, Hips, Legs & Core", CATALOG) as any; assert.deepEqual(c.matches.map((m: any) => m.slug), ["full-body"]); assert.match(c.matches[0].reason, /6 areas in the title: a full-body routine/);
  assert.equal(classifyYoga("Yoga for Neck, Shoulders, Back, Hips, Legs & Core", CATALOG.filter(m => m.slug !== "full-body")).kind, "skip"); // without the target it falls back to a skip
  assert.equal(classifyYoga("Yoga for Hips, Lower Back & Hamstrings", CATALOG).kind, "map");
});
test("matches carry a source and a readable reason for the Admin screens", () => {
  const c = classifyYoga("30 min Yin Yoga - Hips & Hamstrings", CATALOG) as any; assert.equal(c.kind, "map");
  const hip = c.matches.find((m: any) => m.slug === "piriformis"), ham = c.matches.find((m: any) => m.slug === "hamstring-group");
  assert.equal(hip.source, "area-rule"); assert.match(hip.reason, /Area "hip"/); assert.ok(ham.confidence >= hip.confidence); // the explicit muscle name outranks the area
});
test(`real channel titles (${TITLES.length}): sensible coverage, and nothing with a clear body word is silently dropped`, () => {
  const mapped = TITLES.filter(t => classifyYoga(t, CATALOG).kind === "map"), skipped = TITLES.filter(t => classifyYoga(t, CATALOG).kind === "skip");
  assert.equal(TITLES.length, 1029); assert.ok(mapped.length >= 370 && mapped.length <= 390, `mapped ${mapped.length}`); const fullBody = mapped.filter(t => slugsOf(t)!.includes("full-body")); assert.equal(fullBody.length, 124, "124 titles say full/total/entire body"); assert.ok(fullBody.every(t => /full|total|entire|whole/i.test(t) || slugsOf(t)!.length === 1), "only explicit wording or many-area routines");
  const BODY = /\b(knees?|ankles?|forearms?|calf|calves|arms?|wrists?|fingers?|legs?|hips?|back|neck|shoulders?|chest|glutes?|quads?|hamstrings?|thighs?|abs|core|spine|spinal|feet|foot|toes?|jaw|groin|psoas|lats?|traps?|obliques?)\b/i;
  const allowed = new Set(["One Leg Circle PILATES TUTORIAL", "Pilates Single Leg Kick Tutorial", "15 min Morning Yoga Stretch - Hands & Wrists Free Yoga", "How To Do A Forearm Stand - Pincha Mayurasana Tutorial & Exercises"]); // deliberate skips (see the look-alike test)
  const leaked = skipped.filter(t => BODY.test(t) && !allowed.has(t)); assert.deepEqual(leaked, []);
  assert.equal(skipped.filter(t => BODY.test(t)).length, allowed.size, "exactly the deliberate skips contain a body word"); // proves the check can see them
  for (const t of mapped) { const c = classifyYoga(t, CATALOG) as any; assert.ok(c.matches.length >= 1 && c.matches.every((m: any) => m.confidence > 0 && m.reason), t); }
});
