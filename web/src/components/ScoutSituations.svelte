<script module lang="ts">
  import type { BuyKind, Situation } from '../lib/scout/types'

  // The preview window is kept while switching maps.
  let windowSecs = $state<10 | 20>(10)

  const BUY_HINT: Record<BuyKind, string> = {
    pistol: 'The first round of each half.',
    eco: 'They saved money and bought little or nothing.',
    force: 'They bought what they could without a full buy.',
    antieco: 'They had a full buy while the other team was on an eco or a force buy.',
    full: 'Rifles and utility on both teams.',
  }

  // tidy drops the "On T pistol rounds" start of a note, the tile already
  // says it. Names keep their case.
  export function tidy(note: string, s: Situation, names: string[]): string {
    const head = `On ${s.title} `
    if (!note.startsWith(head)) return note
    const rest = note.slice(head.length)
    if (names.some((n) => n && rest.startsWith(n))) return rest
    return rest.charAt(0).toUpperCase() + rest.slice(1)
  }
</script>

<script lang="ts">
  import { scoutLabels, scoutOptions } from '../lib/scout/aggregate'
  import { BUY_ORDER } from '../lib/scout/situations'
  import type { MapScout } from '../lib/scout/types'
  import GameIcon from './GameIcon.svelte'
  import ScoutHeat from './ScoutHeat.svelte'
  import ScoutIcon from './ScoutIcon.svelte'

  // Situations: one tile per side and buy with where they stand in the
  // first seconds, what they do from there and a button to watch it.
  let { scout, onwatch }: { scout: MapScout; onwatch: (s: Situation, opener: HTMLElement | null) => void } = $props()

  const opts = $derived(scoutOptions(scout))
  const sites = $derived(scoutLabels(scout)?.sites ?? [])
  const names = $derived(scout.roles.map((r) => r.name).sort((a, b) => b.length - a.length))
  const rows = $derived(
    BUY_ORDER.map((buy) => ({
      buy,
      ct: scout.situations.find((s) => s.side === 'ct' && s.buy === buy),
      t: scout.situations.find((s) => s.side === 't' && s.buy === buy),
    })).filter((r) => r.ct || r.t),
  )

  function buyName(s: Situation): string {
    const b = s.title.replace(/^(CT|T) /, '')
    return b.charAt(0).toUpperCase() + b.slice(1)
  }

  function pct(k: number, n: number): number {
    return n ? Math.round((k / n) * 100) : 0
  }

  function siteIcon(site: string): string | null {
    const s = site.trim().toLowerCase()
    return s === 'a' || s === 'b' ? `hud/bombsite-${s}` : null
  }

  // T hits for A and B always, so tiles line up, plus any other site.
  function hitRows(s: Situation): { site: string; rounds: number; avgTime: number }[] {
    const out = ['A', 'B'].map((site) => s.hits.find((h) => h.site === site) ?? { site, rounds: 0, avgTime: 0 })
    for (const h of s.hits) if (h.site !== 'A' && h.site !== 'B') out.push(h)
    return out
  }

  function stackRows(s: Situation): { site: string; rounds: number }[] {
    const out = ['A', 'B'].map((site) => s.stacks.find((x) => x.site === site) ?? { site, rounds: 0 })
    for (const x of s.stacks) if (x.site !== 'A' && x.site !== 'B') out.push(x)
    return out
  }

  // roundList names the rounds behind a tile, by match when there are
  // several: "Rounds 3, 4, 7" or "Match 1: 3, 4; Match 2: 7".
  function roundList(s: Situation): string {
    if (scout.replays.length < 2) {
      const ns = s.tracks.map((t) => t.round)
      return ns.length ? `${ns.length === 1 ? 'Round' : 'Rounds'} ${ns.join(', ')}` : ''
    }
    const by = new Map<number, number[]>()
    for (const t of s.tracks) {
      const m = scout.replays.findIndex((r) => r.id === t.replayId) + 1
      const list = by.get(m) ?? []
      list.push(t.round)
      by.set(m, list)
    }
    return [...by]
      .sort((a, b) => a[0] - b[0])
      .map(([m, ns]) => `Match ${m}: ${ns.join(', ')}`)
      .join('; ')
  }

  function watch(s: Situation, e: Event) {
    onwatch(s, e.currentTarget as HTMLElement)
  }
</script>

