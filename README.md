# CerlockCS

A fast CS2 demo viewer and review tool for teams.

Drop in a demo and watch every round on a 2D radar. Follow any player around the map, see every smoke, flash and molotov, and get a list of things the team (or a single player) should work on. Every finding links to the exact moment in the demo, so you can click it and watch what happened.

![Viewer](docs/viewer.png)

## Features

**Replay**
- Players as circles with view direction, health, weapon, utility and money
- Smokes with a countdown ring, molotov fire, HE and flash pops, grenade trajectories, shot tracers, kill lines and the bomb
- Lines from each flash to the players it blinded, with the blind time (red if it was a teammate)
- Follow a player by clicking them or pressing 1 to 0. Optionally rotate the map with their view
- Team vision: only show the enemies the followed player's team could actually see
- Ghosts: where a team stood at the same point in every other round on the same side, good for spotting setups and habits
- Heatmaps for positions, kills and deaths, per player or per team
- Two level maps (Nuke, Train, Vertigo) switch floor automatically

**Team review**
- Opening duels, traded deaths, rounds won after the first kill, pistols, eco and anti-eco rounds, post-plants and retakes, utility per round, team flashes and unused utility
- Findings like "Deaths are not getting traded" or "Losing anti-eco rounds", each with the rounds and ticks it is based on

**Player report**
- K/D/A, ADR, KAST, HLTV 1.0 rating, opening duels, trades, isolated and early deaths, clutches, flash stats and more
- Personal findings, for example dying where nobody can trade, flashing teammates or crosshair placement

**Aim**
- Every duel is cut out at full tick rate and measured: crosshair placement when the enemy showed up, reaction time to the first shot, time to damage, first shot error and flick size
- A chart of how far the crosshair was from the enemy's head over the whole fight
- Numbers are compared against everyone else in the same game

![Aim](docs/aim.png)

**Library**
- Drag and drop a demo, or point the server at a folder (for example your CS2 replays folder) and new demos are parsed in the background
- Reads `.dem` as well as compressed `.dem.gz`, `.dem.bz2` and `.dem.zst` (FACEIT and Valve MM)

## Speed

Demo processing usually takes a long time in other tools, so this was the main thing I designed around. Measured on a 4 core machine:

| Demo | Size | Parse + analysis | Replay file |
| --- | --- | --- | --- |
| FACEIT 5v5, Nuke, 64 tick | 299 MB | 7.1 s | 2.5 MB |
| Matchmaking, Ancient | 39 MB | 3.0 s | 1.6 MB |
| Matchmaking, Anubis | 32 MB | 2.5 s | 1.2 MB |
| Wingman, Overpass (gzipped upload) | 20 MB | 0.9 s | 0.5 MB |

Opening a replay that is already parsed takes around 120 ms in the browser (about 350 ms the first time, when the map image is fetched).

What makes it fast:

- **One pass over the demo.** Positions, events, grenades and the aim windows are all collected in the same pass. The hot loop reads entity properties directly instead of going through helpers that look up the same entity many times, which cut parse time on the big demo from 12.3 s to 7.1 s.
- **Parsing while uploading.** The server parses the upload as a stream, so the replay is ready right after the last byte arrives.
- **No duplicate work.** A demo is identified by its size and first megabyte. The browser computes the same fingerprint, so a demo that was parsed before opens instantly without uploading anything.
- **A replay format the browser does not need to parse.** A small JSON header plus raw typed columns (positions, angles, health...), gzipped. The browser wraps them in typed arrays without copying.
- **Background parsing.** Demo folders are watched and new demos are parsed in parallel, so they are ready before you open them.
- **A light frontend.** Svelte compiles away, so there is no virtual DOM. The radar is a canvas running at 60 fps, while the side panels only update about 15 times per second.

Before picking the parser I also tried demoparser2 (Rust) on the same 299 MB demo. Getting ticks, events and grenades took 9.6 s since each one is a separate pass, so the single pass approach with demoinfocs ended up faster for this use case.

## Tech stack

