<script lang="ts">
  import lockupUrl from '../assets/brand/lockup-dark.svg?url'
  import markUrl from '../assets/brand/mark-dark.svg?url'

  // The Cerlock operator with his magnifying glass. `full` adds the
  // CERLOCK wordmark next to him, size is the height in pixels.
  let { size = 28, full = false }: { size?: number; full?: boolean } = $props()
</script>

<img class="logo" src={full ? lockupUrl : markUrl} alt="Cerlock" height={size} style:height="{size}px" draggable="false" />

<style>
  .logo {
    display: block;
    flex: none;
    width: auto;
    user-select: none;
  }
</style>
