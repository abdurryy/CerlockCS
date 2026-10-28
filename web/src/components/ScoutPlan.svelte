<script lang="ts">
  import { copyText } from '../lib/clipboard'
  import { mapLabel } from '../lib/format'
  import { gamePlan, planText, type PlanLine, type Strength } from '../lib/scout/plan'
  import type { MapScout, Situation } from '../lib/scout/types'
  import ScoutIcon from './ScoutIcon.svelte'

  // The game plan: what to do against them on each side and round type,
  // every line with the rounds behind it.
  let {
    scout,
    teamName,
    onwatch,
  }: { scout: MapScout; teamName: string; onwatch: (s: Situation, opener: HTMLElement | null, rounds?: number[]) => void } = $props()

  const plan = $derived(gamePlan(scout))
  let side = $state<'t' | 'ct'>('t')
  const shown = $derived(side === 't' ? plan.t : plan.ct)
  const count = $derived(plan.t.parts.reduce((n, p) => n + p.lines.length, 0) + plan.ct.parts.reduce((n, p) => n + p.lines.length, 0))
  let copied = $state<'' | 'ok' | 'fail'>('')
  let timer: ReturnType<typeof setTimeout> | undefined

  const STRENGTH: Record<Strength, { label: string; title: string }> = {
    strong: { label: 'Seen a lot', title: 'Based on 5 or more rounds, most of them the same' },
    likely: { label: 'Likely', title: 'Based on 3 or more rounds' },
    weak: { label: 'Few rounds', title: 'Only a couple of rounds, check them before you trust it' },
  }

  function situationOf(l: PlanLine): Situation | null {
    return (l.situation && scout.situations.find((s) => s.key === l.situation)) || null
  }

  async function copy() {
    const ok = await copyText(planText(plan, mapLabel(scout.map), teamName))
    copied = ok ? 'ok' : 'fail'
    clearTimeout(timer)
    timer = setTimeout(() => (copied = ''), 2200)
  }

  $effect(() => () => clearTimeout(timer))
</script>

{#snippet row(l: PlanLine, key: boolean)}
  {@const s = situationOf(l)}
  {@const yours = l.side ?? ''}
  <li class:key>
    <div class="body">
      <div class="do">
        {#if key && yours}<span class="side {yours}">{yours.toUpperCase()}</span>{/if}
        <b>{l.do}</b>
      </div>
      <div class="why">{l.why}</div>
    </div>
    <span class="str {l.strength}" title={STRENGTH[l.strength].title}>{STRENGTH[l.strength].label}</span>
    {#if s && l.rounds?.length}
      <button class="plain watch" title="Watch the {l.rounds.length} {l.rounds.length === 1 ? 'round' : 'rounds'} behind this" onclick={(e) => onwatch(s, e.currentTarget, l.rounds)}>
        <ScoutIcon name="play" size={10} /><span>{l.rounds.length}</span>
      </button>
    {:else}
      <span class="watch none"></span>
    {/if}
  </li>
{/snippet}

<article class="card plan" aria-labelledby="plan-{scout.map}">
  <div class="head">
    <div class="ht">
      <h3 id="plan-{scout.map}">Game plan</h3>
      <p class="dim">
        What to do against {teamName || 'them'} on {mapLabel(scout.map)}, from what they did in {scout.ctRounds + scout.tRounds} rounds. Every line says what it is based on.
      </p>
    </div>
    <button class="btn" onclick={copy} disabled={!count} title="Copy the whole plan as text">
      {#if copied === 'ok'}
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span>Copied</span>
      {:else}
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
        <span>{copied === 'fail' ? 'Could not copy' : 'Copy plan'}</span>
      {/if}
    </button>
  </div>

  {#if !count}
    <p class="none faint">Nothing clear enough yet in {scout.ctRounds + scout.tRounds} rounds. More demos of this team on {mapLabel(scout.map)} will give a plan.</p>
  {:else}
    {#if plan.key.length}
      <h4>Main points</h4>
      <ol class="lines">
        {#each plan.key as l, i (i)}
          {@render row(l, true)}
        {/each}
      </ol>
    {/if}

    <div class="tabs">
      <div class="seg" role="group" aria-label="Your side">
        <button class:on={side === 't'} aria-pressed={side === 't'} onclick={() => (side = 't')}><span class="t">T</span> side</button>
        <button class:on={side === 'ct'} aria-pressed={side === 'ct'} onclick={() => (side = 'ct')}><span class="ct">CT</span> side</button>
      </div>
      <span class="faint">{shown.sub}</span>
    </div>

    {#each shown.parts as p (p.key || p.title)}
      {#if p.lines.length}
        <section class="part">
          <h5>{p.title}{#if p.rounds}<span class="faint"> · {p.rounds} {p.rounds === 1 ? 'round' : 'rounds'}</span>{/if}</h5>
          <ol class="lines">
            {#each p.lines as l, i (i)}
              {@render row(l, false)}
            {/each}
          </ol>
        </section>
      {/if}
    {:else}
      <p class="none faint">Nothing clear for your {shown.side.toUpperCase()} side yet.</p>
    {/each}

    <p class="small faint">
      <ScoutIcon name="info" size={13} />
      <span>This is what worked against them and what they keep doing, not a promise. Teams change plans, so watch the rounds behind a line before you build on it.</span>
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

  h4,
  h5 {
    margin: 16px 0 4px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  h5 {
    letter-spacing: 0.04em;
    color: var(--text-2);
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

  .lines {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lines li {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 7px 0;
    border-top: 1px solid var(--line);
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .do {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--display);
    font-size: 15px;
    line-height: 1.3;
  }

  .do b {
    font-weight: 700;
  }

  .key .do {
    font-size: 16px;
  }

  .side {
    flex: none;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    font-size: 11.5px;
    font-weight: 700;
    line-height: 18px;
    background: var(--surface-3);
  }

  .why {
    margin-top: 2px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-2);
  }

  .str {
    flex: none;
    padding: 0 7px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
    font-family: var(--display);
    font-size: 11.5px;
    font-weight: 600;
    line-height: 20px;
    white-space: nowrap;
    color: var(--text-3);
  }

  .str.strong {
    border-color: color-mix(in srgb, var(--good) 45%, transparent);
    color: var(--good);
  }

  .str.likely {
    border-color: color-mix(in srgb, var(--evidence) 40%, transparent);
    color: var(--evidence);
  }

  .watch {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 44px;
    height: 24px;
    color: var(--text-2);
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .watch:hover {
    color: var(--text);
  }

  .watch.none {
    visibility: hidden;
  }

  .tabs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 14px;
    margin: 18px 0 0;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    font-size: 13px;
  }

  .seg button {
    font-family: var(--display);
    font-weight: 600;
  }

  .part h5 {
    margin-top: 14px;
  }

  .none {
    margin: 12px 0 0;
  }

  .small {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin: 12px 0 0;
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

    .lines li {
      flex-wrap: wrap;
    }

    .body {
      flex-basis: 100%;
    }
  }
</style>
