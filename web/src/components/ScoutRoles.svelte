<script module lang="ts">
  import type { RoleCard, Zone } from '../lib/scout/types'

  const ZONE_NAME: Record<Zone, string> = { A: 'A site', B: 'B site', mid: 'Mid', other: 'Elsewhere' }

  // count turns a share back into rounds, shares are counts over rounds.
  export function count(share: number, rounds: number): number {
    return Math.round(share * rounds)
  }

  // basis is the round count the confidence goes by: the weaker side when
  // the player played both.
  export function basis(c: RoleCard): { rounds: number; side: string } {
    if (c.ct.rounds && c.t.rounds) return c.ct.rounds <= c.t.rounds ? { rounds: c.ct.rounds, side: 'CT' } : { rounds: c.t.rounds, side: 'T' }
    return c.ct.rounds ? { rounds: c.ct.rounds, side: 'CT' } : { rounds: c.t.rounds, side: 'T' }
  }

  export function zoneName(z: Zone): string {
    return ZONE_NAME[z] ?? z
  }
</script>

<script lang="ts">
  import type { MapScout } from '../lib/scout/types'

  // Roles: one card per player with what they do on each side, and how
  // many rounds it rests on.
  let { scout }: { scout: MapScout } = $props()

  const cards = $derived(scout.roles)

  // Fixed positions or not, read the same way as the team note: players
  // with 5 or more CT rounds who held one zone in 60% of them.
  const fixed = $derived.by(() => {
    const ct = cards.filter((c) => c.ct.rounds >= 5)
    if (ct.length < 3) return ''
    const k = ct.filter((c) => c.ct.zoneShare >= 0.6).length
    const base = `${k} of ${ct.length} players held the same CT zone in 60% or more of their rounds`
    if (k >= 3 && k >= ct.length - 1) return `${base}, so they play fixed positions.`
    if (k <= 1) return `Only ${base}, so their positions change a lot.`
    return `${base}.`
  })

  function ctFacts(c: RoleCard): { label: string; value: string; title: string }[] {
    const n = c.ct.rounds
    const out: { label: string; value: string; title: string }[] = []
    if (!n) return out
    // Off site spots say more by their place name.
    if (c.ct.zone !== 'other') out.push({ label: zoneName(c.ct.zone), value: `${count(c.ct.zoneShare, n)}/${n}`, title: `In the ${zoneName(c.ct.zone)} zone in ${count(c.ct.zoneShare, n)} of ${n} CT rounds` })
    if (c.ct.place) out.push({ label: c.ct.place, value: `${count(c.ct.placeShare, n)}/${n}`, title: `At ${c.ct.place} in ${count(c.ct.placeShare, n)} of ${n} CT rounds` })
    if (c.ct.awp > 0) out.push({ label: 'AWP', value: `${count(c.ct.awp, n)}/${n}`, title: `Had the AWP in ${count(c.ct.awp, n)} of ${n} CT rounds` })
    if (c.ct.rotates > 0) out.push({ label: 'Rotated', value: `${c.ct.rotates}/${n}`, title: `Went to the other site before the first fight in ${c.ct.rotates} of ${n} CT rounds` })
    return out
  }

  function tBars(c: RoleCard): { label: string; share: number; title: string }[] {
    if (!c.t.rounds) return []
    return [
      { label: 'Entry', share: c.t.entry, title: 'First onto the site, share of their T rounds with a site hit' },
      { label: 'Lurk', share: c.t.lurk, title: 'Away from the team and the site at the hit, share of their T rounds with a site hit' },
      { label: 'Utility', share: c.t.support, title: "Share of the team's grenades before site hits" },
      { label: 'AWP', share: c.t.awp, title: 'Share of their T rounds with the AWP' },
    ]
  }

  function confText(c: RoleCard): string {
    const b = basis(c)
    if (c.confidence === 'low') return `Only ${b.rounds} ${b.side} ${b.rounds === 1 ? 'round' : 'rounds'}`
    return c.confidence === 'high' ? 'High' : 'Medium'
  }

  function confTitle(c: RoleCard): string {
    return `${c.confidence.charAt(0).toUpperCase() + c.confidence.slice(1)} confidence, from ${c.ct.rounds} CT and ${c.t.rounds} T rounds`
  }
