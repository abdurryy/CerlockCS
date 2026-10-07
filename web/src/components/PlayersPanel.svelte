<script lang="ts">
  import { money } from '../lib/format'
  import { weaponIcon } from '../lib/icons.svelte'
  import type { PlayerStats } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'
  import InsightCard from './InsightCard.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const report = $derived(r.report)

  const signed = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`
  const sideNow = (s: PlayerStats) => r.sideOf(r.match.players[s.player].team, v.round)
  const sideClass = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')
  const headshots = (s: PlayerStats) => (s.kills ? Math.round((s.headshots / s.kills) * 100) : 0)

  // Some demos have no damage events, so ADR, damage and accuracy are unknown.
  const hasDamage = $derived((r.match.damages?.length ?? 0) > 0)
  const NO_DAMAGE = 'No damage data in this demo'
  const adr = (n: number) => (hasDamage ? n.toFixed(0) : '-')

  type Key = 'kills' | 'deaths' | 'adr' | 'kast' | 'rating' | 'swing' | 'blunders'
  let sortBy = $state<Key>('rating')

  const rows = $derived([...report.players].filter((s) => s.rounds > 0).sort((a, b) => b[sortBy] - a[sortBy] || a.player - b.player))
  const selected = $derived(v.inspect >= 0 ? v.inspect : v.follow)
  const st = $derived(selected >= 0 ? report.players[selected] : null)
  const insights = $derived(report.insights.filter((i) => i.player === selected))

  const cols: { key: Key; label: string; title: string }[] = [
    { key: 'kills', label: 'K', title: 'Kills' },
    { key: 'deaths', label: 'D', title: 'Deaths' },
    { key: 'adr', label: 'ADR', title: 'Average damage per round' },
    { key: 'kast', label: 'KAST', title: 'Rounds with a kill, assist, survival or trade' },
    { key: 'swing', label: 'Swing', title: 'Round win chance added per round' },
    { key: 'blunders', label: 'Ev', title: 'Blunders (evidence)' },
    { key: 'rating', label: 'Rtg', title: 'HLTV 1.0 rating' },
  ]

  function pick(p: number) {
    v.inspect = v.inspect === p ? -1 : p
  }

  const heatKinds = [
    ['positions', 'Positions'],
    ['deaths', 'Deaths'],
    ['kills', 'Kills'],
  ] as const

  const heatLabel = (kind: string) => `${r.playerName(selected)} ${kind}`

  function heat(kind: 'positions' | 'deaths' | 'kills') {
    if (selected < 0) return
    v.heat = { label: heatLabel(kind), players: [selected], kind, side: 0 }
  }

  function top(m: Record<string, number> | null | undefined, n = 4): [string, number][] {
    return Object.entries(m ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
  }

  // Weapon kills are keyed by the parser's weapon name, map them back to
  // the equipment id for the icon and the short name.
  const weaponIds = $derived(new Map(Object.entries(r.match.weapons ?? {}).map(([id, name]) => [name, Number(id)])))

  const weapons = $derived.by(() => {
    if (!st) return []
    const list = top(st.weaponKills, 6).map(([name, n]) => {
      const id = weaponIds.get(name) ?? 0
      return { name: id ? weaponName(id) : name, icon: id ? weaponIcon(id, sideNow(st)) : null, n }
    })
    const most = Math.max(1, ...list.map((w) => w.n))
    return list.map((w) => ({ ...w, share: w.n / most }))
  })

  const multi = $derived(
    Object.entries(st?.multiKills ?? {})
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .filter(([, c]) => c > 0),
  )

  const utility = $derived(
    st
      ? [
          { icon: 'weapon/smokegrenade', label: 'Smoke', n: st.smokesThrown, detail: '' },
          {
            icon: 'weapon/flashbang',
            label: 'Flash',
            n: st.flashesThrown,
            detail: st.flashesThrown ? `blinded ${st.enemiesFlashed}, ${st.blindPerFlash} s per flash` : '',
          },
          { icon: 'weapon/hegrenade', label: 'HE', n: st.heThrown, detail: st.heThrown && hasDamage ? `${st.heDamagePerNade} dmg each` : '' },
          {
            icon: sideNow(st) === 3 ? 'weapon/incgrenade' : 'weapon/molotov',
            label: sideNow(st) === 3 ? 'Incendiary' : 'Molotov',
            n: st.molotovsThrown,
            detail: st.molotovsThrown && hasDamage ? `${st.fireDamagePerNade} dmg each` : '',
          },
        ]
      : [],
  )
</script>

<div class="players">
  <table class="board">
    <thead>
      <tr>
        <th class="name" scope="col"><span class="label">Player</span></th>
        {#each cols as c (c.key)}
          <th scope="col" aria-sort={sortBy === c.key ? 'descending' : undefined}>
            <button class="sort" class:on={sortBy === c.key} title="Sort by {c.title.toLowerCase()}" onclick={() => (sortBy = c.key)}>{c.label}</button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as s (s.player)}
        <tr class={sideClass(sideNow(s))} class:selected={selected === s.player} onclick={() => pick(s.player)}>
          <td class="name">
            <button class="who" title="Open {r.playerName(s.player)}'s file">
              <i class="bar"></i>
              <span class="nm">{r.playerName(s.player)}</span>
              {#if v.follow === s.player}<i class="ring" title="Following on the map"></i>{/if}
            </button>
          </td>
          <td class="num">{s.kills}</td>
          <td class="num">{s.deaths}</td>
          <td class="num" class:faint={!hasDamage} title={hasDamage ? undefined : NO_DAMAGE}>{adr(s.adr)}</td>
          <td class="num">{s.kast.toFixed(0)}</td>
          <td class="num" class:good={s.swing >= 3} class:bad={s.swing <= -3}>{signed(s.swing)}</td>
          <td class="num" class:ev={s.blunders >= 4} class:faint={!s.blunders}>{s.blunders}</td>
          <td class="num rating" class:good={s.rating >= 1.15} class:bad={s.rating < 0.85}>{s.rating.toFixed(2)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if st}
    {@const side = sideNow(st)}
    <section class="file">
      <header>
        <GameIcon name={side === 3 ? 'kill/ct' : 'kill/t'} h={30} title={side === 3 ? 'CT side' : 'T side'} fallback={side === 3 ? 'CT' : 'T'} />
        <div class="title">
          <h2 title={r.playerName(st.player)}>{r.playerName(st.player)}</h2>
          <span class="team">{r.teamName(r.match.players[st.player].team)}</span>
        </div>
        <span class="actions">
          <button class="follow" class:following={v.follow === st.player} aria-pressed={v.follow === st.player} onclick={() => v.setFollow(st.player)}>
            {#if v.follow === st.player}<i class="dot"></i>Following{:else}Follow{/if}
          </button>
          <button onclick={() => { v.inspect = st.player; v.tab = 'ballistics' }}>Ballistics</button>
        </span>
      </header>

      <div class="strip">
        <div class="cell"><b class="num" class:good={st.rating >= 1.15} class:bad={st.rating < 0.85}>{st.rating.toFixed(2)}</b><span>Rating</span></div>
        <div class="cell"><b class="num">{st.kills}<span class="sep">-</span>{st.deaths}</b><span>K - D</span></div>
        <div class="cell" title={hasDamage ? undefined : NO_DAMAGE}><b class="num" class:none={!hasDamage}>{adr(st.adr)}</b><span>ADR</span></div>
        <div class="cell"><b class="num">{st.kast.toFixed(0)}<small>%</small></b><span>KAST</span></div>
      </div>

      <table class="sides">
        <thead>
          <tr><th class="l"><span class="label">Side</span></th><th><span class="label">Rds</span></th><th><span class="label">K</span></th><th><span class="label">D</span></th><th><span class="label">ADR</span></th><th><span class="label">KAST</span></th></tr>
        </thead>
        <tbody>
          {#each ['CT', 'T'] as sd (sd)}
            {@const s = st.sides?.[sd]}
            {#if s}
              <tr>
                <td class="l">
                  <span class="side {sd === 'CT' ? 'ct' : 't'}">
                    <GameIcon name={sd === 'CT' ? 'kill/ct' : 'kill/t'} h={16} title={sd === 'CT' ? 'CT side' : 'T side'} />{sd}
                  </span>
                </td>
                <td class="num dim">{s.rounds}</td>
                <td class="num">{s.kills}</td>
                <td class="num">{s.deaths}</td>
                <td class="num" class:dim={!hasDamage} title={hasDamage ? undefined : NO_DAMAGE}>{adr(s.adr)}</td>
                <td class="num">{s.kast.toFixed(0)}%</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>

      <section class="group">
        <h3 class="label">Impact</h3>
        <dl>
          <div class="row"><dt>Round swing</dt><dd class="num" class:good={st.swing >= 3} class:bad={st.swing <= -3}>{signed(st.swing)}%</dd></div>
          <div class="row"><dt>Kills and deaths per round</dt><dd class="num">{st.kpr} <span class="faint">/</span> {st.dpr}</dd></div>
          <div class="row"><dt>Opening duels won</dt><dd class="num">{st.openingKills} <span class="faint">of</span> {st.openingKills + st.openingDeaths}</dd></div>
          <div class="row"><dt>Clutches won</dt><dd class="num">{st.clutchesWon} <span class="faint">of</span> {st.clutchesPlayed}</dd></div>
          <div class="row">
            <dt>Multi kills</dt>
            <dd class="num multi">
              {#each multi as [n, c] (n)}<span class="chip"><b>{n}K</b>{#if c > 1}<span class="faint sub">×{c}</span>{/if}</span>{:else}<span class="faint">-</span>{/each}
            </dd>
          </div>
          <div class="row" title={hasDamage ? undefined : NO_DAMAGE}>
            <dt>Damage dealt</dt><dd class="num" class:faint={!hasDamage}>{hasDamage ? st.damage.toLocaleString('en-US') : '-'}</dd>
          </div>
        </dl>
      </section>

      <section class="group">
        <h3 class="label">Teamwork</h3>
        <dl>
          <div class="row"><dt>Trade kills</dt><dd class="num">{st.tradeKills}{#if st.avgTradeTime}<span class="faint sub">in {st.avgTradeTime} s</span>{/if}</dd></div>
          <div class="row"><dt>Deaths traded</dt><dd class="num">{st.tradedDeaths} <span class="faint">of</span> {st.deaths}</dd></div>
          <div class="row"><dt>Isolated deaths</dt><dd class="num" class:bad={st.isolatedDeaths >= 4}>{st.isolatedDeaths}</dd></div>
          <div class="row"><dt>Early deaths</dt><dd class="num" class:bad={st.earlyDeaths >= 4}>{st.earlyDeaths}</dd></div>
          <div class="row"><dt>Time alive per round</dt><dd class="num">{st.timeAlive} s</dd></div>
          <div class="row"><dt>Moved per round</dt><dd class="num">{Math.round(st.travel / 52.5)} m</dd></div>
        </dl>
      </section>

      <section class="group">
        <h3 class="label">Shooting</h3>
        <dl>
          <div class="row"><dt>Shots while still</dt><dd class="num">{st.counterStrafe}%</dd></div>
          <div class="row"><dt>Shots on the run</dt><dd class="num">{st.runningShots}</dd></div>
          <div class="row" title={hasDamage ? undefined : NO_DAMAGE}>
            <dt>Accuracy</dt><dd class="num" class:faint={!hasDamage}>{hasDamage ? `${st.accuracy}%` : '-'}</dd>
          </div>
          <div class="row">
            <dt>Headshot kills</dt>
            <dd class="num with-icon"><GameIcon name="kill/headshot" h={14} title="Headshot" />{headshots(st)}%</dd>
          </div>
          <div class="row"><dt>Kill distance</dt><dd class="num">{st.avgKillDistance ? `${st.avgKillDistance} m` : '-'}</dd></div>
          <div class="row">
            <dt>Died while blind</dt>
            <dd class="num with-icon" class:bad={st.blindDeaths >= 3}><GameIcon name="kill/blind" h={14} title="Blind" />{st.blindDeaths}</dd>
          </div>
        </dl>
      </section>

      <section class="group">
        <div class="ghead"><h3 class="label">Utility</h3><span class="label">Thrown</span></div>
        <div class="nades">
          {#each utility as u (u.label)}
            <div class="nade" class:none={!u.n}>
              <span class="ico"><GameIcon name={u.icon} h={18} title={u.label} fallback={u.label} /></span>
              <span class="what">{u.label}</span>
              <span class="detail">{u.detail}</span>
              <b class="num">{u.n}</b>
            </div>
          {/each}
        </div>
        <dl>
          <div class="row">
            <dt>Flash assists</dt>
            <dd class="num with-icon"><GameIcon name="kill/flash" h={14} title="Flash assist" />{st.flashAssists}</dd>
          </div>
          <div class="row"><dt>Teammates flashed</dt><dd class="num" class:bad={st.teammatesFlashed >= 5}>{st.teammatesFlashed}<span class="faint sub">for {st.teammateBlindTime} s</span></dd></div>
          <div class="row"><dt>Utility lost on death</dt><dd class="num">{money(st.unusedUtilityValue)}</dd></div>
        </dl>
      </section>

      <section class="group">
        <h3 class="label">Kills by weapon</h3>
        <div class="weapons">
          {#each weapons as w (w.name)}
            <div class="weapon">
              <span class="gun"><GameIcon name={w.icon} h={15} title={w.name} fallback={w.name} /></span>
              <span class="what">{w.name}</span>
              <span class="track"><i style:width="{w.share * 100}%"></i></span>
              <b class="num">{w.n}</b>
            </div>
          {:else}
            <p class="faint empty">No kills.</p>
          {/each}
        </div>
      </section>

      <section class="group places">
        <div>
          <h3 class="label">Kills at</h3>
          <dl>
            {#each top(st.killPlaces, 3) as [p, n] (p)}
              <div class="row"><dt>{p}</dt><dd class="num good">{n}</dd></div>
            {:else}
              <p class="faint empty">-</p>
            {/each}
          </dl>
        </div>
        <div>
          <h3 class="label">Deaths at</h3>
          <dl>
            {#each top(st.deathPlaces, 3) as [p, n] (p)}
              <div class="row"><dt>{p}</dt><dd class="num bad">{n}</dd></div>
            {:else}
              <p class="faint empty">-</p>
            {/each}
          </dl>
        </div>
      </section>

      <div class="heat">
        <h3 class="label">Heatmap</h3>
        <div class="seg" role="group" aria-label="Heatmap">
          {#each heatKinds as [kind, label] (kind)}
            {@const on = v.heat?.label === heatLabel(kind)}
            <button class:on aria-pressed={on} onclick={() => heat(kind)}>{label}</button>
          {/each}
        </div>
        {#if v.heat}<button class="plain clear" onclick={() => (v.heat = null)}>Clear</button>{/if}
      </div>

      {#if st.blunders}
        <button class="evidence" onclick={() => (v.tab = 'evidence')}>
          <span class="mark"></span>
          <span class="text">
            <b class="num">{st.blunders} {st.blunders === 1 ? 'piece' : 'pieces'} of evidence</b>
            <span>About {Math.round(st.blunderCost)}% of a round thrown away</span>
          </span>
          <span class="go">Open</span>
        </button>
      {/if}

      <h3 class="label findings">What to work on</h3>
      {#each insights as ins (ins.id)}
        <InsightCard {v} {ins} />
      {:else}
        <p class="dim empty">No findings for this player.</p>
      {/each}
    </section>
  {:else}
    <p class="dim hint">Pick a player to open their file.</p>
  {/if}
</div>

<style>
  .players {
    padding: 8px 14px 24px;
  }

  /* Scoreboard. */
  .board {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .board th {
    padding: 0 0 2px;
    text-align: right;
    border-bottom: 1px solid var(--line);
  }

  .board th.name {
    text-align: left;
    padding-left: 2px;
  }

  .sort {
    position: relative;
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    padding: 7px 4px 7px;
  }

  .sort:hover {
    background: transparent;
    color: var(--text-2);
  }

  .sort.on {
    color: var(--text);
  }

  .sort.on::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: -3px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .board td {
    height: 31px;
    padding: 0 4px;
    text-align: right;
    border-bottom: 1px solid var(--line);
    color: var(--text-2);
  }

  .board td.rating {
    font-weight: 600;
    color: var(--text);
  }

  .board td.good {
    color: var(--good);
  }

  .board td.bad {
    color: var(--bad);
  }

  .board td.ev {
    color: var(--evidence);
  }

  .board td.faint {
    color: var(--text-3);
  }

  .board td.name {
    padding: 0;
    max-width: 120px;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 4px 0 2px;
    background: transparent;
    border: none;
    border-radius: 0;
    text-align: left;
  }

  .who:hover {
    background: transparent;
  }

  .bar {
    flex: none;
    width: 3px;
    height: 16px;
    border-radius: 1px;
    background: var(--text-3);
  }

  tr.ct .bar {
    background: var(--ct);
  }

  tr.t .bar {
    background: var(--t);
  }

  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .ring {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid var(--accent);
  }

  .board tbody tr {
    cursor: pointer;
  }

  .board tbody tr:hover {
    background: var(--surface-2);
  }

  .board tr.selected {
    background: var(--surface-3) !important;
  }

  .board tr.selected td {
    border-bottom-color: var(--line-2);
  }

  /* Player file. */
  .file {
    margin-top: 22px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  h2 {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.05;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .team {
    font-size: 12px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    flex: none;
    display: flex;
    gap: 4px;
  }

  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
    padding: 0 10px;
  }

  .follow.following {
    color: var(--text);
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  /* Headline numbers, same look as the briefing. */
  .strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin-top: 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface-2);
    overflow: hidden;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 9px 10px 8px;
  }

  .cell + .cell {
    border-left: 1px solid var(--line);
  }

  .cell b {
    font-family: var(--display);
    font-size: 21px;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }

  .cell b.good {
    color: var(--good);
  }

  .cell b.bad {
    color: var(--bad);
  }

  .cell b.none {
    color: var(--text-3);
  }

  .cell small {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-3);
    margin-left: 1px;
  }

  .cell b .sep {
    margin: 0 3px;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-3);
  }

  .cell > span {
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    white-space: nowrap;
  }

  /* CT and T split. */
  .sides {
    width: 100%;
    margin-top: 10px;
    border-collapse: collapse;
    font-size: 13px;
  }

  .sides th {
    text-align: right;
    padding: 0 4px 4px;
    border-bottom: 1px solid var(--line);
  }

  .sides td {
    text-align: right;
    height: 29px;
    padding: 0 4px;
    border-bottom: 1px solid var(--line);
  }

  .sides .l {
    text-align: left;
    padding-left: 0;
  }

  .sides th:nth-child(n + 2) {
    width: 46px;
  }

  .side {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--display);
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.04em;
  }

  /* Stat groups. */
  .group {
    margin-top: 22px;
  }

  .group h3 {
    font-size: 11px;
    font-weight: 600;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }

  .ghead {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }

  .ghead h3 {
    border-bottom: none;
  }

  dl {
    margin: 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 29px;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }

  dt {
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
    color: var(--text);
  }

  dd .faint {
    font-weight: 500;
  }

  .sub {
    margin-left: 4px;
  }

  .chip .sub {
    margin-left: 2px;
  }

  dd.good {
    color: var(--good);
  }

  dd.bad {
    color: var(--bad);
  }

  dd.faint {
    font-weight: 500;
    color: var(--text-3);
  }

  .with-icon {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .with-icon :global(.icon) {
    color: var(--text-3);
  }

  .multi {
    display: inline-flex;
    gap: 4px;
  }

  .chip {
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    padding: 4px 6px 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }

  .chip b {
    font-family: var(--display);
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  /* Grenades. */
  .nade {
    display: grid;
    grid-template-columns: 28px 70px 1fr 30px;
    align-items: center;
    gap: 8px;
    height: 34px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }

  .ico,
  .gun {
    display: flex;
    justify-content: center;
    color: var(--text);
  }

  .nade.none .ico,
  .nade.none .what,
  .nade.none b {
    color: var(--text-3);
  }

  .what {
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail {
    font-size: 12px;
    color: var(--text-3);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nade b,
  .weapon b {
    text-align: right;
    font-weight: 600;
    color: var(--text);
  }

  /* Weapons. */
  .weapon {
    display: grid;
    grid-template-columns: 64px 76px 1fr 30px;
    align-items: center;
    gap: 8px;
    height: 32px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }

  .gun {
    justify-content: flex-start;
  }

  .track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .track i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--text-2);
  }

  .places {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .empty {
    margin: 0;
    padding: 8px 0;
  }

  /* Heatmap. */
  .heat {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 22px;
  }

  .heat h3 {
    flex: 1;
    font-size: 11px;
    font-weight: 600;
  }

  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .seg button {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 10px;
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

  .clear {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
    padding: 4px 8px;
  }

  .clear:hover {
    color: var(--text);
  }

  /* Evidence link. */
  .evidence {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    margin-top: 16px;
    padding: 9px 12px 9px 10px;
    text-align: left;
    background: rgba(255, 194, 71, 0.07);
    border-color: rgba(255, 194, 71, 0.28);
    border-radius: var(--radius);
  }

  .evidence:hover {
    background: rgba(255, 194, 71, 0.12);
    border-color: rgba(255, 194, 71, 0.45);
  }

  .mark {
    flex: none;
    width: 8px;
    height: 8px;
    transform: rotate(45deg);
    border-radius: 1px;
    background: var(--evidence);
  }

  .evidence .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .evidence b {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--evidence);
  }

  .evidence .text span {
    font-size: 12px;
    color: var(--text-2);
  }

  .go {
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
  }

  .evidence:hover .go {
    color: var(--text);
  }

  .findings {
    margin: 26px 0 0;
    padding-bottom: 2px;
    font-size: 11px;
    font-weight: 600;
  }

  .hint {
    padding: 14px 2px;
  }
</style>
