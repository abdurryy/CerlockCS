<script lang="ts">
  import { clock, money } from '../lib/format'
  import type { Viewer } from '../lib/viewer.svelte'
  import { REASON } from '../lib/weapons'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const rounds = $derived(r.match.rounds)
  const info = $derived(r.report.rounds)
  const current = $derived(v.round)

  // What the in game clock showed at a tick. After the plant it shows the
  // bomb timer instead.
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
        <span class="num mono">{String(i + 1).padStart(2, '0')}</span>
        <span class="winner {cls(rd.winner)}">{rd.winnerTeam >= 0 ? r.teamName(rd.winnerTeam) : '-'}</span>
        <span class="reason">{REASON[rd.reason] ?? rd.reason}</span>
        <span class="score mono">{rd.scoreA}:{rd.scoreB}</span>
      </button>
      <div class="eco mono">
        {#each [0, 1] as t (t)}
          <span class={cls(rd.sideOf[t])}>{ri.buyType[t]} {money(ri.equipValue[t])}</span>
        {/each}
        {#if r.roundBlunders[i].length}<span class="ev">{r.roundBlunders[i].length} ev</span>{/if}
      </div>
      {#if i === current}
        <div class="notes">
          {#each [0, 1] as t (t)}
            {#if ri.setup?.[t]}
              <p class="setup"><span class="label {cls(rd.sideOf[t])}">{rd.sideOf[t] === 3 ? 'CT' : 'T'} at 20s</span> {ri.setup[t]}</p>
            {/if}
          {/each}
          {#if ri.hit}
            <p class="setup"><span class="label">Hit</span> T reached site {ri.hit} after {Math.round(ri.hitTime)}s</p>
          {/if}
          <ol>
            {#each (ri.story ?? []).filter((l) => l.kind !== 'setup' && l.kind !== 'hit') as line, j (j)}
              {@const t = at(i, line.tick)}
              <li class={line.kind}>
                <button onclick={() => v.seek(line.tick - 3 * r.rate)}>
                  <span class="time mono" class:bomb={t.bomb}>{line.kind === 'end' ? 'end' : t.text}</span>
                  <span class="text">{line.text}</span>
                </button>
              </li>
            {/each}
          </ol>
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .rounds {
    padding: 4px 0 24px;
  }

  section {
    border-bottom: 1px solid var(--rule);
    padding: 6px 0 8px;
  }

  section.current {
    background: var(--desk-2);
    box-shadow: inset 2px 0 0 var(--marker);
  }

  .head {
    width: 100%;
    display: grid;
    grid-template-columns: 26px 1fr auto auto;
    gap: 10px;
    align-items: baseline;
    border: none;
    border-radius: 0;
    text-align: left;
    padding: 4px 16px;
  }

  .head:hover {
    background: transparent;
  }

  .num {
    color: var(--pencil);
    font-size: 11px;
  }

  .winner {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reason {
    font-size: 11.5px;
    color: var(--pencil);
  }

  .score {
    font-size: 12px;
  }

  .eco {
    display: flex;
    gap: 14px;
    font-size: 10.5px;
    padding: 0 16px 0 52px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .ev {
    color: var(--evidence);
  }

  .notes {
    padding: 8px 16px 2px 52px;
  }

  .setup {
    margin: 0 0 4px;
    font-size: 12px;
    color: var(--graphite);
  }

  .setup .label {
    margin-right: 6px;
  }

  ol {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    border-left: 1px solid var(--rule-2);
  }

  li button {
    width: 100%;
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 8px;
    text-align: left;
    border: none;
    border-radius: 0;
    padding: 4px 6px 4px 10px;
    font-size: 12.5px;
    color: var(--graphite);
    position: relative;
  }

  li button::before {
    content: '';
    position: absolute;
    left: -3px;
    top: 10px;
    width: 5px;
    height: 5px;
    background: var(--rule-2);
    border-radius: 50%;
  }

  li button:hover {
    background: var(--desk-3);
    color: var(--paper);
  }

  .time {
    font-size: 11px;
    color: var(--pencil);
  }

  .time.bomb {
    color: var(--marker);
  }

  li.opening .text,
  li.swing .text {
    color: var(--paper);
  }

  li.opening button::before,
  li.swing button::before {
    background: var(--marker);
  }

  li.plant button::before,
  li.defuse button::before {
    background: var(--evidence);
  }

  li.end .text {
    font-family: var(--serif);
    font-weight: 600;
    color: var(--paper);
  }

  li.clutch .text {
    font-style: italic;
  }
</style>
