<script lang="ts">
  import { money } from '../lib/format'
  import { weaponIcon } from '../lib/icons.svelte'
  import { prettyPlace } from '../lib/replay'
  import type { Insight, Kill, Moment } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'
  import { EQ, weaponName } from '../lib/weapons'
  import GameIcon from './GameIcon.svelte'
  import Icon from './Icon.svelte'

  let { v, ins }: { v: Viewer; ins: Insight } = $props()
  const r = $derived(v.replay)
  let expanded = $state(false)

  const shown = $derived(expanded ? ins.moments : ins.moments.slice(0, 3))
  const side = $derived(ins.player >= 0 ? r.sideOf(ins.team, v.round) : 0)
  const word = { high: 'Serious', medium: 'Look at', low: 'Minor', positive: 'Good' }

  // Labels start with the round ("R5 ..."), it gets its own column.
  const text = (label: string) => label.replace(/^R\d+\s+/, '')
  // "$12300" reads better as "$12,300".
  const tidy = (s: string) => s.replace(/\$(\d{4,})/g, (_, n) => money(Number(n)))
  const big = (n: string) => Number(n).toLocaleString('en-US')

  const cls = (side: number) => (side === 3 ? 'ct' : side === 2 ? 't' : '')
  const sideOf = (p: number, round: number) => r.sideOf(r.match.players[p]?.team ?? -1, round)

  interface Part {
    text: string
    p?: number
  }

  interface Gear {
    name: string | null
    title: string
  }

  // A moment drawn like the kill feed where the data allows it, plain text
  // with coloured names otherwise.
  type Line =
    | { kind: 'kill'; k: Kill; note: string }
    | { kind: 'flash'; from: number; to: number; note: string }
    | { kind: 'util'; p: number; util: number[]; note: string }
    | { kind: 'plant'; p: number; site: string; note: string }
    | { kind: 'text'; gear: Gear | null; parts: Part[]; note: string }

  // Player names, longest first so one name inside another does not win.
  const names = $derived(
    r.match.players
      .map((p) => ({ p: p.index, name: r.playerName(p.index) }))
      .filter((x) => x.name)
      .sort((a, b) => b.name.length - a.name.length),
  )
  const nameRe = $derived(
    names.length ? new RegExp(`(${names.map((x) => x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`) : null,
  )

  function parts(s: string): Part[] {
    if (!nameRe) return [{ text: s }]
    return s
      .split(nameRe)
      .filter(Boolean)
      .map((t) => ({ text: t, p: names.find((x) => x.name === t)?.p }))
  }

  function held(p: number, tick: number): Gear | null {
    const s = r.state(p, tick)
    const id = s.weapon || s.primary
    return id ? { name: weaponIcon(id, s.side), title: weaponName(id) } : null
  }

  // The short note shown on the right of a death.
  function deathNote(t: string, k: Kill): string {
    let x: RegExpMatchArray | null
    if ((x = t.match(/nearest teammate (\d+)u away$/))) return `${big(x[1])} u away`
    if (/as the last player alive$/.test(t)) return 'last alive'
    if ((x = t.match(/^died (\d+)u from the closest teammate$/))) return `${big(x[1])} u away`
    if ((x = t.match(/^died after (\d+)s$/))) return `${x[1]}s in`
    if (/died blind to/.test(t)) return 'blind'
    if (/died first to/.test(t)) return prettyPlace(k.victimPlace ?? '')
    return ''
  }

  function line(m: Moment): Line {
    const t = text(m.label)
    const kills = r.roundKills[m.round] ?? []
    // Deaths are shown four seconds before the kill.
    const lead = Math.floor(4 * r.rate)
    const death = () =>
      kills.find((k) => k.victim === m.player && Math.abs(k.tick - m.tick - lead) <= 1) ??
      kills.find((k) => k.victim === m.player && k.tick >= m.tick && k.tick - m.tick <= 6 * r.rate)
    let x: RegExpMatchArray | null

    if ((x = t.match(/ flashed .+ for ([\d.]+)s$/))) {
      const lead = Math.floor(2 * r.rate)
      const b = (r.roundBlinds[m.round] ?? []).find((b) => b.victim === m.player && Math.abs(b.tick - m.tick - lead) <= 1)
      if (b) return { kind: 'flash', from: b.attacker, to: b.victim, note: `${x[1]}s` }
    }
    if ((x = t.match(/died holding \$(\d+) of utility$/))) {
      const k = death()
      if (k) return { kind: 'util', p: k.victim, util: k.victimUtility ?? [], note: money(Number(x[1])) }
    }
    if (/^lost after .+ got the first kill$/.test(t)) {
      const k = kills.find((k) => k.killer === m.player && k.tick === m.tick)
      if (k) return { kind: 'kill', k, note: 'round lost' }
    }
    if (/^killed by .+ without a shot$/.test(t)) {
      const k = kills.find((k) => k.victim === m.player && k.tick >= m.tick - r.rate)
      if (k) return { kind: 'kill', k, note: 'no shot' }
    }
    if (/\bdied\b/.test(t)) {
      const k = death()
      if (k) return { kind: 'kill', k, note: deathNote(t, k) }
    }
    if ((x = t.match(/^bomb planted on (\w+), round lost$/))) {
      const b = (r.roundBomb[m.round] ?? []).find((e) => e.kind === 'planted' && e.tick === m.tick)
      if (b) return { kind: 'plant', p: b.player, site: b.site, note: 'round lost' }
    }
    if (/^flash blinded no enemies$/.test(t)) {
      return { kind: 'text', gear: { name: 'weapon/flashbang', title: weaponName(EQ.flash) }, parts: [{ text: 'Blinded no enemies' }], note: '' }
    }
    if ((x = t.match(/^lost a full buy against (.+) \(\$(\d+) vs \$(\d+)\)$/))) {
      return { kind: 'text', gear: null, parts: [{ text: `Full buy lost to ${x[1]}` }], note: `${money(Number(x[2]))} vs ${money(Number(x[3]))}` }
    }
    if ((x = t.match(/^(\d+)° off when (.+) appeared$/))) {
      return { kind: 'text', gear: held(m.player, m.tick + 2 * r.rate), parts: [...parts(x[2]), { text: ' appeared' }], note: `${x[1]}° off` }
    }
    if ((x = t.match(/^(\d+) of .+'s (\d+) shots against (.+) were fired on the move, at (\d+) u\/s/))) {
      return {
        kind: 'text',
        gear: held(m.player, m.tick + r.rate),
        parts: [{ text: `${x[1]} of ${x[2]} shots on the move against ` }, ...parts(x[3])],
        note: `${x[4]} u/s`,
      }
    }
    return { kind: 'text', gear: null, parts: parts(tidy(t)), note: '' }
  }

  const lines = $derived(shown.map((m) => ({ m, l: line(m) })))
  const SITE: Record<string, string> = { A: 'hud/bombsite-a', B: 'hud/bombsite-b' }
</script>

<article class={ins.severity}>
  <div class="meta">
    <span class="sev">{word[ins.severity]}</span>
    {#if ins.player >= 0}
      <span class="pname {cls(side)}">{r.playerName(ins.player)}</span>
    {/if}
  </div>
  <h3>{tidy(ins.title)}</h3>
  <p class="detail">{tidy(ins.detail)}</p>
  {#if ins.tip}
    <p class="tip"><span class="label">Tip</span><span>{tidy(ins.tip)}</span></p>
  {/if}
  {#if ins.moments.length}
    <ol>
      {#each lines as { m, l }, i (i)}
        <li>
          <button onclick={() => v.jump(m, m.player >= 0 ? [m.player] : [])} title="{tidy(m.label)}. Watch this moment.">
            <span class="rd num">R{m.round + 1}</span>
            <span class="feed">
              {#if l.kind === 'kill'}
                {@const k = l.k}
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
              {:else if l.kind === 'flash'}
                <span class="who {cls(sideOf(l.from, m.round))}">{r.playerName(l.from)}</span>
                <span class="gun"><GameIcon name="weapon/flashbang" h={14} title="Flashbang" fallback="flashed" /></span>
                <span class="who {cls(sideOf(l.to, m.round))}">{r.playerName(l.to)}</span>
              {:else if l.kind === 'util'}
                <span class="who {cls(sideOf(l.p, m.round))}">{r.playerName(l.p)}</span>
                <span class="gun nades">
                  {#each l.util as id, j (j)}
                    <GameIcon name={weaponIcon(id, sideOf(l.p, m.round))} h={15} title={weaponName(id)} fallback={weaponName(id)} />
                  {/each}
                </span>
              {:else if l.kind === 'plant'}
                <span class="who {cls(sideOf(l.p, m.round))}">{r.playerName(l.p)}</span>
                <span class="gun">
                  <GameIcon name="weapon/c4" h={14} title="Bomb planted" fallback="planted" />
                  <GameIcon name={SITE[l.site] ?? null} h={14} title="Site {l.site}" fallback={l.site} />
                </span>
              {:else}
                {#if l.gear}
                  <span class="gun"><GameIcon name={l.gear.name} h={14} title={l.gear.title} fallback={l.gear.title} /></span>
                {/if}
                <span class="say">
                  {#each l.parts as part, j (j)}
                    {#if part.p !== undefined}<b class={cls(sideOf(part.p, m.round))}>{part.text}</b>{:else}{part.text}{/if}
                  {/each}
                </span>
              {/if}
            </span>
            <span class="note num">{l.note}</span>
            <span class="go"><Icon name="play" size={10} /></span>
          </button>
        </li>
      {/each}
    </ol>
    {#if ins.moments.length > 3}
      <button class="more plain" onclick={() => (expanded = !expanded)}>
        {expanded ? 'Show fewer' : `Show ${ins.moments.length - 3} more`}
      </button>
    {/if}
  {/if}
</article>

<style>
  article {
    --sev: var(--text-2);
    padding: 14px 0 16px;
    border-top: 1px solid var(--line);
  }

  .high {
    --sev: var(--accent);
  }

  .medium {
    --sev: var(--warn);
  }

  .positive {
    --sev: var(--good);
  }

  .meta {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .sev {
    flex: none;
    font-family: var(--display);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    line-height: 1;
    color: var(--sev);
    background: color-mix(in srgb, var(--sev) 14%, transparent);
    border-radius: var(--radius-sm);
    padding: 4px 6px 3px;
  }

  .pname {
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3 {
    font-size: 16px;
    font-weight: 600;
    line-height: 1.25;
    margin: 8px 0 4px;
  }

  p {
    margin: 0;
  }

  .detail {
    color: var(--text-2);
    font-size: 13px;
  }

  .tip {
    display: flex;
    gap: 10px;
    margin-top: 8px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text-2);
  }

  .tip .label {
    flex: none;
    font-size: 10.5px;
    line-height: 18px;
    color: var(--text-3);
  }

  ol {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }

  li {
    border-top: 1px solid var(--line);
  }

  li button {
    width: calc(100% + 12px);
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto 10px;
    gap: 8px;
    align-items: center;
    min-height: 30px;
    margin: 0 -6px;
    padding: 4px 6px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0;
    font-weight: 400;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--text-2);
  }

  li button:hover {
    background: var(--surface-2);
  }

  .rd {
    font-family: var(--display);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--text-3);
  }

  li button:hover .rd {
    color: var(--text);
  }

  /* One moment, laid out like the kill feed. */
  .feed {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .who {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
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

  .nades {
    gap: 4px;
  }

  .say {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .say b {
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
  }

  .note {
    font-size: 12px;
    color: var(--text-3);
    white-space: nowrap;
    text-align: right;
  }

  li button:hover .note {
    color: var(--text-2);
  }

  .go {
    display: flex;
    color: var(--accent);
    opacity: 0;
    transition: opacity 0.12s;
  }

  li button:hover .go,
  li button:focus-visible .go {
    opacity: 1;
  }

  .more {
    margin-top: 6px;
    padding: 3px 6px;
    margin-left: -6px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-3);
  }

  .more:hover {
    color: var(--text);
  }

  /* Team colours last so they win over the name styles above. */
  .ct {
    color: var(--ct);
  }

  .t {
    color: var(--t);
  }
</style>