| Part | Choice | Why |
| --- | --- | --- |
| Demo parsing | Go + [demoinfocs-golang](https://github.com/markus-wa/demoinfocs-golang) | Mature CS2 parser with a full game state (grenades, infernos, spotted flags, view angles), easy to run everything in one pass |
| Server | Go standard library | One binary with the frontend embedded, nothing else to install |
| Frontend | Svelte 5, TypeScript, Vite | Small bundle (about 47 kB gzipped) and fine grained updates |
| Rendering | Canvas 2D | Plenty for 10 players and a few dozen effects at 60 fps, no WebGL needed |
| Replay format | Own binary format | Typed columns that load straight into the browser |

## How the maps are rendered

CS2 ships a 1024x1024 radar image for every map and an overview file (`resource/overviews/<map>.txt`) that says where the image sits in the world. It has the world position of the top left corner and how many world units one pixel covers:

```
"de_mirage"
{
    "pos_x"   "-3230"
    "pos_y"   "1713"
    "scale"   "5.00"
}
```

So a world position becomes a radar pixel with:

```
px = (x - pos_x) / scale
py = (pos_y - y) / scale     (y is flipped, world y goes up and image y goes down)
```

Maps with two floors (Nuke, Train, Vertigo) have a second image and an altitude where the floors meet. Nuke uses the lower image below z = -495. The viewer picks the floor of the followed player, or you can switch with `L`. Players on the other floor are drawn faded.

Where the images come from:

1. The server downloads the radar image and overview file the first time a map is opened and caches them in `~/.cerlock/maps`. The source is [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons), which pulls them from the game depot after every CS2 update, so new maps and map updates show up without changes here.
2. You can export them from your own game files with `scripts/extract-radars.sh` (or `.ps1` on Windows). It uses [Source2Viewer-CLI](https://github.com/ValveResourceFormat/ValveResourceFormat) to decompile `panorama/images/overheadmaps/*.vtex_c` to PNG.
3. If there is no image at all (offline, a custom map), the viewer draws a floor plan from everywhere the players walked in the demo. It is surprisingly readable. The active duty maps also have their calibration built in, so positions stay correct without the overview file.

## Aim analysis

For every fight the parser keeps a short window of the attacker's view angles and both players' positions at full tick rate (2 seconds before the first hit until the kill). From that it calculates:

- **Crosshair placement**: the angle between where the attacker was looking and the enemy's head at the moment the enemy was spotted
- **Reaction time**: spotted to first shot. Shots under 80 ms are counted as prefires instead
- **Time to damage**: spotted to first hit
- **First shot error** and **flick size**
- Duels won and lost, duels lost without firing, accuracy inside duels

"Spotted" comes from the game's own radar spotting (`m_bSpottedByMask`), which can be a few ticks behind real line of sight. The raw samples (yaw, pitch and angle to the head per tick) are stored in the replay, so new metrics can be added without parsing the demo again. Things I want to add next:

- Exact line of sight from the map's collision mesh, instead of radar spotting
- Spray control, using the recoil index and the shot pattern per weapon
- Counter strafing, by looking at velocity at the moment of each shot

## Getting started

You need Go 1.25+ and Node 22+.

```sh
git clone https://github.com/abdurryy/CerlockCS
cd CerlockCS
make build
./bin/cerlock serve --open
```

Then drop a demo on the page. To have demos parsed automatically, point the server at a folder:

```sh
./bin/cerlock serve --demos "C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\replays"
```

Other options:

```
--addr      address to listen on (default 127.0.0.1:7350)
--data      where replays and map images are stored (default ~/.cerlock)
--demos     folder with demos, can be given more than once
--offline   never download radar images
--workers   demos parsed at the same time
```

There is also a CLI mode that only parses, handy for benchmarking:

```sh
./bin/cerlock parse match.dem
```

### Development

```sh
make dev     # Go server on :7350 and Vite on :5173 with hot reload
make test    # go vet, go test, svelte-check and vitest
```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Left / Right | Back / forward 5 seconds (Shift for 1 second) |
| P / N | Previous / next round |
| [ / ] | Slower / faster |
| 1 - 0 | Follow a player |
| Esc | Stop following |
| R | Rotate the map with the followed player |
| V | Team vision |
| G | Ghosts |
| H | Names |
| L | Switch floor |

## Project layout

```
cmd/cerlock          CLI and server entry point
internal/parse       single pass demo parser built on demoinfocs
internal/aim         duel windows and aim metrics
internal/analysis    stats and findings
internal/match       the parsed match model
internal/replay      replay file writer
internal/maps        overview files, radar images and the map cache
internal/pipeline    decompress, parse, analyse, write
internal/server      HTTP API, library and background parsing
web/                 Svelte frontend
scripts/             radar export from your own game files
```

## Credits

- [demoinfocs-golang](https://github.com/markus-wa/demoinfocs-golang) for the demo parsing
- Radar images and overview data belong to Valve. They are not stored in this repository
- Test demos from the demoinfocs test set ([cs-demos-2](https://gitlab.com/markus-wa/cs-demos-2))
