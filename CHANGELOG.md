# Changelog

## v0.3.1

Longer situation videos and all of them in one click.

New:

- Situation videos now run from freeze time to the end of the round instead of the first 30 seconds. Rounds that are over fade out, and the time bar shows the real round clock
- Save all videos: one button makes the video of every round type on every map and saves them in folders, like `Downloads\Cerlock\<team>\mirage\ct\eco-rounds.mp4`. It shows how long is left, can be cancelled, keeps going in the corner and opens the folder when it is done
- Pick the video length: whole round, first 60 s or first 30 s
- 4x speed in Watch

How to run it:

- Windows: download `cerlock-windows-amd64.exe` and double click it. Windows may warn about an unknown publisher since the exe is not signed, click "More info" and then "Run anyway".
- Linux and macOS: download the `.tar.gz` for your system, extract it and run `./cerlock`.

## v0.3.0

Scouting by round type, videos of their rounds and their spots in game.

New:

- Rounds split by side and buy: pistol, eco, force, anti-eco and full buys. Each one shows where the team stands in the first 10 and 20 seconds, how often they rush, stack a site, push early or save
- Watch: all rounds of one situation on the map at the same time, with utility, kills and where every player looks. Pick rounds, highlight a player, change the speed, and save it as an MP4 (WebM when the browser has no H.264) or a PNG frame
- Roles per player: A anchor, B anchor, rotator, AWP or mid on CT, entry, lurker, support or AWP on T, with how many rounds it is based on
- Tendencies: the strongest patterns of the team in plain words, with a button to copy them for Discord
- Spots in game: where each player usually stands and looks, as `setpos` and `setang` commands, and a `.cfg` with an alias per spot. `spot_next` walks through all of them on a practice server
- A CS2 button on every round in Watch copies `demo_gototick` for that moment, and `spec_player` for the highlighted player
- New PNG images: one per round type and one per side with the spots

How to run it:

- Windows: download `cerlock-windows-amd64.exe` (or `cerlock-v0.3.0-windows-amd64.exe`) and double click it. Windows may warn about an unknown publisher since the exe is not signed, click "More info" and then "Run anyway".
- Linux and macOS: download the `.tar.gz` for your system, extract it and run `./cerlock`.
- For scouting you need a free FACEIT API key from developers.faceit.com, paste it in the Scout page.

## v0.2.0

Scouting, a real Windows app and a new look.

New:

- Scout a team: paste a FACEIT match room or team link, Cerlock finds the games where their players queued together (4 or 5 of them), shows their map pool and links every match room
- Demos you download from FACEIT are picked up from your Downloads folder by themselves and matched to the players by SteamID
- Scouting report per map with PNG exports: summary card, team heatmaps, T executes per site with utility and plants, post plant and retake, opening duels, utility with throw lines, pistol and eco rounds, AWP spots, kills and deaths, and early CT and T positions for every player. Download one by one or as a zip
- Export heatmaps from a single demo: one image per player of the team you pick
- On Windows Cerlock now opens in its own app window with its own icon, no console. Pin it to the taskbar like any app. Closing the window quits it
- New logo, new fonts and a darker, sharper look everywhere
- Real CS2 icons for weapons, grenades, armor, kit and bomb in the roster, killfeed and on the map, plus headshot, wallbang, no-scope, through smoke and blind icons in the killfeed
- New map style, cleaner player tokens, bombsite badges, callouts, and grenade icons on the radar
- Side panels redone with clearer stats and icons

How to run it:

- Windows: download `cerlock-v0.2.0-windows-amd64.exe` and double click it, or the zip with `Cerlock.exe`. Windows may warn about an unknown publisher since the exe is not signed, click "More info" and then "Run anyway".
- Linux and macOS: download the `.tar.gz` for your system, extract it and run `./cerlock`.
- For scouting you need a free FACEIT API key from developers.faceit.com (make an app, then a server side key) and paste it in the Scout page.

## v0.1.0

First release of CerlockCS.

What's in it:

- 2D radar replay of CS2 demos with smokes, flashes, molotovs, kills and a camera that follows any player
- Evidence: single mistakes found in every round (team flashes, crossfires, reload deaths, late defuses and more) with how much win chance each one cost
- Win chance for every moment of a round, round stories, map control per callout and a report for every player
- Aim stats for every duel: crosshair placement, reaction time, time to damage
- Real CS2 weapon and utility icons on the radar, the roster and the killfeed

How to run it:

- Windows: download `cerlock-v0.1.0-windows-amd64.exe` and double click it. The viewer opens in your browser and demos in your CS2 replays folder show up by themselves. Windows may warn about an unknown publisher since the exe is not signed, click "More info" and then "Run anyway".
- Linux and macOS: download the `.tar.gz` for your system, extract it and run `./cerlock`.

The rest of the new look and the new logo come in the next version.
