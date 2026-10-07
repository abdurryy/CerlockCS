# Contributing to Cerlock

Thanks for wanting to help. Bug reports, demos that break things, ideas from people who actually review demos with their team, and code are all welcome.

For anything bigger than a small fix, open an issue or a [discussion](https://github.com/abdurryy/CerlockCS/discussions) first, so we can agree on the idea before you spend time on it. If you are looking for something to start with, check the [good first issues](https://github.com/abdurryy/CerlockCS/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22).

## Build and run

You need Go 1.25+ and Node 22+.

```sh
git clone https://github.com/abdurryy/CerlockCS
cd CerlockCS
cd web && npm ci && cd ..
make dev
```

`make dev` starts the Go server on `:7350` and the Vite dev server on `:5173`. Open http://localhost:5173, the page reloads by itself when you change frontend code. Go changes need a restart of `make dev`. If your server runs somewhere else, set `CERLOCK_API`, for example `CERLOCK_API=http://127.0.0.1:7400 npm run dev` in `web/`.

Other targets:

```sh
make test    # go vet, go test, svelte-check and vitest, the same checks CI runs
make build   # builds the frontend and bin/cerlock with it embedded
make run     # build and open the viewer
```

The parser test runs against a real demo when you point it at one:

```sh
CERLOCK_TEST_DEMO=/path/to/match.dem go test ./internal/parse
```

Do not commit demos. They are big and the `.gitignore` already skips them. If a bug needs a demo, put a download link in the issue.

## Project layout

```
cmd/cerlock          CLI, server and the Windows app window
internal/parse       single pass demo parser built on demoinfocs
internal/aim         duel windows and aim metrics
internal/analysis    stats, findings, mistakes, win chance and round notes
internal/match       the parsed match model
internal/replay      replay file writer
internal/maps        overview files, radar images and the map cache
internal/pipeline    decompress, parse, analyse, write
internal/faceit      FACEIT API client and the search for games played together
internal/icons       weapon and killfeed icons, downloaded and cached
internal/server      HTTP API, library and background parsing
web/src/components   Svelte components, one per panel or page
web/src/lib          replay reader, viewer state, formatting
web/src/lib/render   the radar: camera, drawing, heatmaps
web/src/lib/scout    scouting: collecting data over many demos and drawing the PNG images
scripts/             radar and icon export from your own game files
```

The flow is: `parse` reads the demo into a `match.Match` in one pass, `analysis` turns that into stats, findings and mistakes, and `replay` writes it all into one file that the browser loads as typed arrays. Scouting runs in the browser on top of the replay files.

## Code style

Go:

- `gofmt` and `go vet` clean. CI runs `go vet`, so run `gofmt` yourself (most editors do it on save).
- Keep the parser to one pass. If you need new data from the demo, collect it in the same pass instead of reading the demo again.
- Comments explain why, in plain sentences.
- Tests next to the code, in the same package. Small fixtures built in code are better than test files.

Svelte and TypeScript:

- Svelte 5 with runes: `$state`, `$derived`, `$props` and `$effect`. No stores and no `export let`.
- No semicolons, single quotes, 2 spaces, trailing commas. Match the code around you.
- Strict TypeScript, `npm run check` has to pass.
- Colours, fonts and radii come from the tokens in `web/src/app.css`. Game things use the real CS2 icons, never emoji. [docs/BRAND.md](docs/BRAND.md) has the full design notes.
- The radar draws on a canvas. Keep work out of the per frame path when it can be done once.

## Text in the app

Any text a user reads (labels, findings, mistake titles, tooltips, image captions) keeps the same plain voice:

- Short sentences and plain words. It should read like notes from a coach who watched the demo twice.
- Conclusion first, number second: "Deaths are not getting traded", then the 13%.
- Dry, never jokey. No exclamation marks.
- Good: "Flashed a teammate, who died 0.8s later." Avoid: "Oops! Looks like someone forgot to communicate!"

Please keep this in PRs too. A PR with good code and loud text will get asked to change the text.

## Example: add a mistake detector

Mistakes (the Evidence tab) live in `internal/analysis/blunders.go`. Every mistake is one moment you can watch, with a cost in win chance.

1. Find the data you need on `a.m` (the `match.Match`): kills, damages, blinds, grenades, bomb events, rounds and per tick tracks. If it is not there yet, add it in `internal/parse` first.
2. Write the check, either inside `blunders()` or as its own function next to `bombBlunders` and `economyBlunders`, and call it from `blunders()`. Report each mistake with `add`:

   ```go
   add(Blunder{
       Kind:     "late_rotate", // snake_case id, used by the frontend
       Severity: Medium,        // Low, Medium or High
       Round:    k.Round,
       Tick:     k.Tick,   // the replay jumps to a few seconds before this
       Player:   k.Victim, // who made the mistake
       Other:    k.Killer, // the other player involved, -1 if none
       Team:     -1,       // -1 means the team of Player
       Title:    "Rotated too late",
       Detail:   fmt.Sprintf("%s died on the way to the site after the plant.", a.name(k.Victim)),
       Pos:      k.VictimPos,
       Cost:     cost(i), // win chance lost, -1 when you cannot tell
   })
   ```

   If the mistake ends in a death, `cost(i)` with the index of that kill gives the win chance it threw away. Otherwise use `-1`.
3. Give it an icon in `KIND_ICON` in `web/src/components/EvidencePanel.svelte` (it falls back to the skull), and add a case to `gear()` if there is a weapon or grenade to show.
4. Add a test in `internal/analysis/analyzer_test.go`. `fixture()` builds a small 5v5 round you can change for your case.
5. Run it on a few real demos and check that every mistake it finds is one a coach would point at. Few and right beats many and noisy.

## Example: add a scouting image

The scouting images are drawn in the browser, in `web/src/lib/scout`.

1. **Data.** `aggregate.ts` (`ScoutBuilder`) walks every replay of a map and fills a `MapScout` (`types.ts`). If your image needs something new, collect it there and add the field to `MapScout`.
2. **Kind.** Add a name to `ScoutKind` and `SCOUT_KINDS` in `render.ts`.
3. **Card.** In `planCards` in `render.ts`, add a block with `add('your-kind', () => ...)`. Use `heatCards` for heat over the map or `markCards` for marks like kills or grenades, and describe the image with `draft({ ... })`: file name, title, side, the line under the title (`bits`), the numbers along the bottom (`footer`) and the legend. `poster.ts` does the drawing, so most images need no drawing code at all.
4. **Gallery.** Put the kind in one of the `SECTIONS` in `web/src/components/ScoutGallery.svelte`, or it lands under "More" in the report.
5. **Test.** Add a test for the new data in `aggregate.test.ts`. The `build` helper there writes a small replay in memory.
6. **Look at it.** Open a demo, click "Export heatmaps", or build a report on the Scout page, and check the image at full size next to the others. Images should read on a phone in a team Discord.

## Pull requests

- One change per PR, with a short description of what and why. Screenshots for anything visual.
- `make test` passes.
- Commit messages are short and plain, like the ones in `git log`: "Find late rotations", "Fix pistol rounds for wingman".
- If you add something users will notice, say so in the PR so it makes it into the changelog, and update the README if it belongs there.

By contributing you agree that your code is released under the [MIT license](LICENSE).