<section class="sits" aria-labelledby="sits-{scout.map}">
  <div class="shead">
    <div>
      <h3 id="sits-{scout.map}">Situations</h3>
      <p class="dim">Where they stand in the first seconds of each round type and what they do from there. Watch plays all those rounds at once.</p>
    </div>
    <div class="seg" role="group" aria-label="Heat preview window">
      <button class:on={windowSecs === 10} aria-pressed={windowSecs === 10} onclick={() => (windowSecs = 10)}>First 10 s</button>
      <button class:on={windowSecs === 20} aria-pressed={windowSecs === 20} onclick={() => (windowSecs = 20)}>First 20 s</button>
    </div>
  </div>

  {#if rows.length}
    <div class="grid">
      {#each rows as row (row.buy)}
        {#each [{ side: 'ct' as const, s: row.ct }, { side: 't' as const, s: row.t }] as cell (cell.side)}
          {#if cell.s}
            {@const s = cell.s}
            {@const lost = s.rounds - s.won}
            <article class="tile" aria-label={s.title}>
              <header class="th">
                <span class="tag {s.side}">{s.side.toUpperCase()}</span>
                <h4 title={BUY_HINT[s.buy]}>{buyName(s)}</h4>
                <span class="rec num" title="Won {s.won} of {s.rounds} {s.rounds === 1 ? 'round' : 'rounds'}">
                  <span class="faint">won</span> <b class:good={s.won * 2 > s.rounds} class:bad={s.won * 2 < s.rounds}>{s.won}</b><span class="faint">/{s.rounds}</span>
                </span>
              </header>

              <div class="tbody">
                <div class="prev">
                  <ScoutHeat info={scout.info} grid={windowSecs === 10 ? s.heat10 : s.heat20} {sites} size={208} label="Where they were in the first {windowSecs} s of {s.title.replace(/^(CT|T) /, '')}" />
                  {#if s.tracks.length}
                    <button class="play" title="Watch {s.title}" aria-label="Watch {s.title}" onclick={(e) => watch(s, e)}><ScoutIcon name="play" size={12} /></button>
                  {/if}
                </div>

                <div class="stats">
                  {#if s.side === 't'}
                    <div class="stat" title="On a site within {opts.rushSeconds} s">
                      <span class="sl">Rushed</span>
                      <span class="sv num"><b>{s.rushes}</b>/{s.rounds}</span>
                      <span class="bar"><i class="t" style:width="{pct(s.rushes, s.rounds)}%"></i></span>
                    </div>
                    {#each hitRows(s) as h (h.site)}
                      <div class="stat" title={h.rounds ? `Went ${h.site} in ${h.rounds} of ${s.rounds}, on site after ${Math.round(h.avgTime)} s${h.rounds > 1 ? ' on average' : ''}` : `Did not go ${h.site}`}>
                        <span class="sl">
                          {#if siteIcon(h.site)}<GameIcon name={siteIcon(h.site)} h={15} fallback={h.site} />{:else}<b>{h.site}</b>{/if}
                          Went {h.site}
                        </span>
                        <span class="sv num"><b>{h.rounds}</b>/{s.rounds}</span>
                        <span class="bar"><i class="t" style:width="{pct(h.rounds, s.rounds)}%"></i></span>
                        <span class="sx num">{h.rounds ? `${Math.round(h.avgTime)} s` : ''}</span>
                      </div>
                    {/each}
                    <div class="stat" title="No site hit and no plant">
                      <span class="sl">No hit</span>
                      <span class="sv num"><b>{s.noHit}</b>/{s.rounds}</span>
                      <span class="bar"><i class="n" style:width="{pct(s.noHit, s.rounds)}%"></i></span>
                    </div>
                  {:else}
                    {#each stackRows(s) as x (x.site)}
                      <div class="stat" title="3 or more players in the {x.site} zone {opts.setupSeconds} s in">
                        <span class="sl">
                          {#if siteIcon(x.site)}<GameIcon name={siteIcon(x.site)} h={15} fallback={x.site} />{:else}<b>{x.site}</b>{/if}
                          Stacked {x.site}
                        </span>
                        <span class="sv num"><b>{x.rounds}</b>/{s.rounds}</span>
                        <span class="bar"><i class="ct" style:width="{pct(x.rounds, s.rounds)}%"></i></span>
                      </div>
                    {/each}
                    <div class="stat" title="A player took a fight or stood in T territory in the first 20 s">
                      <span class="sl">Pushed early</span>
                      <span class="sv num"><b>{s.pushes}</b>/{s.rounds}</span>
                      <span class="bar"><i class="ct" style:width="{pct(s.pushes, s.rounds)}%"></i></span>
                    </div>
                  {/if}
                  <div class="stat" title="Lost rounds where 2 or more players stayed alive away from the bomb and the enemies">
                    <span class="sl">Saved</span>
                    {#if lost}
                      <span class="sv num"><b>{s.saves}</b>/{lost}</span>
                      <span class="bar"><i class="n" style:width="{pct(s.saves, lost)}%"></i></span>
                      <span class="sx faint">lost</span>
                    {:else}
                      <span class="sv num">-</span>
                      <span class="bar"></span>
                      <span class="sx faint">no loss</span>
                    {/if}
                  </div>
                </div>
              </div>

              {#if s.notes.length}
                <ul class="notes">
                  {#each s.notes as n, i (i)}<li>{tidy(n, s, names)}</li>{/each}
                </ul>
              {:else}
                <p class="nonote faint">
                  {s.rounds === 1 ? 'Only 1 round, too few for a pattern.' : `No clear pattern in ${s.rounds} rounds.`}
                </p>
              {/if}

              <footer class="tf">
                <button class="btn" disabled={!s.tracks.length} onclick={(e) => watch(s, e)}>
                  <ScoutIcon name="play" size={12} />
                  <span>Watch {s.tracks.length} {s.tracks.length === 1 ? 'round' : 'rounds'}</span>
                </button>
                <span class="rounds faint" title={roundList(s)}>{roundList(s)}</span>
              </footer>
            </article>
          {:else}
            <div class="tile gap">
              <span class="tag {cell.side}">{cell.side.toUpperCase()}</span>
              <span class="faint">No {cell.side.toUpperCase()} {(row.ct ?? row.t)!.title.replace(/^(CT|T) /, '')} in these demos.</span>
            </div>
          {/if}
        {/each}
      {/each}
    </div>
  {:else}
    <p class="empty faint">No rounds to sort into situations.</p>
  {/if}
</section>

<style>
  .sits {
    margin-top: 28px;
  }

  .shead {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }

  h3 {
    font-size: 21px;
  }

  .shead p {
    margin: 2px 0 0;
  }

  .seg {
    display: inline-flex;
    flex: none;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .seg button {
    height: 28px;
    padding: 0 11px;
    border-color: transparent;
    background: transparent;
    color: var(--text-2);
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .seg button:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .seg button.on {
    color: var(--text);
    background: var(--surface-3);
    border-color: var(--line-2);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }

  .tile {
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 14px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .tile.gap {
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 64px;
    border-style: dashed;
    background: transparent;
  }

  .th {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    margin-bottom: 10px;
  }

  .tag {
    flex: none;
    height: 20px;
    padding: 0 6px;
    border-radius: 3px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 700;
    line-height: 20px;
    letter-spacing: 0.04em;
  }

  .tag.ct {
    color: var(--ct);
    background: rgba(98, 169, 245, 0.13);
  }

  .tag.t {
    color: var(--t);
    background: rgba(239, 166, 60, 0.13);
  }

  h4 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: help;
  }

  .rec {
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .rec b {
    font-size: 17px;
    font-weight: 700;
  }

  .tbody {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }

  .prev {
    position: relative;
    flex: none;
  }

  .play {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0 0 2px;
    border-color: var(--line-2);
    border-radius: 50%;
    background: rgba(11, 13, 17, 0.82);
    color: var(--text-2);
  }

  .play:hover {
    color: var(--text);
    background: rgba(32, 37, 44, 0.94);
  }

  .stats {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 38px 40px 42px;
    align-items: center;
    gap: 8px;
    min-height: 27px;
    border-bottom: 1px solid var(--line);
  }

  .stat:last-child {
    border-bottom: none;
  }

  .sl {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
  }

  .sl :global(.icon) {
    color: var(--text);
  }

  .sv {
    text-align: right;
    font-family: var(--display);
    font-size: 13px;
    color: var(--text-3);
  }

  .sv b {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
  }

  .sx {
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
  }

  .sx.faint {
    font-family: var(--font);
    font-weight: 400;
    font-size: 11.5px;
    color: var(--text-3);
  }

  .bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--line-2);
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
  }

  .bar i.t {
    background: var(--t);
  }

  .bar i.ct {
    background: var(--ct);
  }

  .bar i.n {
    background: var(--text-3);
  }

  .notes {
    margin: 12px 0 0;
    padding: 10px 0 0;
    list-style: none;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .notes li {
    position: relative;
    padding-left: 13px;
    color: var(--text);
    line-height: 1.4;
  }

  .notes li::before {
    content: '';
    position: absolute;
    left: 1px;
    top: 0.6em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .nonote {
    margin: 12px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .tf {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: auto;
    padding-top: 12px;
    min-width: 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px 0 10px;
    flex: none;
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
  }

  .rounds {
    min-width: 0;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    margin: 0;
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 520px) {
    .shead {
      flex-direction: column;
      align-items: flex-start;
    }

    .tbody {
      flex-direction: column;
    }

    .stats {
      width: 100%;
    }
  }
</style>
