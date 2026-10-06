<script lang="ts">
  import type { Insight } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v, ins }: { v: Viewer; ins: Insight } = $props()
  const r = $derived(v.replay)
  let expanded = $state(false)

  const shown = $derived(expanded ? ins.moments : ins.moments.slice(0, 4))
  const who = $derived(ins.player >= 0 ? r.playerName(ins.player) : r.teamName(ins.team))
</script>

<article class="card {ins.severity}">
  <header>
    <strong>{ins.title}</strong>
    <span class="who">{who}</span>
  </header>
  <p>{ins.detail}</p>
  {#if ins.tip}
    <p class="tip">{ins.tip}</p>
  {/if}
  {#if ins.moments.length}
    <ul>
      {#each shown as m, i (i)}
        <li>
          <button class="moment" onclick={() => v.jump(m, m.player >= 0 ? [m.player] : [])} title="Watch this moment">
            <span class="play">▶</span>{m.label}
          </button>
        </li>
      {/each}
    </ul>
    {#if ins.moments.length > 4}
      <button class="more ghost" onclick={() => (expanded = !expanded)}>
        {expanded ? 'Show less' : `Show ${ins.moments.length - 4} more`}
      </button>
    {/if}
  {/if}
</article>

<style>
  .card {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-left: 3px solid var(--line-2);
    border-radius: 8px;
    padding: 9px 11px;
    margin-bottom: 8px;
  }

  .card.high {
    border-left-color: var(--bad);
  }

  .card.medium {
    border-left-color: #ff9f43;
  }

  .card.low {
    border-left-color: var(--warn);
  }

  .card.positive {
    border-left-color: var(--good);
  }

  header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: baseline;
  }

  .who {
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 45%;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-2);
  }

  .tip {
    font-size: 12px;
    color: var(--muted);
    font-style: italic;
  }

  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .moment {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 3px 6px;
    font-size: 12px;
    color: var(--text-2);
    display: flex;
    gap: 7px;
    align-items: center;
  }

  .moment:hover {
    background: var(--panel-3);
    color: var(--text);
  }

  .play {
    font-size: 9px;
    color: var(--accent);
  }

  .more {
    font-size: 12px;
    color: var(--accent);
    padding: 3px 6px;
    margin-top: 2px;
  }
</style>
