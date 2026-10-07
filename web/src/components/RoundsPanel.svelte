<script lang="ts">
  import { clock, money } from '../lib/format'
  import { weaponIcon } from '../lib/icons.svelte'
  import { prettyPlace } from '../lib/replay'
  import type { Kill, StoryLine } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { REASON, weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'
  import Icon from './Icon.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  const rounds = $derived(r.match.rounds)
  const info = $derived(r.report.rounds)
  const current = $derived(v.round)

  // Rounds the user opened or closed by hand. The rest follow playback:
  // only the round being watched is open.
  let toggled = $state<Record<number, boolean>>({})
  const isOpen = (i: number) => toggled[i] ?? i === current

  // What the in game clock showed at a tick. After the plant it shows the
  // bomb timer instead.
  function at(round: number, tick: number): { text: string; bomb: boolean } {
    const rd = rounds[round]
    const plant = r.roundBomb[round].find((e) => e.kind === 'planted')
    if (plant && tick >= plant.tick) return { text: clock(rd.bombTime - (tick - plant.tick) / r.rate), bomb: true }
    return { text: clock(rd.roundTime - (tick - rd.freezeEndTick) / r.rate), bomb: false }
  }

  const cls = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')
  const color = (side: number) => (side === 3 ? 'var(--ct)' : side === 2 ? 'var(--t)' : 'var(--text-2)')

  const REASON_ICON: Record<string, string> = {
    bomb_exploded: 'weapon/planted_c4',
    bomb_defused: 'hud/defuse',
    t_eliminated: 'hud/elimination',
    ct_eliminated: 'hud/elimination',
    time_ran_out: 'hud/time',
  }
  const REASON_SHORT: Record<string, string> = {
    t_eliminated: 'T eliminated',
    ct_eliminated: 'CT eliminated',
  }
  const reason = (s: string) => REASON_SHORT[s] ?? REASON[s] ?? s
  const BUY: Record<string, string> = { pistol: 'Pistol', eco: 'Eco', force: 'Force', full: 'Full buy' }
  const site = (s: string) => (s === 'A' ? 'hud/bombsite-a' : s === 'B' ? 'hud/bombsite-b' : null)

  const KILLS = new Set(['opening', 'kill', 'trade', 'swing', 'death'])

  // The kill a story line is about, found by tick and player.
  function killOf(round: number, line: StoryLine): Kill | undefined {
    const ks = r.roundKills[round].filter((k) => k.tick === line.tick && (k.killer === line.player || k.victim === line.player))
    return ks.find((k) => line.text.includes(r.playerName(k.victim))) ?? ks[0]
  }

  function swing(k: Kill): number {
    const i = r.kills.indexOf(k)
    return r.report.killSwing?.[i] ?? 0
  }

  function bombAt(round: number, tick: number, kind: string) {
    return r.roundBomb[round].find((e) => e.kind === kind && e.tick === tick)
  }

  function toggle(i: number) {
    toggled = { ...toggled, [i]: !isOpen(i) }
  }

  // The list follows the round being watched, unless the user scrolled
  // away from it to read another round.
  let cards: HTMLElement[] = $state([])
  let shown = -1

  function scroller(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY
      if (o === 'auto' || o === 'scroll') return p
    }
    return null
  }

  $effect(() => {
    const i = current
    const el = cards[i]
    if (!el) return
    const box = scroller(el)
    if (!box) return
    const b = box.getBoundingClientRect()
    const old = shown >= 0 ? cards[shown]?.getBoundingClientRect() : null
    const first = shown < 0
    shown = i
    if (old && (old.bottom < b.top || old.top > b.bottom)) return
    const a = el.getBoundingClientRect()
    const pad = 12
    if (a.top >= b.top + pad && a.bottom <= b.bottom - pad) return
    // The whole card when it fits, otherwise its top.
    const top = a.top < b.top + pad || a.height > b.height - 2 * pad
    box.scrollBy({ top: top ? a.top - b.top - pad : a.bottom - b.bottom + pad, behavior: first ? 'instant' : 'smooth' })
  })
</script>

