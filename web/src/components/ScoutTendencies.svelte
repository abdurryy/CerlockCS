<script module lang="ts">
  import { copyText } from '../lib/clipboard'
  import { mapLabel } from '../lib/format'
  import type { MapScout, RoleCard, Situation } from '../lib/scout/types'
  import { basis, count } from './ScoutRoles.svelte'

  // Discord cuts messages at 2000 characters.
  const DISCORD_MAX = 2000

  // Bold, italics, strike, code and spoilers stay as typed in names.
  function esc(s: string): string {
    return s.replace(/([\\*_~`|])/g, '\\$1')
  }

  function ctText(c: RoleCard): string {
    const n = c.ct.rounds
    const label = c.ct.label || 'Flex'
    if (label === 'AWP') return `AWP in ${count(c.ct.awp, n)} of ${n}`
    if (label === 'Rotator') return `Rotator, went to the other site in ${c.ct.rotates} of ${n}`
    if (label === 'Flex') return `Flex over ${n} rounds`
    if (label === 'A anchor' || label === 'B anchor' || label === 'Mid') {
      const spot = c.ct.place && c.ct.placeShare >= 0.5 ? `, mostly at ${c.ct.place}` : ''
      return `${label} in ${count(c.ct.zoneShare, n)} of ${n}${spot}`
    }
    return `${label} in ${count(c.ct.placeShare, n)} of ${n}`
  }

  function tText(c: RoleCard): string {
    const n = c.t.rounds
    const label = c.t.label || 'Flex'
    const pct = (v: number) => `${Math.round(v * 100)}%`
    if (label === 'Entry') return `Entry, first on site in ${pct(c.t.entry)} of hits`
    if (label === 'Lurker') return `Lurker, away from the team in ${pct(c.t.lurk)} of hits`
    if (label === 'Support') return `Support, threw ${pct(c.t.support)} of the utility`
    if (label === 'AWP') return `AWP in ${count(c.t.awp, n)} of ${n}`
    return `Flex over ${n} rounds`
  }

  // roleLine is one player for the Discord summary, like "**carl**: CT A
  // anchor in 6 of 7, mostly at Mini. T Entry, first on site in 44% of
  // hits."
  export function roleLine(c: RoleCard): string {
    const b = basis(c)
    const parts: string[] = []
    if (c.ct.rounds) parts.push(`CT ${ctText(c)}.`)
    if (c.t.rounds) parts.push(`T ${tText(c)}.`)
    if (c.confidence === 'low') parts.push(`Only ${b.rounds} ${b.side} ${b.rounds === 1 ? 'round' : 'rounds'}.`)
    return `**${esc(c.name)}**: ${parts.join(' ')}`
  }

  // discordText is the map's summary ready to paste: title, record, the
  // tendencies and one line per player, cut to fit one message.
  export function discordText(m: MapScout, teamName: string): string {
    const matches = `${m.replays.length} ${m.replays.length === 1 ? 'match' : 'matches'}`
    const head = [
      `**${esc(teamName || 'Team')} on ${mapLabel(m.map)}**`,
      `${matches}, ${m.ctRounds} CT and ${m.tRounds} T rounds. Won ${m.won.ct} of ${m.ctRounds} on CT, ${m.won.t} of ${m.tRounds} on T.`,
    ]
    let tend = m.tendencies.map((t) => `- ${esc(t)}`)
    let roles = m.roles.map((c) => `- ${roleLine(c)}`)
    const build = () => {
      const parts = [...head]
      if (tend.length) parts.push('', '**Tendencies**', ...tend)
      if (roles.length) parts.push('', '**Roles**', ...roles)
      return parts.join('\n')
    }
    let out = build()
    while (out.length > DISCORD_MAX && tend.length > 3) {
      tend = tend.slice(0, -1)
      out = build()
    }
    while (out.length > DISCORD_MAX && roles.length) {
      roles = roles.slice(0, -1)
      out = build()
    }
    return out.length > DISCORD_MAX ? out.slice(0, DISCORD_MAX) : out
  }

  // A tendency with a player's name at the start, or right after the
  // situation it is about, shows the name in the player's colour.
  export interface Line {
    // The situation the sentence is about, or just the side for team
    // notes like "On CT 4 of 5 players...".
    situation: Situation | null
    side: '' | 'ct' | 't'
    name: string
    color: string
    rest: string
  }

  export function lineOf(text: string, m: MapScout): Line {
    const situation = m.situations.find((s) => text.startsWith(`On ${s.title} `)) ?? null
    const bare = situation ? null : /^On (CT|T) /.exec(text)
    const side = situation ? situation.side : bare ? (bare[1].toLowerCase() as 'ct' | 't') : ''
    const after = text.slice(situation ? `On ${situation.title} `.length : bare ? bare[0].length : 0)
    const cards = [...m.roles].sort((a, b) => b.name.length - a.name.length)
    const c = cards.find((r) => r.name && after.startsWith(r.name) && !/[\p{L}\p{N}]/u.test(after.charAt(r.name.length)))
    if (!c) return { situation, side, name: '', color: '', rest: after }
    return { situation, side, name: c.name, color: c.color, rest: after.slice(c.name.length) }
  }
</script>

<script lang="ts">
  import ScoutIcon from './ScoutIcon.svelte'

  // Tendencies: the strongest patterns of the map in plain sentences,
  // with a copy button for the team chat.
  let {
    scout,
    teamName,
    onwatch,
  }: { scout: MapScout; teamName: string; onwatch: (s: Situation, opener: HTMLElement | null) => void } = $props()

  const lines = $derived(scout.tendencies.map((t) => lineOf(t, scout)))
  const rounds = $derived(scout.ctRounds + scout.tRounds)
  let copied = $state<'' | 'ok' | 'fail'>('')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy() {
    const ok = await copyText(discordText(scout, teamName))
    copied = ok ? 'ok' : 'fail'
    clearTimeout(timer)
    timer = setTimeout(() => (copied = ''), 2200)
  }

  $effect(() => () => clearTimeout(timer))
</script>

<article class="card tend" aria-labelledby="tend-{scout.map}">
  <div class="head">
    <div class="ht">
      <h3 id="tend-{scout.map}">What they tend to do</h3>
      <p class="dim">
        Strongest patterns first, from {scout.ctRounds} CT and {scout.tRounds} T rounds in {scout.replays.length}
        {scout.replays.length === 1 ? 'match' : 'matches'}.
      </p>
    </div>
    <button class="btn" onclick={copy} title="Copy the map, the tendencies and the roles as text for Discord">
      {#if copied === 'ok'}
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>Copied</span>
      {:else}
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
        <span>{copied === 'fail' ? 'Could not copy' : 'Copy for Discord'}</span>
      {/if}
    </button>
  </div>

  {#if lines.length}
    <ol class="list">
      {#each lines as l, i (i)}
        <li>
          <span class="txt">
            {#if l.situation}On <b class="sit"><span class={l.side}>{l.side.toUpperCase()}</span>{l.situation.title.slice(l.side.length)}</b>{' '}{:else if l.side}On <b class="sit {l.side}">{l.side.toUpperCase()}</b>{' '}{/if}{#if l.name}<b style:color={l.color}>{l.name}</b>{/if}{l.rest}
          </span>
          {#if l.situation && l.situation.tracks.length}
            {@const s = l.situation}
            <button class="plain watch" title="Watch {s.title}" onclick={(e) => onwatch(s, e.currentTarget)}>
              <ScoutIcon name="play" size={10} /><span>Watch</span>
            </button>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="none faint">No clear patterns in {rounds} rounds. More demos of this team on {mapLabel(scout.map)} will show more.</p>
  {/if}

  {#if scout.replays.length === 1 && lines.length}
    <p class="small faint">
      <ScoutIcon name="info" size={13} />
      <span>All of this comes from one match, so most patterns rest on a few rounds. Add more demos of this team to firm it up.</span>
    </p>
  {/if}
</article>

<style>
  .card {
    margin-top: 4px;
    padding: 14px 16px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .ht {
    min-width: 0;
  }

  h3 {
    font-size: 21px;
  }

  .ht p {
    margin: 2px 0 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 13px 0 11px;
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  .list {
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    counter-reset: tend;
  }

  .list li {
    counter-increment: tend;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 38px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }

  .list li::before {
    content: counter(tend);
    flex: none;
    width: 18px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 700;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .txt {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
    line-height: 1.45;
  }

  .txt b {
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 700;
  }

  .txt b.sit {
    font-weight: 600;
  }

  .watch {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    color: var(--text-2);
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
  }

  .watch:hover {
    color: var(--text);
  }

  .none {
    margin: 12px 0 0;
  }

  .small {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin: 8px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }

  .small :global(.icon) {
    margin-top: 1px;
  }

  @media (max-width: 560px) {
    .head {
      flex-direction: column;
    }
  }
</style>
