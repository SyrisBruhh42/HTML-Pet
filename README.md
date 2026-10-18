# HTML-Pet

HTML-Pet is a browser-based pixel slime companion experiment. Its intended scope includes pet care and progression through food, farming and equipment. Treat playability, progress recovery and offline behavior as prototype qualification work.

This is the independent browser project. Keep it separate from native PC-Pet and LFS companion projects unless the owner explicitly requests shared assets or behavior.

## Find your starting point

| Entry | Purpose |
| --- | --- |
| [index.html](index.html) | Browser page entry point |
| [js/](js/) | Application modules |
| [css/](css/) | Styles |
| [AGENTS.md](AGENTS.md) | Contributor and AI startup guidance |

## Run locally

Open `index.html` in a modern browser, or use a local static server from this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Visit `http://127.0.0.1:8000/`. Keep using the same address, port, browser and profile: each origin has separate browser storage. File URLs can have browser-specific storage behavior; the page reports failures and pauses instead of claiming a successful save. No account or backend is required.

## Care and progression

The current engineering tuning combines care with persistent growth:

- Food restores hunger and contributes its actual quality toward levels. One feeding grants every level earned, retaining leftover quality. Existing level growth still increases size, maximum health and refills health.
- Care time accumulates while hunger and health are each at least 90% of their maximum. Credit pauses below either threshold; it is not erased. Each 24 hours of banked care makes one feeding grant **10 permanent maximum HP**, restore up to 10 HP, and consume one 24-hour credit. Several credits can be redeemed by several feedings.
- Hunger falls by 4% of its maximum per hour; health falls by 1% of its maximum per hour. Time decay and new raid damage cannot reduce a positive pet below 1 HP. Existing zero-HP saves remain zero until healed or levelled; their progress is preserved.
- Food ages during play and while away. Its quality follows the existing curve, reaching half quality after 24 hours and never falling below half. Harvested food has its own fresh batch; older food is eaten first.
- Crops grow across the full elapsed absence. There is no arbitrary absence cap: hunger and health have floors, crops stop at maturity, and eligible care time ends when a threshold is crossed. Levels, food counts, gold, purchased plots and banked care are retained.
- Automatic raids run every 90 seconds of visible, unsuspended play. The unfinished timer is saved. Hidden pages, closed games and frame gaps longer than five seconds do not queue raids. Manual raid checks remain available in the event log.
- A backward system-clock adjustment pauses time progress until the previously recorded time is reached. A visible notice explains this; time cannot reverse decay or replay already-accounted progress.

These are developer-selected tuning defaults for the care-and-progression direction. They are documented here so later balance changes are deliberate and testable.

## Equipment and garden purchases

The shop now offers permanent equipment ownership and one equipped defense item. Purchase and equip are separate actions; removing equipment keeps it owned. Current developer-selected tuning is Leaf Shield at level 1 for 60 gold (+1 defense), Shell Shield at level 3 for 180 gold (+2), and Crystal Shield at level 5 for 420 gold (+4). The active item appears beside the pet and in its accessible description. Its bonus affects ordinary defense checks; natural 1 remains a critical failure, natural 20 remains a critical win, and care/level/offline rules are unchanged.

Every purchased plot has a separate garden position and full Farming controls. The camera fits the expanded garden into the screen; the Farming list remains usable when a large garden is visually small. Plots cost 100 gold. A 30-gold healing kit restores up to 30 HP and is unavailable at full health, so a healthy pet cannot accidentally spend gold on it. Failed, locked or duplicate purchases retain gold; save failures preserve in-memory progress under the existing recovery flow.

Equipment uses the optional `equipmentLoadout` record (version 1) inside version-2 saves. Older saves with no record remain valid and start without equipment; unrelated historical extension fields remain intact. Invalid, duplicate, unowned or unsupported equipment records pause loading and preserve the original bytes. No migration or reseeding of existing food, care, gold or plots is required.

## Save and recovery

The game uses version 2 saves at the existing `pixel_pet_save_v1` browser key. Valid old saves migrate without reseeding inventory or clearing progress. A byte-exact copy of the old save must be written and read back before migration can replace it. Additional fields, including future equipment records, are carried through migration.

