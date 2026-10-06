<script lang="ts">
  import { clock, money } from '../lib/format'
  import type { Viewer } from '../lib/viewer.svelte'
  import { REASON, weaponName } from '../lib/weapons'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const rounds = $derived(r.match.rounds)
  const info = $derived(r.report.rounds)

  const current = $derived(v.round)

  // Time on the round clock when something happened. After the plant the
  // clock shows the bomb timer instead.
  function at(round: number, tick: number): { text: string; bomb: boolean } {
    const rd = rounds[round]
    const plant = r.roundBomb[round].find((e) => e.kind === 'planted')
    if (plant && tick >= plant.tick) return { text: clock(rd.bombTime - (tick - plant.tick) / r.rate), bomb: true }
    return { text: clock(rd.roundTime - (tick - rd.freezeEndTick) / r.rate), bomb: false }
  }

  const cls = (side: number) => (side === 3 ? 'ct' : 't')
</script>

<div class="rounds">
  {#each rounds as rd, i (i)}
    {@const ri = info[i]}
    <section class:current={i === current}>
      <button class="head" onclick={() => v.seekRound(i)}>
        <span class="num">{i + 1}</span>
        <span class="winner {cls(rd.winner)}">{rd.winnerTeam >= 0 ? r.teamName(rd.winnerTeam) : '-'}</span>
        <span class="reason muted">{REASON[rd.reason] ?? rd.reason}</span>
        <span class="score mono">{rd.scoreA}:{rd.scoreB}</span>
      </button>
      <div class="eco">
        {#each [0, 1] as t (t)}
          <span class={cls(rd.sideOf[t])}>
            {ri.buyType[t]} <span class="muted">{money(ri.equipValue[t])}</span>
          </span>
        {/each}
        {#if ri.clutch}
          <span class="clutch">1v{ri.clutch.versus} {r.playerName(ri.clutch.player)} {ri.clutch.won ? 'won' : 'lost'}</span>
        {/if}
      </div>
      {#if i === current}
        <ul>
          {#each r.roundKills[i] as k, j (j)}
            {@const t = at(i, k.tick)}
            <li>
              <button onclick={() => v.seek(k.tick - 3 * r.rate)}>
                <span class="time mono" class:bomb={t.bomb}>{t.text}</span>
                <span class={cls(k.killerSide)}>{r.playerName(k.killer)}</span>
                <span class="muted">{weaponName(k.weapon)}{k.headshot ? ' HS' : ''}</span>
                <span class={cls(k.victimSide)}>{r.playerName(k.victim)}</span>
                {#if ri.traded?.includes(r.kills.indexOf(k))}<span class="tag">traded</span>{/if}
              </button>
            </li>
          {/each}
          {#each r.roundBomb[i].filter((b) => b.kind === 'planted' || b.kind === 'defused') as b, j (j)}
            {@const t = at(i, b.tick)}
            <li>
              <button onclick={() => v.seek(b.tick - 3 * r.rate)}>
                <span class="time mono" class:bomb={t.bomb}>{t.text}</span>
                <span>{b.kind === 'planted' ? `Planted on ${b.site}` : 'Defused'} by {r.playerName(b.player)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>

<style>
  .rounds {
    padding: 6px 8px 20px;
  }

  section {
    border-bottom: 1px solid var(--line);
    padding: 4px 0;
  }

  section.current {
    background: var(--panel-2);
    border-radius: 6px;
  }

  .head {
    width: 100%;
    display: grid;
    grid-template-columns: 24px 1fr auto auto;
    gap: 8px;
    align-items: center;
    background: transparent;
    border: none;
    text-align: left;
    padding: 4px 6px;
  }

  .num {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .winner {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reason {
    font-size: 11.5px;
  }

  .eco {
    display: flex;
    gap: 12px;
    font-size: 11.5px;
    padding: 0 6px 4px 38px;
    flex-wrap: wrap;
  }

  .clutch {
    color: var(--text-2);
  }

  ul {
    list-style: none;
    margin: 2px 0 4px;
    padding: 0 6px 0 30px;
  }

  li button {
    width: 100%;
    display: flex;
    gap: 7px;
    align-items: center;
    background: transparent;
    border: none;
    padding: 3px 6px;
    font-size: 12px;
    text-align: left;
  }

  li button:hover {
    background: var(--panel-3);
  }

  .time {
    color: var(--muted);
    min-width: 48px;
  }

  .time.bomb {
    color: var(--bad);
  }

  .tag {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--line-2);
    border-radius: 3px;
    padding: 0 3px;
  }
</style>
