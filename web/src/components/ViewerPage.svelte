<script lang="ts">
  import { MapView } from '../lib/mapview'
  import { loadReplay } from '../lib/replay'
  import { Viewer } from '../lib/viewer.svelte'
  import ReplayView from './ReplayView.svelte'

  let { id }: { id: string } = $props()

  let viewer = $state.raw<Viewer | null>(null)
  let progress = $state(0)
  let stage = $state('Loading replay')
  let error = $state('')

  $effect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const start = performance.now()
        const replay = await loadReplay(id, (p) => (progress = p))
        stage = 'Loading map'
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
      <a href="#/">Back to library</a>
    {:else}
      <p>{stage}</p>
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
    color: var(--text-2);
  }

  .bar {
    width: 260px;
    height: 4px;
    border-radius: 2px;
    background: var(--panel-3);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }

  .error {
    color: var(--bad);
  }
</style>
