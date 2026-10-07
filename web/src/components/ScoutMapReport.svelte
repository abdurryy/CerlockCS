<script module lang="ts">
  import type { Picture } from './ScoutGallery.svelte'

  export interface ImageSet {
    stage: 'waiting' | 'drawing' | 'saving' | 'done' | 'error'
    done: number
    total: number
    pictures: Picture[]
    error?: string
  }
</script>

<script lang="ts">
  import { mapLabel } from '../lib/format'
  import type { MapScout, PlaceShare } from '../lib/scout/types'
  import { EQ } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'
  import ScoutGallery, { groupScout } from './ScoutGallery.svelte'
  import ScoutIcon from './ScoutIcon.svelte'

  // One map of the scouting report: what the team does there, then the
  // images.
  let {
    scout,
    set,
    teamName,
    early,
    zipping,
    onzip,
    onretry,
  }: { scout: MapScout; set: ImageSet | undefined; teamName: string; early: number; zipping: boolean; onzip: () => void; onretry: () => void } = $props()

  const m = $derived(scout)
  const ctPct = $derived(m.ctRounds ? Math.round((m.won.ct / m.ctRounds) * 100) : 0)
  const tPct = $derived(m.tRounds ? Math.round((m.won.t / m.tRounds) * 100) : 0)
  const groups = $derived(groupScout(set?.pictures ?? [], early))
  const drawing = $derived(!set || set.stage === 'waiting' || set.stage === 'drawing' || set.stage === 'saving')
  let sections: HTMLElement[] = $state([])

  function jump(i: number) {
    sections[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Two players on the same spot read better as "Outside x2".
  function spots(places: string[]): { place: string; n: number }[] {
    const out: { place: string; n: number }[] = []
    for (const p of places) {
      const last = out[out.length - 1]
      if (last && last.place === p) last.n++
      else out.push({ place: p, n: 1 })
    }
    return out
  }

  function share(n: number, of: number): string {
    return of ? `${Math.round((n / of) * 100)}%` : '-'
  }

  function top(list: PlaceShare[], n = 3): PlaceShare[] {
    return list.filter((p) => p.place).slice(0, n)
  }

  function perHit(types: number[], ex: MapScout['executes'][number]): string {
    if (!ex.rounds) return '0'
    const n = ex.utility.filter((u) => types.includes(u.type)).length / ex.rounds
    return n >= 10 ? n.toFixed(0) : n.toFixed(1)
  }

  function site(name: string): string | null {
    const s = name.trim().toLowerCase()
    return s === 'a' || s === 'b' ? `hud/bombsite-${s}` : null
  }

  function hide(e: Event) {
    ;(e.currentTarget as HTMLElement).style.visibility = 'hidden'
  }
</script>

<section class="map">
  <header class="mhead">
    <span class="thumb">
      <span class="ini">{mapLabel(m.map).slice(0, 2)}</span>
      <img src="/api/maps/{m.map}_radar_psd.png" alt="" onerror={hide} />
    </span>
    <div class="mtitle">
      <h3>{mapLabel(m.map)}</h3>
      <span class="dim">{m.replays.length} {m.replays.length === 1 ? 'match' : 'matches'}, {m.ctRounds} CT and {m.tRounds} T rounds</span>
    </div>
    <div class="records">
      <div class="rec ct">
        <span class="label">CT side</span>
        <b class="num">{m.won.ct}<small>/{m.ctRounds}</small></b>
        <span class="track"><i style:width="{ctPct}%"></i></span>
      </div>
      <div class="rec t">
        <span class="label">T side</span>
        <b class="num">{m.won.t}<small>/{m.tRounds}</small></b>
        <span class="track"><i style:width="{tPct}%"></i></span>
      </div>
    </div>
  </header>

  <div class="games">
    {#each m.replays as r (r.id)}
      <a class="game" href="#/replay/{r.id}" title="Open {r.name}"><ScoutIcon name="play" size={10} /><span>{r.name}</span><small>{r.rounds} rds</small></a>
    {/each}
  </div>

  <div class="cards">
    <article class="card">
      <h4 class="label">CT setup, {early}s in</h4>
      <p class="lead">Where the five stand once the round settles, most common first.</p>
      {#each m.ctSetups.slice(0, 5) as st, i (i)}
        <div class="setup">
          <span class="share num">{share(st.count, m.ctRounds)}</span>
          <span class="places">
            {#each spots(st.places) as sp (sp.place)}
              <span class="place">{sp.place}{#if sp.n > 1}<b>×{sp.n}</b>{/if}</span>
            {/each}
          </span>
          <span class="cnt faint num" title="{st.count} of {m.ctRounds} CT rounds">{st.count}/{m.ctRounds}</span>
        </div>
      {:else}
        <p class="none">No CT rounds with the whole team alive at that time.</p>
      {/each}
    </article>

    <article class="card">
      <h4 class="label">T side, sites they hit</h4>
      <p class="lead">Share of T rounds, when the first player reaches the site, and the utility they use.</p>
      {#each m.executes as ex (ex.site)}
        <div class="exec">
          <span class="badge">
            {#if site(ex.site)}<GameIcon name={site(ex.site)} h={22} title="{ex.site} site" fallback={ex.site} />{:else}<b>{ex.site}</b>{/if}
          </span>
          <div class="ebody">
            <div class="eline">
              <b class="num">{Math.round(ex.share * 100)}%</b>
              <span class="faint">{ex.rounds} {ex.rounds === 1 ? 'round' : 'rounds'}, hit {Math.round(ex.avgHitTime)}s in</span>
            </div>
            <span class="ebar"><i style:width="{Math.round(ex.share * 100)}%"></i></span>
            <div class="util">
              <span title="Smokes per hit"><GameIcon name="weapon/smokegrenade" h={14} fallback="Smoke" />{perHit([EQ.smoke], ex)}</span>
              <span title="Flashes per hit"><GameIcon name="weapon/flashbang" h={14} fallback="Flash" />{perHit([EQ.flash], ex)}</span>
              <span title="Molotovs per hit"><GameIcon name="weapon/molotov" h={14} fallback="Molotov" />{perHit([EQ.molotov, EQ.incendiary], ex)}</span>
              <span title="HE grenades per hit"><GameIcon name="weapon/hegrenade" h={14} fallback="HE" />{perHit([EQ.he], ex)}</span>
              <span class="faint">per hit</span>
            </div>
          </div>
        </div>
      {:else}
        <p class="none">No site hits found in the T rounds.</p>
      {/each}
      {#if m.noHit}
        <p class="nohit faint">No hit in {m.noHit} of {m.tRounds} T rounds ({share(m.noHit, m.tRounds)}).</p>
      {/if}
    </article>
  </div>

  <article class="card wide">
    <h4 class="label">Players</h4>
    <div class="ptable">
      <div class="prow phead">
        <span class="label">Player</span>
        <span class="label">Rounds</span>
        <span class="label">On CT, {early}s in</span>
        <span class="label">On T, when the site is hit</span>
      </div>
      {#each m.players as p (p.steamId)}
        <div class="prow">
          <b class="pname" title={p.name}>{p.name}</b>
          <span class="rounds num"><span class="ct">{p.ctRounds}</span> <span class="faint">/</span> <span class="t">{p.tRounds}</span></span>
          <span class="pl">
            {#each top(p.ctPlaces) as ps (ps.place)}<span class="pp"><span>{ps.place}</span><b class="num">{Math.round(ps.share * 100)}%</b></span>{:else}<span class="faint">-</span>{/each}
          </span>
          <span class="pl">
            {#each top(p.tPlaces) as ps (ps.place)}<span class="pp"><span>{ps.place}</span><b class="num">{Math.round(ps.share * 100)}%</b></span>{:else}<span class="faint">-</span>{/each}
          </span>
        </div>
      {/each}
    </div>
  </article>

  <div class="ihead">
    <div>
      <h3>Heatmaps</h3>
      <span class="dim">
        {#if set?.stage === 'done'}
          {set.pictures.length} images of {teamName || 'the team'} on {mapLabel(m.map)}, 1600 px PNG with the name and the Cerlock logo.
        {:else if set?.stage === 'error'}
          <span class="bad">{set.error}</span>
        {:else if set?.stage === 'waiting'}
          Waiting for the other map to finish drawing.
        {:else if set?.total}
          Drawing image {Math.min(set.done + 1, set.total)} of {set.total}. They show up below as they are ready.
        {:else}
          Drawing the images, this takes a little while per map.
        {/if}
      </span>
    </div>
    {#if set?.stage === 'error'}
      <button class="btn" onclick={onretry}>Try again</button>
    {:else}
      <button class="btn" disabled={zipping || drawing} onclick={onzip}>
        {#if zipping}<i class="spin"></i>{:else}<ScoutIcon name="download" size={15} />{/if}
        <span>Download {mapLabel(m.map)} (zip)</span>
      </button>
    {/if}
  </div>

  {#if drawing}
    {#if set?.total}
      <span class="sbar"><i style:width="{Math.round((set.done / set.total) * 100)}%"></i></span>
    {:else}
      <span class="sbar sweep"></span>
    {/if}
  {/if}

  {#if groups.length > 1}
    <nav class="jumps" aria-label="Sections">
      {#each groups as g, i (g.id)}
        <button class="jump" onclick={() => jump(i)}>{g.title}<span class="num">{g.pictures.length}</span></button>
      {/each}
    </nav>
  {/if}

  {#each groups as g, i (g.id)}
    <div class="group" bind:this={sections[i]}>
      <div class="ghead"><h4>{g.title}</h4><span class="faint">{g.hint}</span></div>
      <ScoutGallery pictures={g.pictures} labels />
    </div>
  {/each}
  {#if drawing && !(set?.pictures.length)}
    <div class="group">
      <ScoutGallery pictures={[]} placeholders={8} />
    </div>
  {/if}
</section>

<style>
  .map {
    min-width: 0;
  }

  .mhead {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .thumb {
    position: relative;
    width: 52px;
    height: 52px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.45);
    filter: saturate(0.85) brightness(0.95);
  }

  .ini {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 700;
    color: var(--text-3);
    text-transform: uppercase;
  }

  .mtitle {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h3 {
    font-size: 26px;
    line-height: 1.05;
  }

  .records {
    display: flex;
    gap: 10px;
  }

  .rec {
    width: 132px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 12px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .rec b {
    font-family: var(--display);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
  }

  .rec small {
    font-size: 14px;
    color: var(--text-3);
    font-weight: 600;
  }

  .rec.ct b {
    color: var(--ct);
  }

  .rec.t b {
    color: var(--t);
  }

  .track {
    display: block;
    height: 3px;
    margin-top: 4px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .track i {
    display: block;
    height: 100%;
  }

  .rec.ct .track i {
    background: var(--ct);
  }

  .rec.t .track i {
    background: var(--t);
  }

  .games {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0 16px;
  }

  .game {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    max-width: 100%;
    padding: 0 9px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-2);
    font-size: 12.5px;
    text-decoration: none;
  }

  .game:hover {
    border-color: var(--line-2);
    color: var(--text);
  }

  .game span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .game small {
    color: var(--text-3);
    flex: none;
  }

  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .card {
    min-width: 0;
    padding: 14px 16px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .card.wide {
    margin-top: 12px;
  }

  .lead {
    margin: 4px 0 12px;
    color: var(--text-2);
  }

  .none {
    margin: 0;
    color: var(--text-3);
  }

  .setup {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 40px;
    gap: 10px;
    align-items: start;
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }

  .share {
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
    line-height: 24px;
  }

  .places {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .place {
    height: 24px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-sm);
    background: rgba(98, 169, 245, 0.12);
    color: var(--ct-light);
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .place b {
    color: var(--ct);
    font-weight: 700;
  }

  .cnt {
    text-align: right;
    line-height: 24px;
    font-size: 12.5px;
  }

  .exec {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }

  .badge {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: rgba(239, 166, 60, 0.12);
    color: var(--t);
    font-family: var(--display);
    font-size: 16px;
  }

  .ebody {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .eline {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .eline b {
    font-family: var(--display);
    font-size: 19px;
    font-weight: 700;
    line-height: 1;
  }

  .ebar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .ebar i {
    display: block;
    height: 100%;
    background: var(--t);
  }

  .util {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 2px;
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
  }

  .util span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .util :global(.icon) {
    color: var(--text-2);
  }

  .util .faint {
    font-family: var(--font);
    font-weight: 400;
    font-size: 12px;
  }

  .nohit {
    margin: 10px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  /* Players */

  .ptable {
    margin-top: 8px;
  }

  .prow {
    display: grid;
    grid-template-columns: minmax(110px, 0.9fr) 70px minmax(0, 1.6fr) minmax(0, 1.6fr);
    gap: 14px;
    align-items: center;
    min-height: 38px;
    border-top: 1px solid var(--line);
  }

  .prow.phead {
    min-height: 28px;
    border-top: none;
  }

  .pname {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rounds {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .pl {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 12px;
    min-width: 0;
    padding: 6px 0;
  }

  .pp {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    white-space: nowrap;
    color: var(--text-2);
  }

  .pp b {
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 700;
    color: var(--text);
  }

  /* Images */

  .ihead {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin: 32px 0 6px;
  }

  .ihead h3 {
    font-size: 21px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px 0 12px;
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .group {
    margin-top: 22px;
    scroll-margin-top: 76px;
  }

  .jumps {
    position: sticky;
    top: 60px;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 -2px;
    padding: 10px 2px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }

  .jump {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
  }

  .jump:hover {
    color: var(--text);
  }

  .jump span {
    font-size: 11.5px;
    color: var(--text-3);
  }

  .spin {
    display: inline-block;
    width: 13px;
    height: 13px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line-2);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .ghead {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 10px;
  }

  h4 {
    font-family: var(--display);
    font-size: 16px;
    font-weight: 700;
    margin: 0;
  }

  h4.label {
    font-size: 11px;
    font-weight: 600;
  }

  .sbar {
    position: relative;
    display: block;
    height: 3px;
    margin: 14px 0 16px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .sbar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.25s;
  }

  .sbar.sweep::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 1.2s ease-in-out infinite;
  }

  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }

  @media (max-width: 900px) {
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }

    .prow {
      grid-template-columns: minmax(90px, 1fr) 60px minmax(0, 1.5fr);
    }

    .prow > :nth-child(4) {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sbar.sweep::after {
      animation: none;
    }
  }
</style>
