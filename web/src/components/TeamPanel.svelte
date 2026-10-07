<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'
  import { teamColor } from '../lib/colors'
  import { money } from '../lib/format'
  import { statsAt } from '../lib/live'
  import { emptyState, type PlayerState } from '../lib/replay'
  import type { Kill } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import GameIcon from './GameIcon.svelte'
  import PlayerCard from './PlayerCard.svelte'

  let { v, team }: { v: Viewer; team: number } = $props()
  const r = $derived(v.replay)
  const players = $derived(r.teamPlayers[team])

  const view = $derived.by(() => {
    const tick = v.tick
    const round = r.roundIndex(tick)
    const stats = statsAt(r, tick)
    const states: PlayerState[] = players.map((p) => r.state(p, tick, emptyState()))
    // Health a second ago, for the damage strip on the health bar.
    const ago = Math.max(r.round(round).startTick, tick - r.rate)
    const was = players.map((p) => r.state(p, ago, emptyState()).hp)
    const kills = r.roundKills[round] ?? []
    // The kill that ended a dead player's round.
    const death = (p: number, s: PlayerState): Kill | null => {
      if (!s.present || s.alive) return null
      let out: Kill | null = null
      for (const k of kills) {
        if (k.tick > tick) break
        if (k.victim === p) out = k
      }
      return out
    }
    const rows = players
      .map((p, i) => ({ p, s: states[i], was: was[i], st: stats[p], death: death(p, states[i]) }))
      .filter((x) => x.s.present || x.st.kills || x.st.deaths)
    const present = rows.filter((x) => x.s.present)
    const money = present.reduce((a, x) => a + x.s.money, 0)
    const alive = present.filter((x) => x.s.alive).length
    return { side: r.sideOf(team, round), rows, money, alive, size: present.length }
  })

  const c = $derived(teamColor(view.side))
  const sideName = $derived(view.side === 3 ? 'Counter-Terrorists' : 'Terrorists')

  // Same breakpoints as the styles below.
  const short = new MediaQuery('max-height: 919px')
  const shorter = new MediaQuery('max-height: 799px')
  const logo = $derived(shorter.current ? 18 : short.current ? 22 : 24)
</script>

<section style:--team={c.base}>
  <header>
    <GameIcon name={view.side === 3 ? 'kill/ct' : 'kill/t'} h={logo} title={sideName} fallback={view.side === 3 ? 'CT' : 'T'} />
    <span class="title">
      <h2 title={r.teamName(team)}>{r.teamName(team)}</h2>
      <span class="meta">
        <span class="side">{view.side === 3 ? 'CT side' : 'T side'}</span>
        <span class="alive num" title="{view.alive} of {view.size} alive"><b>{view.alive}</b>/{view.size} <span class="word">alive</span></span>
        <span class="money num" title="Team money">{money(view.money)}</span>
      </span>
    </span>
  </header>
  {#each view.rows as { p, s, was, st, death } (p)}
    <PlayerCard
      name={r.playerName(p)}
      slot={r.slot[p]}
      side={view.side}
      {s}
      {st}
      {was}
      {death}
      killer={death && death.killer >= 0 && death.killer !== p ? r.playerName(death.killer) : ''}
      followed={v.follow === p}
      onclick={() => v.setFollow(p)}
    />
  {/each}
</section>

<style>
  section {
    position: relative;
    border-bottom: 1px solid var(--line);
  }

  header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 54px;
    padding: 2px 12px 0;
  }

  header::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    background: var(--team);
  }

  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h2 {
    min-width: 0;
    font-size: 16px;
    line-height: 18px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 14px;
    color: var(--text-3);
    white-space: nowrap;
  }

  .side {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--team);
  }

  .alive b {
    font-weight: 700;
    color: var(--text);
  }

  .money {
    font-size: 13px;
    letter-spacing: 0.02em;
    color: var(--text);
  }

  /* Shorter screens, see PlayerCard. */
  @media (max-height: 919px) {
    header {
      height: 44px;
      gap: 9px;
    }


    h2 {
      font-size: 15px;
      line-height: 17px;
    }

    .title {
      gap: 1px;
    }

    .meta {
      line-height: 13px;
    }
  }

  /* One line: name, alive count and money. */
  @media (max-height: 799px) {
    header {
      height: 34px;
      gap: 8px;
    }


    .title {
      flex-direction: row;
      align-items: baseline;
      gap: 10px;
    }

    h2 {
      flex: 1;
    }

    .side,
    .word {
      display: none;
    }
  }
</style>