</script>

<section class="roles" aria-labelledby="roles-{scout.map}">
  <div class="rhead">
    <h3 id="roles-{scout.map}">Roles</h3>
    <p class="dim">
      {#if fixed}{fixed}{:else}What each player does on each side.{/if}
      <span class="faint">Colours match the players in Watch.</span>
    </p>
  </div>

  {#if cards.length}
    <div class="grid">
      {#each cards as c (c.steamId)}
        <article class="role" class:low={c.confidence === 'low'}>
          <header class="top">
            <i class="dot" style:background={c.color}></i>
            <b class="name" style:color={c.color} title={c.name}>{c.name}</b>
            <span class="conf {c.confidence}" title={confTitle(c)}>{confText(c)}</span>
          </header>

          <div class="side">
            <div class="sh">
              <span class="tag ct">CT</span>
              {#if c.ct.rounds}
                <b class="lab">{c.ct.label || 'Flex'}</b>
                <small class="faint num">{c.ct.rounds} rds</small>
              {:else}
                <span class="faint">Did not play CT</span>
              {/if}
            </div>
            <dl class="facts">
              {#each ctFacts(c) as f (f.label)}
                <div title={f.title}><dt>{f.label}</dt><dd class="num">{f.value}</dd></div>
              {/each}
            </dl>
          </div>

          <div class="side">
            <div class="sh">
              <span class="tag t">T</span>
              {#if c.t.rounds}
                <b class="lab">{c.t.label || 'Flex'}</b>
                <small class="faint num">{c.t.rounds} rds</small>
              {:else}
                <span class="faint">Did not play T</span>
              {/if}
            </div>
            {#if c.t.rounds}
              <div class="bars">
                {#each tBars(c) as b (b.label)}
                  <div class="tb" title={b.title}>
                    <span class="bl">{b.label}</span>
                    <span class="bar"><i style:width="{Math.round(Math.min(1, b.share) * 100)}%"></i></span>
                    <span class="bv num">{Math.round(b.share * 100)}%</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          {#if c.notes.length}
            <ul class="notes">
              {#each c.notes as n, i (i)}<li>{n}</li>{/each}
            </ul>
          {/if}
        </article>
      {/each}
    </div>
  {:else}
    <p class="empty faint">No rounds to read roles from.</p>
  {/if}
</section>

<style>
  .roles {
    margin-top: 28px;
  }

  .rhead {
    margin-bottom: 12px;
  }

  h3 {
    font-size: 21px;
  }

  .rhead p {
    margin: 2px 0 0;
  }

  .rhead .faint {
    margin-left: 4px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(186px, 1fr));
    gap: 10px;
  }

  .role {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 12px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .role.low > :not(.top) {
    opacity: 0.5;
  }

  .role.low .name,
  .role.low .dot {
    filter: saturate(0.35);
  }

  .top {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-family: var(--display);
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .conf {
    flex: none;
    max-width: 60%;
    padding: 0 6px;
    border-radius: 3px;
    background: var(--surface-3);
    color: var(--text-2);
    font-family: var(--display);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: help;
  }

  .conf.high {
    color: var(--good);
    background: rgba(60, 203, 138, 0.12);
  }

  .conf.low {
    color: var(--text-3);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-2);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 9px;
    border-top: 1px solid var(--line);
  }

  .sh {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .tag {
    flex: none;
    height: 18px;
    padding: 0 5px;
    border-radius: 3px;
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
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

  .lab {
    flex: 1;
    min-width: 0;
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sh small {
    flex: none;
    font-size: 11.5px;
  }

  /* Room for four rows, so the T half starts at the same height in every
     card. */
  .facts {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 82px;
  }

  .facts div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  dt {
    min-width: 0;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  dd {
    flex: none;
    margin: 0;
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 700;
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .tb {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr) 34px;
    align-items: center;
    gap: 7px;
  }

  .bl {
    color: var(--text-2);
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
    background: var(--t);
  }

  .bv {
    text-align: right;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 700;
  }

  .notes {
    margin: 0;
    padding: 9px 0 0;
    list-style: none;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
  }

  .empty {
    margin: 0;
  }
</style>
