<script lang="ts">
  import { money } from '../lib/format'
  import { weaponIcon } from '../lib/icons.svelte'
  import type { Blunder } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { EQ, weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'

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
    for (const b of all) {
      if ((team >= 0 && b.team !== team) || (player >= 0 && b.player !== player)) continue
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

  // Only the most common kinds until the list is opened.
  let allKinds = $state(false)
  const KINDS_SHOWN = 6
  const shownKinds = $derived(
    allKinds || kinds.findIndex(([k]) => k === kind) >= KINDS_SHOWN ? kinds : kinds.slice(0, KINDS_SHOWN),
  )

  const sevWord = { high: 'Serious', medium: 'Costly', low: 'Minor', positive: '' }
  // "$4450" reads better as "$4,450".
  const tidy = (s: string) => s.replace(/\$(\d{4,})/g, (_, n) => money(Number(n)))
  const rounds = (n: number) => n.toFixed(2)

  // Kinds that always involve the same piece of equipment.
  const KIND_ICON: Record<string, string> = {
    team_flash_death: 'weapon/flashbang',
    self_flash_death: 'weapon/flashbang',
    wasted_molotov: 'weapon/molotov',
    bomb_carrier_first: 'weapon/c4',
    bomb_death: 'weapon/planted_c4',
    late_defuse: 'hud/defuse',
    no_armor: 'hud/armor',
    time_ran_out: 'hud/time',
    unused_utility: 'weapon/hegrenade',
  }

  interface Gear {
    name: string | null
    title: string
  }

  const sideOfPlayer = (p: number, round: number) => r.sideOf(r.match.players[p]?.team ?? -1, round)
  const cls = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')

  function weapon(id: number, side: number): Gear {
    return { name: weaponIcon(id, side), title: weaponName(id) }
  }

  // gear finds the equipment a blunder was about, so it can be shown with
  // the game's own icon.
  function gear(b: Blunder): Gear[] {
    const side = r.sideOf(b.team, b.round)
    const kill = () => r.roundKills[b.round].find((k) => k.tick === b.tick && k.killer === b.player && k.victim === b.other)
    const held = (tick: number) => {
      const s = r.state(b.player, tick)
      return s.weapon || s.primary
    }
    switch (b.kind) {
      case 'team_kill': {
        const k = kill()
        return k ? [weapon(k.weapon, side)] : []
      }
      case 'team_damage':
      case 'self_damage': {
        // The last hit, the detail text names that weapon too.
        const d = r.roundDamages[b.round].filter((d) => d.attacker === b.player && d.victim === b.other).pop()
        return d ? [weapon(d.weapon, side)] : []
      }
      case 'team_flash_death':
      case 'self_flash_death':
        return [{ name: 'weapon/flashbang', title: 'Flash' }]
      case 'reload_death': {
        const id = held(b.tick - r.rate / 2)
        return id ? [weapon(id, side)] : []
      }
      case 'running_shots': {
        const id = held(b.tick)
        return id ? [weapon(id, side)] : []
      }
      case 'unused_utility': {
        const k = r.roundKills[b.round].find((k) => k.tick === b.tick && k.victim === b.player)
        return (k?.victimUtility ?? []).map((id) => weapon(id, side))
      }
      case 'wasted_molotov':
        return side === 3 ? [weapon(EQ.incendiary, side)] : [weapon(EQ.molotov, side)]
      case 'bomb_carrier_first':
        return [{ name: 'weapon/c4', title: 'Bomb' }]
      case 'bomb_death':
        return [{ name: 'weapon/planted_c4', title: 'Bomb' }]
      case 'late_defuse':
        return [{ name: 'hud/defuse', title: 'Defuse' }]
      case 'no_armor':
        return [{ name: 'hud/armor', title: 'No armor' }]
      case 'time_ran_out':
        return [{ name: 'hud/time', title: 'Time' }]
    }
    return []
  }

  // The second player is shown after the icon, like the kill feed, when
  // the blunder was done to them.
  const TO_OTHER = new Set(['team_kill', 'team_damage', 'team_flash_death'])
</script>

<div class="evidence">
  <span class="label">Evidence</span>
  <p class="lead">{list.length} {list.length === 1 ? 'piece' : 'pieces'} of evidence</p>
  <p class="sub">
    Single mistakes you can watch. Added up they gave away about <b class="num">{thrown.toFixed(1)}</b>
    {thrown.toFixed(1) === '1.0' ? 'round' : 'rounds'} of win chance.
  </p>

  <div class="seg teams" role="group" aria-label="Team">
    <button class:on={team < 0} aria-pressed={team < 0} onclick={() => ((team = -1), (player = -1))}>Both</button>
    {#each [0, 1] as t (t)}
      {@const side = r.sideOf(t, v.round)}
      <button class:on={team === t} aria-pressed={team === t} onclick={() => ((team = t), (player = -1))}>
        <GameIcon name={side === 3 ? 'kill/ct' : 'kill/t'} h={16} />
        <span class="tname">{r.teamName(t)}</span>
      </button>
    {/each}
  </div>

  <section>
    <div class="shead">
      <h3 class="label">Who threw the most</h3>
      <select bind:value={player} aria-label="Player">
        <option value={-1}>Everyone</option>
        {#each r.match.players.filter((p) => (team < 0 ? p.team === 0 || p.team === 1 : p.team === team)) as p (p.index)}
          <option value={p.index}>{p.name}</option>
        {/each}
      </select>
    </div>
    {#if suspects.length}
      <div class="suspect cols" aria-hidden="true">
        <span></span>
        <span></span>
        <span class="label" title="Pieces of evidence">Count</span>
        <span class="label" title="Rounds of win chance given away">Rounds</span>
      </div>
    {/if}
    {#each suspects.slice(0, 6) as s (s.p)}
      <button
        class="suspect"
        class:on={player === s.p}
        aria-pressed={player === s.p}
        onclick={() => (player = player === s.p ? -1 : s.p)}
        title="{s.n} {s.n === 1 ? 'piece' : 'pieces'} of evidence, {rounds(s.cost)} rounds of win chance given away"
      >
        <span class="name {cls(sideOfPlayer(s.p, v.round))}">{r.playerName(s.p)}</span>
        <span class="bar"><i style:width="{Math.max(2, s.w * 100)}%"></i></span>
        <span class="n num count">{s.n}</span>
        <span class="n num">{rounds(s.cost)}</span>
      </button>
    {:else}
      <p class="none">No one.</p>
    {/each}
  </section>

  {#if kinds.length}
    <section>
      <h3 class="label">Kinds</h3>
      <div class="kinds">
        {#each shownKinds as [k, x] (k)}
          <button class="kind" class:on={kind === k} aria-pressed={kind === k} onclick={() => (kind = kind === k ? '' : k)}>
            <span class="kicon">{#if KIND_ICON[k]}<GameIcon name={KIND_ICON[k]} h={13} />{/if}</span>
            <span class="ktitle">{x.title}</span>
            <span class="num count">{x.n}</span>
          </button>
        {/each}
      </div>
      {#if kinds.length > KINDS_SHOWN && (allKinds || shownKinds.length < kinds.length)}
        <button class="more plain" onclick={() => (allKinds = !allKinds)}>
          {allKinds ? 'Show fewer' : `Show ${kinds.length - shownKinds.length} more`}
        </button>
      {/if}
    </section>
  {/if}

  {#each byRound as [round, items] (round)}
    {@const rd = r.match.rounds[round]}
    <section class="round">
      <button class="rhead" onclick={() => v.seekRound(round)} title="Go to round {round + 1}">
        <span class="label">Round {round + 1}</span>
        <span class="score num">
          <span class={cls(rd.sideOf[0])}>{rd.scoreA}</span><i>:</i><span class={cls(rd.sideOf[1])}>{rd.scoreB}</span>
        </span>
      </button>
      {#each items as { b, id, n } (id)}
        {@const kit = gear(b)}
        {@const side = r.sideOf(b.team, b.round)}
        <button class="item {b.severity}" class:selected={v.blunder === id} onclick={() => v.openBlunder(id)}>
          <span class="marker num">{n}</span>
          <span class="body">
            <span class="top">
              <strong>{b.title}</strong>
              {#if b.cost > 0}<span class="cost num" title="Round win chance lost">-{Math.round(b.cost * 100)}%</span>{/if}
            </span>
            <span class="who">
              <span class="pname {cls(side)}">{b.player >= 0 ? r.playerName(b.player) : r.teamName(b.team)}</span>
              {#if kit.length}
                <span class="gear">
                  {#each kit as g, j (j)}
                    <GameIcon name={g.name} h={14} title={g.title} fallback={g.title} />
                  {/each}
                </span>
              {/if}
              {#if TO_OTHER.has(b.kind) && b.other >= 0 && b.other !== b.player}
                <span class="pname {cls(sideOfPlayer(b.other, b.round))}">{r.playerName(b.other)}</span>
              {/if}
              <span class="sev">{sevWord[b.severity]}</span>
            </span>
            <span class="detail">{tidy(b.detail)}</span>
          </span>
        </button>
      {/each}
    </section>
  {/each}
  {#if !list.length}
    <p class="none">No evidence with these filters.</p>
  {/if}
  <p class="foot">Cost is the drop in round win chance caused by the death that followed, from a simple model of players alive and the bomb.</p>
</div>

<style>
  .evidence {
    padding: 16px 16px 24px;
  }

  .lead {
    font-family: var(--display);
    font-size: 23px;
    font-weight: 600;
    line-height: 1.15;
    margin: 4px 0 4px;
  }

  .sub {
    margin: 0 0 14px;
    font-size: 13px;
    color: var(--text-2);
  }

  .sub b {
    color: var(--accent);
    font-weight: 600;
  }

  h3.label {
    font-size: 11px;
    font-weight: 600;
    margin: 0;
  }

  /* Segmented control. */
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .seg button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    height: 30px;
    padding: 0 10px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    background: transparent;
    border-color: transparent;
    color: var(--text-3);
  }

  .seg button:hover {
    background: var(--surface-2);
    color: var(--text-2);
  }

  .seg button.on {
    background: var(--surface-3);
    border-color: var(--line-2);
    color: var(--text);
  }

  .teams button:not(:first-child) {
    flex: 1;
  }

  .teams button:not(.on) :global(img) {
    opacity: 0.6;
  }

  .tname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  section {
    margin-top: 20px;
  }

  .shead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }

  .shead select {
    max-width: 150px;
    font-size: 12.5px;
    padding: 3px 6px;
  }

  /* Suspects. */
  .suspect {
    display: grid;
    grid-template-columns: minmax(0, 118px) minmax(24px, 1fr) 40px 44px;
    gap: 10px;
    align-items: center;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0 6px;
    margin: 0 -6px;
    width: calc(100% + 12px);
    text-align: left;
  }

  .suspect:hover {
    background: var(--surface-2);
  }

  .suspect.on {
    background: var(--surface-3);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .suspect.cols {
    height: 18px;
  }

  .suspect.cols:hover {
    background: transparent;
  }

  .cols .label {
    font-size: 10px;
    text-align: right;
  }

  .name {
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ct {
    color: var(--ct);
  }

  .t {
    color: var(--t);
  }

  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .n {
    font-size: 12.5px;
    font-weight: 600;
    text-align: right;
    color: var(--text);
  }

  .n.count {
    font-weight: 500;
    color: var(--text-3);
  }

  /* Kinds, one row each with the icon in its own column. */
  .kinds {
    display: flex;
    flex-direction: column;
    margin-top: 6px;
  }

  .kind {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    height: 28px;
    padding: 0 6px;
    margin: 0 -6px;
    width: calc(100% + 12px);
    text-align: left;
    font-weight: 400;
    font-size: 12.5px;
    color: var(--text-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
  }

  .kind:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .kind.on {
    color: var(--text);
    background: var(--surface-3);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .kicon {
    display: flex;
    justify-content: center;
    color: var(--text-2);
  }

  .kind:hover .kicon,
  .kind.on .kicon {
    color: var(--text);
  }

  .ktitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind .count {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
  }

  .kind.on .count {
    color: var(--text);
  }

  .more {
    margin: 4px 0 0 -6px;
    padding: 3px 6px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-3);
  }

  .more:hover {
    color: var(--text);
  }

  /* Rounds. */
  .round {
    margin-top: 18px;
  }

  .rhead {
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 0 0 6px;
    margin-bottom: 4px;
  }

  .rhead:hover {
    background: transparent;
  }

  .rhead:hover .label {
    color: var(--text);
  }

  .score {
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 700;
  }

  .score i {
    font-style: normal;
    color: var(--text-3);
    margin: 0 2px;
  }

  .item {
    width: 100%;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 12px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    padding: 9px 8px 10px;
    font-weight: 400;
    position: relative;
  }

  .item:hover {
    background: var(--surface-2);
  }

  .item.selected {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--evidence);
  }

  .marker {
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border-radius: var(--radius-sm);
    background: var(--evidence);
    color: var(--bg);
    font-family: var(--display);
    font-size: 11.5px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }

  .item.selected .marker {
    box-shadow: 0 0 0 1px var(--bg), 0 0 0 2px var(--text);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }

  strong {
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--text);
  }

  .cost {
    flex: none;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
  }

  .who {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 7px;
    min-width: 0;
  }

  .pname {
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pname.ct {
    color: var(--ct);
  }

  .pname.t {
    color: var(--t);
  }

  .gear {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text);
    font-size: 11.5px;
  }

  .sev {
    font-family: var(--display);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    line-height: 1;
    padding: 3px 5px 2px;
    border-radius: 3px;
    color: var(--sev, var(--text-2));
    background: color-mix(in srgb, var(--sev, var(--text-2)) 14%, transparent);
  }

  .high {
    --sev: var(--accent);
  }

  .medium {
    --sev: var(--warn);
  }

  .detail {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--text-2);
  }

  .none {
    margin: 8px 0 0;
    color: var(--text-3);
  }

  .foot {
    font-size: 11.5px;
    color: var(--text-3);
    margin: 18px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
</style>
