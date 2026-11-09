// Starts the real server on an in-memory DB seeded with clearly labelled TEST videos (not creator content).
import { openDb, seedCatalog } from "../src/lib/db.ts";
import { importVideo } from "../src/lib/admin.ts";
import { ensureDefaultChannels } from "../src/lib/channels.ts";
import { createServer } from "../src/server.ts";
const db = openDb(); seedCatalog(db); ensureDefaultChannels(db);
// No manual assignment: the muscle is read from each title, exactly like a sync would do.
importVideo(db, { url: "https://www.youtube.com/watch?v=testQuad001", title: "[TEST] How to release your quads", publishedAt: "2026-03-01" });
importVideo(db, { url: "https://www.youtube.com/watch?v=testBack002", title: "[TEST] <img src=x onerror=alert(1)> Lower back", publishedAt: "2026-03-02" }); // no muscle -> skipped
importVideo(db, { url: "https://www.youtube.com/watch?v=testTrap003", title: "[TEST] How to release your upper traps", publishedAt: "2026-03-03" });
importVideo(db, { url: "https://www.youtube.com/watch?v=testShld004", title: "[TEST] Shoulder tightness", publishedAt: "2026-03-04" }); // no muscle -> skipped
// Yoga collection: matched by body area from the title (neck -> several neck muscles incl. upper traps, which the muscle-release video above also covers)
importVideo(db, { url: "https://www.youtube.com/watch?v=testYogN005", title: "[TEST] Yoga for the Neck - 10 minute stretch", publishedAt: "2026-03-05", collection: "yoga" });
importVideo(db, { url: "https://www.youtube.com/watch?v=testYogW006", title: "[TEST] Yoga for Wrists", publishedAt: "2026-03-06", collection: "yoga" });
importVideo(db, { url: "https://www.youtube.com/watch?v=testYogF007", title: "[TEST] 20 min Full Body Vinyasa - Stretch & Flow", publishedAt: "2026-03-07", collection: "yoga" }); // "Full Body" -> its own target
createServer({ db, apiKey: "E2E-SECRET-KEY-1234", dataDir: "/tmp" }).listen(4567, "127.0.0.1", () => console.log("ready"));
