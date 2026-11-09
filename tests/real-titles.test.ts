// Regression fixture: real upload titles of the configured channel (public metadata supplied by the user), with the expected outcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyUpload } from "../src/lib/matching.ts";
import { CATALOG } from "../src/lib/catalog.ts";
const H = "hand-muscles";
const MAPPED: [string, string[]][] = [
 ["How to Release the Abductor Digit Minimi Muscle On Your Own!", [H]], ["How to Release Your Diaphragm On Your Own!", ["diaphragm"]], ["How to Release the Brachioradialis On Your Own!", ["brachioradialis"]],
 ["How to Release Your Teres Minor Muscle (Ft. The Rollga Foam Roller)", ["teres-minor"]], ["How to Release Serratus Posterior Inferior On Your Own (Part 79)", ["serratus-posterior-inferior"]],
 ["How to Release the Sternalis Muscle On Your Own! (Part 78)", ["sternalis"]], ["How to Release Teres Minor On Your Own!", ["teres-minor"]], ["How to Release the Coracobrachialis On Your Own! (Part 76)", ["coracobrachialis"]],
 ["How to Release Your Iliac Muscle On Your Own!", ["hip-flexors"]], ["How to Release Your Abdomen With Myofascial Release", ["external-obliques", "rectus-abdominis"]],
 ["How to Release Your Opponens Pollicis Muscle (Part 75)", [H]], ["How to Release the Infraspinatus On Your Own! Part 73", ["infraspinatus"]], ["How to Release Lumbricals On Your Own! Part 72", [H]],
 ["How to Release the Extensor Hallucis Longus Tendon! (Part 67)", ["extensor-hallucis-longus"]], ["How to Release Your Teres Major On Your Own! (Part 64)", ["teres-major"]], ["Jaw Self-Care (Release the Masseter Muscle)", ["masseter"]],
 ["How to Release Your Splenius Cervicis Muscle (Part 63)", ["neck-extensors"]], ["How to Release Fascia On Your Own: Thoracolumbar Fascia", ["erector-spinae"]], ["How to Release Your Depressor Anguli Oris Muscle (Part 60)", ["depressor-anguli-oris"]],
 ["How to Release the Posterior Tibialis (Part 59)", ["tibialis-posterior"]], ["How to Release Your Anconeus Muscle (Part 57)!", ["anconeus"]], ["Part 56: Achilles Tendon Release", ["achilles-ankle"]],
 ["How to Release Your Dorsal Intercrossei Muscles in the hand!", [H]], ["How to Release Muscles On Your Own! Part 54: Extensor Digitorium Longus", ["extensor-digitorum-longus"]], ["How to Release the Frontalis Muscle On Your Own!", ["frontalis"]],
 ["How to Release your Extensor Carpi Radialis Longus (Part 52)", ["forearm-extensors"]], ["How to Release Fascia On Your Own! Part 12: Ankle", ["achilles-ankle"]], ["How to Release Fascia On Your Own! Part 11: Knee", ["knee-region"]],
 ["How to Release Fascia On Your Own: Plantar Fascitis (Pt. 4)", ["plantar-fascia-foot"]], ["How to Release Fascia On Your Own: Headache/Neck and Jaw Tension (Pt. 3)", ["masseter"]],
 ["How to Release Your Pectineus Muscle! (Part 51)", ["adductor-group"]], ["How to Release the Gluteus Minimus", ["gluteus-minimus"]], ["How to Release the Gluteus Minimus Muscle (part 50)", ["gluteus-minimus"]],
 ["How to Release the Patellar Tendon (Part 49)", ["knee-region"]], ["How to Release Your Digastric Muscle (Part 47)!", ["digastric"]], ["How to Release the Plantar Aponeurosis (part 45)!", ["plantar-fascia-foot"]],
 ["How to Release the Iliacus Muscle (part 44)!", ["hip-flexors"]], ["How to Release the Abductor Digiti Minimi Manus (pinkie muscle)", [H]], ["How to Release Your Serratus Anterior Muscle", ["serratus-anterior"]],
 ["How to Release Your Mylohyoid Muscle", ["mylohyoid"]], ["How to Release the Subscapularis Muscle", ["subscapularis"]], ["How to Release Your Corrugator Supercilli (aka your eyebrow muscles)", ["corrugator-supercilii"]],
 ["How to Release Your Nasalis Muscle", ["nasalis"]], ["How to Release Your Procerus Muscle", ["procerus"]], ["How to Release the Gracilis Muscle", ["adductor-group"]],
 ["How to Release Your Suboccipital Muscles (lower head/cranial muscles)!", ["suboccipitals"]], ["How to Release Scalene Muscles (neck)!", ["scalenes"]], ["How to Release the Flexor Carpi Ulnaris Muscle (forearm muscle)!", ["forearm-flexors"]],
 ["How to Release Your Temporalis Muscle", ["temporalis"]], ["How to Release Your Intercostal Muscles!", ["intercostals"]], ["How to Release Your Piriformis Muscle", ["piriformis"]],
 ["How to Release Your Extensor Muscles!", ["forearm-extensors"]], ["How to Release Your Splenius Capitis Muscle!", ["neck-extensors"]], ["How to Release the Infraspinatus Muscle (Part 9)", ["infraspinatus"]],
 ["How to Release Your Pectoral Major Muscle (Part 8)", ["pectoralis-major"]], ["How to Release Your Anterior Tibialis (Part 4)", ["tibialis-anterior"]], ["How to Release Your Masseter Muscle", ["masseter"]],
];
const SKIPPED = [ // no release word, or release of something that is not a single muscle (left for the user to assign by hand)
 "What is Fascia? Why it’s important and what you can do about it!", "Join the Elite Community for Long Form Content and Support!", "Here is some general advice I give my clients with chronic pain or injuries as an LMT!",
 "How to Prevent Back Spasms On Your Own!", "Hypermobility Advice", "My Pre-Massage Work Routine for Mobility!", "Decrease Your Period Cramping w/ Massage", "My Daily Injury Stretching Routine", "How to Stretch the Top of Your Wrists!",
 "Decrease Your Leg Cramps (Pt 1)", "How to Improve Your Neck Posture!", "Facial Cupping Crash Course", "How to Loosen Sore Arms On Your Own!", "How do massage guns work and are they worth investing in?", "How to Make Your Own Elderberry Syrup!",
 "Correct Your Slouching!", "How to Prevent Knee Injuries On Your Own!", "How to stretch your ankle extensors all on your own!", "About Me", "How to Improve Your Plantar Fascitis (pt.1)", "How to correct Your Anterior Pelvic Tilt (Part 1)",
 "How to Release Your Ulnar Collateral Ligament (Part 70)!", "How to Release Fascia On Your Own! Part 10: Shoulder", "How to Release Fascia On Your Own! Part 9: Cup Gliding", "How to Release Fascia On Your Own! Part 8: Elbow",
 "How to Release Fascia On Your Own! Cupping Edition", "How to Release Fascia at the Wrist!", "How to Release Fascia On Your Own! Part 5: Gliding", "How to Release Fascia On Your Own through Graston/Scraping (Pt. 2)",
 "How to Release Your Own Fascia through Skin Rolling (Pt. 1)", "How to Release Your Collarbone Area",
];
test(`real titles: ${MAPPED.length} release videos map to the expected muscles`, () => {
  for (const [title, want] of MAPPED) { const c = classifyUpload(title, CATALOG, ["release"]); assert.equal(c.kind, "map", `should map: ${title}`);
    assert.deepEqual((c as any).matches.map((m: any) => m.slug).sort(), [...want].sort(), title); }
});
test(`real titles: ${SKIPPED.length} non-release or non-muscle titles are skipped`, () => {
  for (const t of SKIPPED) assert.equal(classifyUpload(t, CATALOG, ["release"]).kind, "skip", `should skip: ${t}`);
});
