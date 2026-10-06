<script lang="ts">
  import Library from './components/Library.svelte'
  import ViewerPage from './components/ViewerPage.svelte'

  let hash = $state(location.hash)

  $effect(() => {
    const onHash = () => (hash = location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })

  const replayId = $derived(hash.match(/^#\/replay\/([0-9a-f]{20})/)?.[1] ?? '')
</script>

{#if replayId}
  {#key replayId}
    <ViewerPage id={replayId} />
  {/key}
{:else}
  <Library />
{/if}
