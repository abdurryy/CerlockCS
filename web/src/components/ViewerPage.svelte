<script lang="ts">
  import { getEntry } from '../lib/api'
  import { mapLabel } from '../lib/format'
  import { MapView } from '../lib/mapview'
  import { loadReplay } from '../lib/replay'
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

  const NOT_FOUND = 'There is no case with this id in your case files. It may have been deleted.'

  $effect(() => {
    let cancelled = false
    if (!/^[0-9a-f]{20}$/.test(id)) {
      error = NOT_FOUND
      return
    }
    // The entry is small and quick, so the map name shows while the
    // replay itself downloads.
    getEntry(id)
      .then((e) => {
        if (cancelled) return
        if (!e) error = NOT_FOUND
        else title ??= { map: mapLabel(e.map), teams: `${e.teams[0].name} vs ${e.teams[1].name}` }
      })
      .catch(() => {})
    ;(async () => {
      try {
        const start = performance.now()
        const replay = await loadReplay(id, (p) => (progress = p))
        if (cancelled) return
        title = { map: mapLabel(replay.match.map), teams: `${replay.teamName(0)} vs ${replay.teamName(1)}` }
        step = 1
        const map = await MapView.load(replay)
        if (cancelled) return
        console.info(`replay ready in ${Math.round(performance.now() - start)} ms`)
        viewer = new Viewer(replay, map)
      } catch (e) {
        if (cancelled) return
        const msg = (e as Error).message
        error = /\(404\)/.test(msg) ? NOT_FOUND : msg
      }
    })()
    return () => {
      cancelled = true
    }
  })
</script>

<svelte:head>
  {#if !viewer}<title>{error ? 'Case not found' : title ? `${title.map} · Cerlock` : 'Opening case · Cerlock'}</title>{/if}
</svelte:head>

{#if viewer}
  <ReplayView v={viewer} />
{:else}
  <div class="loading">
    <div class="box" class:failed={!!error} role="status" aria-live="polite">
      <Logo size={44} />
      {#if error}
        <div class="title">
          <h1>Could not open this case</h1>
          <p class="why">{error}</p>
        </div>
        <a class="back" href="#/"><Icon name="back" size={14} />Back to case files</a>
      {:else}
        <div class="title">
          <h1 class:pending={!title}>{title?.map ?? 'Opening case'}</h1>
          <span class="teams" title={title?.teams}>{title?.teams ?? ' '}</span>
        </div>
        <ol>
          {#each steps as s, i (s)}
            <li class:done={i < step} class:now={i === step}>
              <span class="mark">
                {#if i < step}<Icon name="check" size={11} />{:else if i === step}<i class="spin"></i>{:else}<i class="dot"></i>{/if}
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
    width: 320px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .title {
    width: 100%;
    margin: 14px 0 22px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h1 {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.15;
  }

  h1.pending {
    color: var(--text-2);
  }

  .teams {
    min-height: 20px;
    font-size: 14px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
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
  }

  li.done .mark {
    background: rgba(60, 203, 138, 0.16);
    color: var(--good);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--line-2);
  }

  .spin {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--line-2);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }

  .text {
    flex: 1;
  }

  .pct {
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }

  .bar {
    position: relative;
    width: 100%;
    height: 3px;
    margin-top: 16px;
    border-radius: 2px;
    background: var(--line-2);
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

  .failed .title {
    margin-bottom: 20px;
  }

  .failed h1 {
    font-size: 20px;
  }

  .why {
    margin: 6px 0 0;
    font-size: 14px;
    color: var(--text-2);
    overflow-wrap: anywhere;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px 0 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-2);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
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
