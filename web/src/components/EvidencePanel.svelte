<script lang="ts">
  import type { Blunder } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)

  let team = $state(-1)
  let player = $state(-1)
  let kind = $state('')

  const all = $derived(r.blunders)
  const list = $derived(
    all
      .map((b, id) => ({ b, id }))
      .filter(({ b }) => (team < 0 || b.team === team) && (player < 0 || b.player === player) && (!kind || b.kind === kind)),
  )
  const thrown = $derived(list.reduce((a, { b }) => a + (b.cost > 0 ? b.cost : 0), 0))

  // Who made the most costly mistakes.
  const suspects = $derived.by(() => {
    const m = new Map<number, { n: number; cost: number }>()
    for (const { b } of list) {
      if (b.player < 0) continue
      const s = m.get(b.player) ?? { n: 0, cost: 0 }
      s.n++
      s.cost += b.cost > 0 ? b.cost : 0
      m.set(b.player, s)
    }
    const rows = [...m].map(([p, s]) => ({ p, ...s })).sort((a, b) => b.cost - a.cost || b.n - a.n)
    const max = Math.max(0.01, ...rows.map((x) => x.cost))
    return rows.map((x) => ({ ...x, w: x.cost / max }))
  })

  const kinds = $derived.by(() => {
    const m = new Map<string, { title: string; n: number }>()
    for (const { b } of all.map((b) => ({ b })).filter(({ b }) => (team < 0 || b.team === team) && (player < 0 || b.player === player))) {
      const k = m.get(b.kind) ?? { title: b.title, n: 0 }
      k.n++
      m.set(b.kind, k)
    }
    return [...m].sort((a, b) => b[1].n - a[1].n)
  })

  const byRound = $derived.by(() => {
    const groups = new Map<number, { b: Blunder; id: number; n: number }[]>()
    for (const { b, id } of list) {
      const g = groups.get(b.round) ?? []
      g.push({ b, id, n: r.roundBlunders[b.round].indexOf(b) + 1 })
      groups.set(b.round, g)
    }
    return [...groups]
  })

  const sevWord = { high: 'serious', medium: 'costly', low: 'minor', positive: '' }
</script>

<div class="evidence">
  <p class="lead">{list.length} pieces of evidence</p>
  <p class="dim sub">
    Single mistakes you can watch. Added up they gave away about <b class="mono">{thrown.toFixed(1)}</b> {thrown.toFixed(1) === '1.0' ? 'round' : 'rounds'} of win chance.
  </p>

  <div class="filters">
    <select bind:value={team} onchange={() => (player = -1)}>
      <option value={-1}>Both teams</option>
      <option value={0}>{r.teamName(0)}</option>
      <option value={1}>{r.teamName(1)}</option>
    </select>
    <select bind:value={player}>
      <option value={-1}>Everyone</option>
      {#each r.match.players.filter((p) => team < 0 || p.team === team) as p (p.index)}
        <option value={p.index}>{p.name}</option>
      {/each}
    </select>
  </div>

  {#if suspects.length}
    <section>
      <span class="label">Who threw the most</span>
      {#each suspects.slice(0, 6) as s (s.p)}
        <button class="suspect" class:on={player === s.p} onclick={() => (player = player === s.p ? -1 : s.p)}>
          <span class="name">{r.playerName(s.p)}</span>
          <span class="bar"><i style="width: {s.w * 100}%"></i></span>
          <span class="mono n">{s.n} · {Math.round(s.cost * 100)}%</span>
        </button>
      {/each}
    </section>
  {/if}

  {#if kinds.length}
    <section>
      <span class="label">Kinds</span>
      <div class="kinds">
        {#each kinds as [k, x] (k)}
          <button class:on={kind === k} onclick={() => (kind = kind === k ? '' : k)}>
            {x.title} <span class="mono faint">{x.n}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#each byRound as [round, items] (round)}
    <section class="round">
      <button class="label rlabel" onclick={() => v.seekRound(round)}>Round {round + 1}</button>
      {#each items as { b, id, n } (id)}
        <button class="item {b.severity}" class:selected={v.blunder === id} onclick={() => v.openBlunder(id)}>
          <span class="tent mono">{n}</span>
          <span class="body">
            <span class="top">
              <strong>{b.title}</strong>
              {#if b.cost > 0}<span class="cost mono">-{Math.round(b.cost * 100)}%</span>{/if}
            </span>
            <span class="who">{b.player >= 0 ? r.playerName(b.player) : r.teamName(b.team)} · <span class="mono">{sevWord[b.severity]}</span></span>
            <span class="detail">{b.detail}</span>
          </span>
        </button>
      {/each}
    </section>
  {/each}
  {#if !list.length}
    <p class="dim">No evidence with these filters.</p>
  {/if}
  <p class="foot faint">Cost is the drop in round win chance caused by the death that followed, from a simple model of players alive and the bomb.</p>
</div>

<style>
  .evidence {
    padding: 16px 16px 24px;
  }

  .lead {
    font-family: var(--serif);
    font-size: 22px;
    font-weight: 500;
    margin: 0;
    font-variation-settings: 'opsz' 60;
  }

  .sub {
    margin: 4px 0 14px;
    font-size: 12.5px;
  }

  .sub b {
    color: var(--marker);
    font-weight: 500;
  }

  .filters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 8px;
  }

  section {
    padding: 12px 0;
    border-top: 1px solid var(--rule);
  }

  .suspect {
    width: 100%;
    display: grid;
    grid-template-columns: 110px 1fr 70px;
    gap: 10px;
    align-items: center;
    border: none;
    border-radius: 0;
    padding: 4px 2px;
    text-align: left;
  }

  .suspect.on {
    background: var(--desk-2);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    height: 6px;
    background: var(--desk-3);
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--marker);
  }

  .n {
    font-size: 11px;
    color: var(--graphite);
    text-align: right;
  }

  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }

  .kinds button {
    font-size: 11.5px;
    padding: 2px 8px;
    color: var(--graphite);
  }

  .kinds button.on {
    color: var(--paper);
  }

  .rlabel {
    border: none;
    padding: 0;
    margin-bottom: 4px;
  }

  .rlabel:hover {
    background: none;
    color: var(--paper);
  }

  .item {
    width: 100%;
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 10px;
    text-align: left;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 0;
    padding: 7px 6px;
  }

  .item:hover {
    background: var(--desk-2);
  }

  .item.selected {
    background: var(--desk-2);
    border-left-color: var(--evidence);
  }

  .tent {
    width: 16px;
    height: 14px;
    margin-top: 2px;
    background: var(--evidence);
    color: var(--ink);
    font-size: 9px;
    font-weight: 600;
    text-align: center;
    line-height: 14px;
    clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  strong {
    font-weight: 600;
  }

  .cost {
    color: var(--marker);
    font-size: 11.5px;
  }

  .who {
    font-size: 11.5px;
    color: var(--pencil);
  }

  .detail {
    font-size: 12px;
    color: var(--graphite);
  }

  .foot {
    font-size: 11px;
    margin-top: 14px;
  }
</style>
