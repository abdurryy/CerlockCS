<script lang="ts">
  import type { Insight } from '../lib/types'
  import type { Viewer } from '../lib/viewer.svelte'

  let { v, ins }: { v: Viewer; ins: Insight } = $props()
  const r = $derived(v.replay)
  let expanded = $state(false)

  const shown = $derived(expanded ? ins.moments : ins.moments.slice(0, 3))
  const who = $derived(ins.player >= 0 ? r.playerName(ins.player) : r.teamName(ins.team))
  const word = { high: 'serious', medium: 'look at', low: 'minor', positive: 'good' }
</script>

<article class={ins.severity}>
  <div class="meta">
    <span class="sev mono">{word[ins.severity]}</span>
    <span class="who">{who}</span>
  </div>
  <h3>{ins.title}</h3>
  <p>{ins.detail}</p>
  {#if ins.tip}
    <p class="tip">{ins.tip}</p>
  {/if}
  {#if ins.moments.length}
    <ol>
      {#each shown as m, i (i)}
        <li>
          <button onclick={() => v.jump(m, m.player >= 0 ? [m.player] : [])} title="Watch this moment">
            <span class="ex mono">{String(i + 1).padStart(2, '0')}</span>
            <span>{m.label}</span>
          </button>
        </li>
      {/each}
    </ol>
    {#if ins.moments.length > 3}
      <button class="more plain" onclick={() => (expanded = !expanded)}>
        {expanded ? 'fewer exhibits' : `${ins.moments.length - 3} more exhibits`}
      </button>
    {/if}
  {/if}
</article>

<style>
  article {
    padding: 12px 0 14px;
    border-top: 1px solid var(--rule);
  }

  .meta {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }

  .sev {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    padding-left: 10px;
    position: relative;
  }

  .sev::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 6px;
    height: 6px;
    transform: translateY(-50%);
  }

  .high .sev {
    color: var(--marker);
  }

  .high .sev::before {
    background: var(--marker);
  }

  .medium .sev {
    color: var(--rust);
  }

  .medium .sev::before {
    background: var(--rust);
  }

  .low .sev {
    color: var(--evidence);
  }

  .low .sev::before {
    background: var(--evidence);
  }

  .positive .sev {
    color: var(--verdigris);
  }

  .positive .sev::before {
    background: var(--verdigris);
  }

  .who {
    font-size: 12px;
    color: var(--pencil);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3 {
    font-size: 16px;
    margin: 5px 0 3px;
    font-variation-settings: 'opsz' 36;
  }

  p {
    margin: 0;
    color: var(--graphite);
    font-size: 12.5px;
  }

  .tip {
    margin-top: 6px;
    padding-left: 10px;
    border-left: 2px solid var(--rule-2);
    color: var(--pencil);
    font-style: italic;
  }

  ol {
    list-style: none;
    margin: 9px 0 0;
    padding: 0;
  }

  li button {
    width: 100%;
    display: flex;
    gap: 9px;
    align-items: baseline;
    text-align: left;
    border: none;
    border-radius: 0;
    padding: 3px 4px;
    font-size: 12px;
    color: var(--graphite);
  }

  li button:hover {
    background: var(--desk-2);
    color: var(--paper);
  }

  .ex {
    font-size: 10.5px;
    color: var(--marker);
  }

  .more {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--pencil);
    padding: 3px 4px;
    margin-top: 2px;
  }
</style>
