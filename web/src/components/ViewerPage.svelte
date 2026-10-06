<script lang="ts">
  import { MapView } from '../lib/mapview'
  import { loadReplay } from '../lib/replay'
  import { Viewer } from '../lib/viewer.svelte'
  import ReplayView from './ReplayView.svelte'

  let { id }: { id: string } = $props()

  let viewer = $state.raw<Viewer | null>(null)
  let progress = $state(0)
  let stage = $state('Opening the case file')
  let error = $state('')

  $effect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const start = performance.now()
        const replay = await loadReplay(id, (p) => (progress = p))
        stage = 'Laying out the map'
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
    {#if error}
      <p class="error">{error}</p>
      <a href="#/">Back to case files</a>
    {:else}
      <span class="label">{stage}</span>
      <div class="bar"><div style="width: {Math.round(progress * 100)}%"></div></div>
    {/if}
  </div>
{/if}

<style>
  .loading {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--graphite);
  }

  .bar {
    width: 260px;
    height: 2px;
    background: var(--rule-2);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    background: var(--marker);
    transition: width 0.15s;
  }

  .error {
    color: var(--marker);
  }
</style>