Malformed or unsupported saves pause gameplay and remain untouched. Storage read/write failures and detected conflicting tabs are visible. A failed write retains the current in-memory pet for download. Use **Save, backup and recovery** to download the current pet, the originally loaded bytes, or a preserved recovery copy; import a valid backup file or paste its text; retry saving; or explicitly start a new pet. Import and new-pet actions first preserve the stored bytes and refuse replacement when that copy fails. Recovery copies can be downloaded and re-imported. Export also exposes the exact backup text for copying when browser downloads are blocked.

Restoring a backup or starting a new pet opens an in-page review dialog. It names the candidate pet and shows its level, gold and garden size. Cancel receives initial keyboard focus; Escape cancels, and focus returns to the action that opened the review. Nothing is replaced until **Preserve progress and restore** (or **Preserve progress and start new pet**) is explicitly activated. The native HTML dialog keeps background controls inert; browsers lacking this support refuse the action visibly.

The exact candidate text stays available for copying after a failed restoration, and pasted/file-import text is only cleared after success. Errors appear in the page and in the review, with keyboard focus on the error. If current progress differs from the stored save, both versions must receive verified recovery copies before replacement. Recovery storage failure, writer-session loss or changed stored bytes keeps replacement held. A failed storage readback can leave the write outcome uncertain; keep the backup and recovery copies, then retry/reload deliberately.

The game holds an exclusive Web Locks save session for its lifetime. A second game tab is read-only until the first closes and the second reloads. Browsers or origins without Web Locks remain read-only; use a supporting modern browser on localhost or HTTPS. The game also checks stored bytes before writing and pauses on external changes. A different/older application that ignores this lock is outside that cooperative single-writer guarantee. Download backups regularly, especially before moving browsers, changing the local address or clearing browser data. Recovery copies share the same browser storage and cannot survive its deletion. Saves are written after actions, about every five seconds, and when the page hides; a browser/process crash can lose the latest unsaved interval.

## Verification

Run the dependency-free domain/storage regressions with Node 18 or newer:

```sh
node --test tests/*.test.cjs
```

The suite covers legacy migration and exact recovery bytes, corrupt/future saves through startup, denied reads and quota failures, import, competing writers, reachable care rewards with restart persistence, level overflow, fresh harvest batches, live/away time, rollback and text-only event logs. These are synthetic checks, not browser acceptance.

For manual browser verification, serve the directory and open `tests/browser-fixtures.html`. Its explicit buttons launch the real page in an embedded frame with isolated fixture storage for legacy, corrupt, unsupported-version, denied-read, quota-failure and backward-clock cases. Fault injection is confined to this test page; it is not part of the application entry point. Normal play should also be checked separately: feed by keyboard, plant, wait for maturity with Farming open, harvest, reload and confirm progress.

The October 18 implementation is a local candidate. Browser and test results belong to the accompanying implementation receipt; a document or passing domain test does not establish merge, deployment or full product acceptance. Full economy/raid balance, native recovery-dialog verification, complete accessibility/mobile qualification and release acceptance remain part of the broader product scope.

## Start a task

Read [AGENTS.md](AGENTS.md), identify the requested outcome and inspect the relevant source. Keep this browser game independent of native PC-Pet and LFS companion work. Numeric balance changes require an explicit recorded engineering decision and regression evidence for care, restart persistence, recovery and away-time behavior.

## Optional portfolio context

[Project Office](https://github.com/SyrisBruhh42/Project-Office/blob/main/hub/START-HERE.md) is the coordination entry point for authorized collaborators. Select route `html-pet` and mission `MISSION-HTML-PET` to recover recorded context, next actions and authority boundaries. Office access may be private; it is not required to read this repository or its startup guidance.

When Office is unavailable, continue from this repository’s applicable instructions and the authorized task. State any missing context explicitly. Do not copy private Office records, conversations or operational history into public source, issues or pull requests. An Office record is coordination context, not permission to expand the source task or a substitute for source evidence.

<!-- lfs-alignment:begin v1 -->
## LFS alignment

Project role: Independent browser pixel-slime pet experiment.

This project keeps its own purpose and required features while sharing useful LFS practices: clear ownership, reusable capabilities, scoped access, evidence-based validation and recoverable work. Adopting these practices does not make this repository a deployed LFS service.

Use this README and local project documentation for scope, setup and status. Contributor guidance is in [AGENTS.md](AGENTS.md). A policy update is not proof of tested or delivered functionality.
<!-- lfs-alignment:end -->
