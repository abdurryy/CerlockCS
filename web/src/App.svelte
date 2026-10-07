<script lang="ts">
  import Library from './components/Library.svelte'
  import ScoutPage from './components/ScoutPage.svelte'
  import ViewerPage from './components/ViewerPage.svelte'

  let hash = $state(location.hash)

  $effect(() => {
    const onHash = () => (hash = location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })

  // Any #/replay/ link opens the viewer, which says so when the id is unknown.
  const replayId = $derived(hash.match(/^#\/replay\/([^/?#]*)/)?.[1] ?? null)
  const scout = $derived(/^#\/scout(\/|$)/.test(hash))
</script>

{#if replayId !== null}
  {#key replayId}
    <ViewerPage id={decodeURIComponent(replayId)} />
  {/key}
{:else if scout}
  <ScoutPage />
{:else}
  <Library />
{/if}