<div class="rounds">
  {#each rounds as rd, i (i)}
    {@const ri = info[i]}
    {@const ev = r.roundBlunders[i].length}
    {@const open = isOpen(i)}
    <section class="card {cls(rd.winner)}" class:current={i === current} bind:this={cards[i]}>
      <button class="head" onclick={() => v.seekRound(i)} title="Go to round {i + 1}">
        <span class="no num">{String(i + 1).padStart(2, '0')}</span>
        <span class="line">
          <span class="ricon">
            <GameIcon name={REASON_ICON[rd.reason] ?? null} h={15} color={color(rd.winner)} title={reason(rd.reason)} />
          </span>
          <span class="winner {cls(rd.winner)}">{rd.winnerTeam >= 0 ? r.teamName(rd.winnerTeam) : '-'}</span>
          <span class="reason">{reason(rd.reason)}</span>
        </span>
        <span class="score num">
          <span class={cls(rd.sideOf[0])}>{rd.scoreA}</span><i>:</i><span class={cls(rd.sideOf[1])}>{rd.scoreB}</span>
        </span>
        <span class="buys">
          {#each [0, 1] as t (t)}
            <span class="buy" title="{r.teamName(t)}: {BUY[ri.buyType[t]] ?? ri.buyType[t]}, {money(ri.equipValue[t])} of equipment">
              <span class="kind {cls(rd.sideOf[t])}">{BUY[ri.buyType[t]] ?? ri.buyType[t]}</span>
              <span class="val num">{money(ri.equipValue[t])}</span>
            </span>
          {/each}
          {#if ev}
            <span class="ev num" title="{ev} {ev === 1 ? 'piece' : 'pieces'} of evidence">{ev}</span>
          {/if}
        </span>
      </button>
      <button class="toggle plain" class:open aria-expanded={open} aria-label="Round {i + 1} story" title={open ? 'Hide the story' : 'Show the story'} onclick={() => toggle(i)}>
        <Icon name="chevron" size={14} />
      </button>

      {#if open}
        <div class="story">
          {#if ri.setup?.[0] || ri.setup?.[1]}
            <div class="setup">
              <span class="label">Setup after 20 seconds</span>
              {#each [0, 1] as t (t)}
                {#if ri.setup?.[t]}
                  <p><b class={cls(rd.sideOf[t])}>{rd.sideOf[t] === 3 ? 'CT' : 'T'}</b><span>{ri.setup[t]}</span></p>
                {/if}
              {/each}
            </div>
          {/if}
          {#if ri.hit}
            <p class="hit">
              <GameIcon name={site(ri.hit)} h={15} title="Site {ri.hit}" fallback={ri.hit} />
              <span><b class="t">T</b> reached the site after <span class="num">{Math.round(ri.hitTime)} s</span></span>
            </p>
          {/if}
          <ol>
            {#each (ri.story ?? []).filter((l) => l.kind !== 'setup' && l.kind !== 'hit') as line, j (j)}
              {@const t = at(i, line.tick)}
              {@const k = KILLS.has(line.kind) ? killOf(i, line) : undefined}
              <li class={line.kind}>
                <button onclick={() => v.seek(line.tick - 3 * r.rate)} title={line.text}>
                  <span class="time num" class:bomb={t.bomb && line.kind !== 'end'}>{line.kind === 'end' ? 'End' : t.text}</span>
                  {#if k}
                    {@const traded = line.text.endsWith('(traded)')}
                    {@const where = prettyPlace(k.victimPlace ?? '')}
                    <span class="feed">
                      {#if k.killer >= 0 && k.killer !== k.victim}
                        <span class="who {cls(k.killerSide)}">{r.playerName(k.killer)}</span>
                      {/if}
                      <span class="gun">
                        {#if k.attackerBlind}<GameIcon name="kill/blind" h={13} title="Killer was blind" />{/if}
                        <GameIcon name={weaponIcon(k.weapon, k.killerSide)} h={14} title={weaponName(k.weapon)} fallback={weaponName(k.weapon)} />
                        {#if k.noScope}<GameIcon name="kill/noscope" h={13} title="No scope" />{/if}
                        {#if k.throughSmoke}<GameIcon name="kill/smoke" h={13} title="Through smoke" />{/if}
                        {#if k.wallbang}<GameIcon name="kill/penetrate" h={13} title="Wallbang" />{/if}
                        {#if k.headshot}<GameIcon name="kill/headshot" h={13} title="Headshot" fallback="HS" />{/if}
                      </span>
                      <span class="who {cls(k.victimSide)}">{r.playerName(k.victim)}</span>
                      {#if where}<span class="where">{where}</span>{/if}
                    </span>
                    <span class="tags">
                      {#if line.kind === 'opening'}<span class="tag" title="First kill of the round">Opening</span>{/if}
                      {#if line.kind === 'trade'}<span class="tag" title="This kill traded a teammate">Trade</span>{/if}
                      {#if line.kind === 'swing'}<span class="tag swing" title="Round win chance swing">+{Math.round(swing(k) * 100)}%</span>{/if}
                      {#if traded}<span class="tag soft" title="The killer died soon after, the death was traded">Traded</span>{/if}
                    </span>
                  {:else if line.kind === 'plant' || line.kind === 'defuse'}
                    {@const b = bombAt(i, line.tick, line.kind === 'plant' ? 'planted' : 'defused')}
                    <span class="feed">
                      <span class="gun">
                        <GameIcon name={line.kind === 'plant' ? 'weapon/c4' : 'hud/defuse'} h={14} title={line.kind === 'plant' ? 'Bomb planted' : 'Bomb defused'} />
                      </span>
                      {#if b}
                        <span class="who {cls(r.sideOf(r.match.players[b.player]?.team ?? -1, i))}">{r.playerName(b.player)}</span>
                        <span class="what">{line.kind === 'plant' ? 'planted on' : 'defused the bomb'}</span>
                        {#if line.kind === 'plant'}
                          <GameIcon name={site(b.site)} h={14} title="Site {b.site}" fallback={b.site} />
                        {/if}
                      {:else}
                        <span class="what">{line.text}</span>
                      {/if}
                    </span>
                  {:else if line.kind === 'end'}
                    <span class="feed end">
                      <span class="gun">
                        <GameIcon name={REASON_ICON[rd.reason] ?? null} h={14} color={color(rd.winner)} />
                      </span>
                      <span class="what">{line.text}</span>
                    </span>
                  {:else}
                    <span class="feed text">
                      {#if line.kind === 'clutch'}<span class="tag clutch">Clutch</span>{/if}
                      <span class="what">{line.text}</span>
                    </span>
                  {/if}
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
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 12px 24px;
  }

  .card {
    --side: var(--line-2);
    position: relative;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: inset 3px 0 0 var(--side);
    overflow: hidden;
  }

  .card.ct {
    --side: var(--ct);
  }

  .card.t {
    --side: var(--t);
  }

  .card.current {
    background: var(--surface-2);
    border-color: var(--accent);
  }

  .head {
    width: 100%;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    column-gap: 10px;
    row-gap: 5px;
    align-items: center;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 9px 40px 9px 14px;
    font-weight: 400;
  }

  .head:hover {
    background: rgba(255, 255, 255, 0.025);
  }

  .no {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 700;
    color: var(--text-3);
  }

  .current .no {
    color: var(--text);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .ricon {
    flex: none;
    display: flex;
    width: 16px;
    justify-content: center;
  }

  .winner {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reason {
    flex: 0 10 auto;
    min-width: 0;
    font-size: 12px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .score {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
  }

  .score i {
    font-style: normal;
    color: var(--text-3);
    margin: 0 2px;
  }

  .ct {
    color: var(--ct);
  }

  .t {
    color: var(--t);
  }

  .buys {
    grid-column: 2 / 4;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 18px;
    gap: 10px;
    align-items: center;
  }

  .buy {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .buy .kind {
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .buy .val {
    font-size: 12px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ev {
    grid-column: 3;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    background: var(--evidence);
    color: var(--bg);
    font-family: var(--display);
    font-size: 11.5px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }

  .toggle {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 26px;
    height: 26px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
  }

  .toggle:hover {
    color: var(--text);
  }

  .toggle :global(svg) {
    transition: transform 0.15s;
  }

  .toggle.open :global(svg) {
    transform: rotate(180deg);
  }

  /* Story. */
  .story {
    container-type: inline-size;
    margin: 0 0 0 3px;
    padding: 10px 12px 10px 11px;
    border-top: 1px solid var(--line);
  }

  /* Narrow panel: the place moves to the tooltip. */
  @container (max-width: 345px) {
    .where {
      display: none;
    }
  }

  .setup {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 8px;
  }

  .setup .label {
    font-size: 10.5px;
    margin-bottom: 1px;
  }

  .setup p,
  .hit {
    display: flex;
    gap: 8px;
    margin: 0;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--text-2);
  }

  .setup b,
  .hit b {
    flex: none;
    width: 20px;
    font-family: var(--display);
    font-weight: 700;
    font-size: 12px;
  }

  .hit {
    align-items: center;
    padding: 6px 0 8px;
    border-top: 1px solid var(--line);
  }

  .hit b {
    width: auto;
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
    padding-top: 4px;
  }

  li button {
    width: 100%;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 28px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    margin: 0 -6px;
    width: calc(100% + 12px);
    font-weight: 400;
    font-size: 12.5px;
    color: var(--text-2);
  }

  li button:hover {
    background: var(--surface-3);
  }

  .time {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-3);
  }

  .time.bomb {
    color: var(--accent);
  }

  li.end .time {
    font-family: var(--display);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 10.5px;
  }

  .feed {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .feed.text,
  .feed.end {
    white-space: normal;
  }

  .feed.text,
  .feed.end {
    grid-column: 2 / 4;
  }

  .who {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 120px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gun {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text);
  }

  .where {
    flex: 0 100 auto;
    min-width: 0;
    font-size: 11.5px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  li.end .what {
    font-family: var(--display);
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }

  .tags {
    display: flex;
    gap: 4px;
  }

  .tag {
    flex: none;
    font-family: var(--display);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1;
    padding: 3px 5px 2px;
    border-radius: 3px;
    color: var(--text-2);
    background: var(--surface-3);
  }

  .tag.swing {
    color: var(--text);
    letter-spacing: 0.02em;
  }

  .tag.soft {
    color: var(--text-3);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  li.opening .tag:first-child {
    color: var(--text);
  }

  .feed.text .tag {
    margin-right: 2px;
  }
</style>
