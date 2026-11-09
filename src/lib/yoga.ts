import { tokens, hasPhrase, matchVideo, type MuscleDef, type Match, type Classification } from "./matching.ts";
/** Yoga titles name body AREAS ("Hips & Glutes", "Neck & Shoulder") and POSES ("Pigeon Pose"), rarely single muscles. Each rule lists the muscles typically stretched or worked.
 *  The mapping is descriptive of the video's focus area, not a claim about outcomes. Add or edit rules freely; every muscle slug is checked by a test. */
export interface Rule { key: string; phrases: string[]; muscles: string[] }
const GLUTES = ["gluteus-maximus", "gluteus-medius", "gluteus-minimus"], LEGS = ["quadriceps", "hamstring-group", "gastrocnemius", "soleus", "adductor-group"];
export const AREA_RULES: Rule[] = [
  { key: "neck", phrases: ["neck", "cervical"], muscles: ["sternocleidomastoid", "scalenes", "upper-trapezius", "levator-scapulae", "neck-extensors", "suboccipitals"] },
  { key: "shoulders", phrases: ["shoulder"], muscles: ["deltoid", "rotator-cuff", "upper-trapezius"] },
  { key: "upper body", phrases: ["upper body"], muscles: ["pectoralis-major", "deltoid", "trapezius-group", "latissimus-dorsi", "biceps-brachii", "triceps-brachii"] },
  { key: "upper back", phrases: ["upper back", "mid back", "middle back", "thoracic"], muscles: ["trapezius-group", "rhomboids", "middle-trapezius", "lower-trapezius"] },
  { key: "lower back", phrases: ["lower back", "low back", "lumbar"], muscles: ["erector-spinae", "quadratus-lumborum", "multifidus"] },
  { key: "back", phrases: ["back"], muscles: ["erector-spinae", "latissimus-dorsi", "trapezius-group", "rhomboids", "quadratus-lumborum"] },
  { key: "spine", phrases: ["spine", "spinal"], muscles: ["erector-spinae", "multifidus", "quadratus-lumborum"] },
  { key: "pelvic tilt", phrases: ["pelvic tilt"], muscles: ["hip-flexors", "rectus-abdominis", "gluteus-maximus", "hamstring-group", "erector-spinae"] },
  { key: "posture", phrases: ["posture", "postural"], muscles: ["erector-spinae", "rhomboids", "middle-trapezius", "lower-trapezius", "pectoralis-major"] },
  { key: "hips", phrases: ["hip", "hip opener", "hip opening"], muscles: ["hip-flexors", ...GLUTES, "piriformis", "deep-hip-rotators", "adductor-group", "tensor-fasciae-latae"] },
  { key: "glutes", phrases: ["booty", "butt"], muscles: GLUTES },
  { key: "core", phrases: ["core"], muscles: ["rectus-abdominis", "external-obliques", "quadratus-lumborum", "multifidus"] },
  { key: "side body", phrases: ["side body", "side abs", "side stretch", "side bend"], muscles: ["external-obliques", "latissimus-dorsi", "quadratus-lumborum"] },
  { key: "chest", phrases: ["chest opener", "chest opening", "chest stretch"], muscles: ["pectoralis-major", "pectoralis-minor"] },
  { key: "arms", phrases: ["arm"], muscles: ["biceps-brachii", "triceps-brachii", "brachialis", "brachioradialis"] },
  { key: "wrists", phrases: ["wrist", "carpal tunnel"], muscles: ["forearm-flexors", "forearm-extensors"] },
  { key: "fingers", phrases: ["finger"], muscles: ["hand-muscles", "forearm-flexors"] },
  { key: "legs", phrases: ["leg"], muscles: LEGS },
  { key: "lower body", phrases: ["lower body"], muscles: [...GLUTES, "hip-flexors", ...LEGS] },
  { key: "thighs", phrases: ["thigh"], muscles: ["quadriceps", "hamstring-group", "adductor-group"] },
  { key: "feet", phrases: ["feet", "toe"], muscles: ["plantar-fascia-foot"] },
  { key: "sciatica", phrases: ["sciatica", "sciatic"], muscles: ["piriformis", "deep-hip-rotators", "gluteus-maximus"] },
  { key: "headache", phrases: ["headache", "migraine"], muscles: ["suboccipitals", "neck-extensors", "upper-trapezius", "masseter", "temporalis"] },
  { key: "splits", phrases: ["split"], muscles: ["hamstring-group", "hip-flexors", "adductor-group"] },
  { key: "backbends", phrases: ["backbend", "back bend", "heart opener"], muscles: ["rectus-abdominis", "hip-flexors", "pectoralis-major", "erector-spinae"] },
  { key: "twists", phrases: ["twist"], muscles: ["external-obliques", "erector-spinae", "multifidus"] },
  { key: "forward folds", phrases: ["forward fold", "forward bend"], muscles: ["hamstring-group", "erector-spinae", "gastrocnemius"] },
];
export const POSE_RULES: Rule[] = [
  { key: "pigeon", phrases: ["pigeon pose", "pigeon"], muscles: ["piriformis", "gluteus-maximus", "deep-hip-rotators", "hip-flexors"] },
  { key: "lunge", phrases: ["lunge"], muscles: ["quadriceps", "hip-flexors", "gluteus-maximus"] },
  { key: "warrior", phrases: ["warrior"], muscles: ["quadriceps", "hip-flexors", "gluteus-medius"] },
  { key: "triangle", phrases: ["triangle pose"], muscles: ["hamstring-group", "adductor-group", "external-obliques"] },
  { key: "downward dog", phrases: ["downward dog", "downward facing dog"], muscles: ["hamstring-group", "gastrocnemius", "soleus", "deltoid", "latissimus-dorsi"] },
  { key: "cat cow", phrases: ["cat cow", "cat-cow"], muscles: ["erector-spinae", "multifidus", "rectus-abdominis"] },
  { key: "child's pose", phrases: ["child's pose"], muscles: ["erector-spinae", "latissimus-dorsi", "gluteus-maximus"] },
  { key: "cobra", phrases: ["cobra", "sphinx pose"], muscles: ["erector-spinae", "rectus-abdominis", "hip-flexors"] },
  { key: "bridge", phrases: ["bridge pose"], muscles: ["gluteus-maximus", "hamstring-group", "hip-flexors"] },
  { key: "camel", phrases: ["camel pose"], muscles: ["hip-flexors", "rectus-abdominis", "pectoralis-major", "quadriceps"] },
  { key: "wheel", phrases: ["wheel pose"], muscles: ["rectus-abdominis", "hip-flexors", "pectoralis-major", "erector-spinae"] },
  { key: "saddle", phrases: ["saddle pose", "supta virasana", "reclined hero"], muscles: ["quadriceps", "hip-flexors"] },
  { key: "puppy", phrases: ["puppy pose"], muscles: ["pectoralis-major", "deltoid", "latissimus-dorsi"] },
  { key: "happy baby", phrases: ["happy baby"], muscles: ["adductor-group", "hamstring-group"] },
  { key: "frog", phrases: ["frog pose"], muscles: ["adductor-group"] },
  { key: "butterfly", phrases: ["butterfly pose"], muscles: ["adductor-group"] },
  { key: "boat", phrases: ["boat pose"], muscles: ["rectus-abdominis", "hip-flexors"] },
  { key: "plank", phrases: ["plank"], muscles: ["rectus-abdominis", "deltoid", "triceps-brachii"] },
  { key: "side plank", phrases: ["side plank"], muscles: ["external-obliques", "deltoid"] },
  { key: "arm balance", phrases: ["arm balance", "crow pose"], muscles: ["triceps-brachii", "deltoid", "rectus-abdominis", "forearm-flexors"] },
];
// Phrases that look like body parts but are not (checked against real titles): "hands free", "no props", chakras, props, pets. ("full body" itself is now a real target: the catalog entry "full-body".)
const NOISE: RegExp[] = [/\(\s*no\b[^)]*\)/gi, /\bno[\s-]+(hands?|props?|equipment|mat|planks?|downward dog|weights?)\b/gi, /\bhands?(\s*(&|and)\s*wrists?)?[\s-]*free\b/gi, /\bwrists?[\s-]*free\b/gi,
  /\bfeet[\s-]*up\b/gi, /\b(sacral|root|heart|throat|crown|solar plexus|third eye)\s+chakra\b/gi, /\bthird eye\b/gi, /\byoga wheel\b/gi, /\bmy (dog|baby)\b/gi, /\b(one|single|double)[\s-]+legs?\b/gi, /\bkassandra\b/gi, /\bdownward dog or plank\b/gi];
