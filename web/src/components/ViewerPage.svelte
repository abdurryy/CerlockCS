<script lang="ts">
  import { MapView } from '../lib/mapview'
  import { loadReplay } from '../lib/replay'
  import { mapLabel } from '../lib/format'
  import { Viewer } from '../lib/viewer.svelte'
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import ReplayView from './ReplayView.svelte'

  let { id }: { id: string } = $props()

  let viewer = $state.raw<Viewer | null>(null)
  let progress = $state(0)
  let step = $state(0)
  let error = $state('')
  let title = $state<{ map: string; teams: string } | null>(null)

  const steps = ['Opening the case file', 'Laying out the map']

  // The download is most of the wait, the map takes the last bit of the bar.
  // Without a known size there is no progress, so the bar just sweeps.
  const total = $derived(step === 0 ? progress * 0.85 : 0.9)
  const unknown = $derived(step === 0 && progress === 0)

  $effect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const start = performance.now()
        const replay = await loadReplay(id, (p) => (progress = p))
        title = { map: mapLabel(replay.match.map), teams: `${replay.teamName(0)} vs ${replay.teamName(1)}` }
        step = 1
        const map = await MapView.load(replay)
        if (cancelled) return
        console.info(`replay ready in ${Math.round(performance.now() - start)} ms`)
        viewer = new Viewer(replay, map)
      } catch (e) {
        error = (e as Error).message
      }
    })()
    return () => {
      cancelled = true
    }
  })
</script>

{#if viewer}
  <ReplayView v={viewer} />
{:else}
  <div class="loading">
    <div class="box" role="status" aria-live="polite">
      <Logo size={44} />
      {#if !error}
        <div class="title">
          {#if title}
            <h1>{title.map}</h1>
            <span>{title.teams}</span>
          {/if}
        </div>
      {/if}
      {#if error}
        <div class="failed">
          <h1>Could not open this case</h1>
          <p>{error}</p>
        </div>
        <a class="back" href="#/"><Icon name="back" size={14} />Back to case files</a>
      {:else}
        <ol>
          {#each steps as s, i (s)}
            <li class:done={i < step} class:now={i === step}>
              <span class="mark">
                {#if i < step}<Icon name="check" size={12} />{:else if i === step}<i class="spin"></i>{/if}
              </span>
              <span class="text">{s}</span>
              {#if i === 0 && i === step && !unknown}<span class="pct num">{Math.round(progress * 100)}%</span>{/if}
            </li>
          {/each}
        </ol>
        <div class="bar" class:busy={step === 1} class:sweep={unknown}><div style="width: {Math.round(total * 100)}%"></div></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .loading {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
  }

  .box {
    width: 300px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-3);
    transition: color 0.2s;
  }

  li.now {
    color: var(--text);
  }

  li.done {
    color: var(--text-2);
  }

  .mark {
    width: 18px;
    height: 18px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1.5px solid var(--line-2);
  }

  li.done .mark {
    border-color: var(--good);
    color: var(--good);
  }

  li.now .mark {
    border-color: transparent;
  }

  .spin {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--line-2);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  .text {
    flex: 1;
  }

  .pct {
    font-family: var(--font);
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-2);
  }

  .bar {
    position: relative;
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.2s;
  }

  .bar.busy::after,
  .bar.sweep::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
    animation: sweep 1.1s ease-in-out infinite;
  }

  .bar.sweep::after {
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
  }

  .title {
    min-height: 42px;
    margin-top: -8px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 100%;
  }

  .title span {
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .failed {
    text-align: center;
  }

  h1 {
    font-size: 18px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--bad);
    overflow-wrap: anywhere;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text);
    font-weight: 500;
    text-decoration: none;
  }

  .back:hover {
    background: var(--surface-3);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin,
    .bar.busy::after,
    .bar.sweep::after {
      animation: none;
    }
  }
</style>