export const cleanYogaTitle = (title: string) => NOISE.reduce((t, re) => t.replace(re, " "), title);
const MAX_RULES = 5; // more areas than this in one title = a full-body routine, not a focus

export function classifyYoga(title: string, catalog: MuscleDef[]): Classification {
  const text = cleanYogaTitle(title), hay = tokens(text);
  type Hit = { phrase: string[]; slugs: string[]; source: string; confidence: number; reason: string; rule: string };
  const hits: Hit[] = [];
  for (const m of matchVideo(text, "", catalog).matches) if (m.where === "title" && m.phrase) hits.push({ phrase: m.phrase, slugs: [m.slug], source: m.source, confidence: m.confidence, reason: m.reason, rule: `muscle:${m.slug}` });
  for (const [rules, source, confidence, what] of [[AREA_RULES, "area-rule", 0.8, "Area"], [POSE_RULES, "pose-rule", 0.7, "Pose"]] as const)
    for (const r of rules) for (const ph of r.phrases) { const t = tokens(ph); if (hasPhrase(hay, t)) { hits.push({ phrase: t, slugs: r.muscles, source, confidence, reason: `${what} "${ph}" in the title`, rule: `${source}:${r.key}` }); break; } }
  const kept = hits.filter(h => !hits.some(o => o !== h && o.phrase.length > h.phrase.length && hasPhrase(o.phrase, h.phrase))); // "lower back" beats "back", "hip flexor" beats "hip"
  if (!kept.length) return { kind: "skip", reason: "No body area, pose or muscle in the title (full-body, meditation, vlog…)" };
  const nRules = new Set(kept.map(h => h.rule)).size;
  if (nRules > MAX_RULES) // many areas named at once = a full-body routine: it belongs on the Full body target instead of on a dozen muscles
    return catalog.some(m => m.slug === "full-body") ? { kind: "map", matches: [{ slug: "full-body", confidence: 0.7, source: "area-rule", reason: `${nRules} areas in the title: a full-body routine`, where: "title" }] } : { kind: "skip", reason: "Too many areas in the title" };
  const best = new Map<string, Match>();
  for (const h of kept) for (const slug of h.slugs) { const o = best.get(slug); if (!o || h.confidence > o.confidence) best.set(slug, { slug, confidence: h.confidence, source: h.source, reason: h.reason, where: "title" }); }
  return { kind: "map", matches: [...best.values()].sort((a, b) => b.confidence - a.confidence) };
}
