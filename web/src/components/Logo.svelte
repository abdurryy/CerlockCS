<script lang="ts">
  // The C of Cerlock drawn as the lens of a magnifying glass. The handle grows
  // out of the lower end of the C and the red dot sits where the crosshair is.
  let { size = 28, word = false }: { size?: number; word?: boolean } = $props()
</script>

<span class="logo" role={word ? undefined : 'img'} aria-label={word ? undefined : 'Cerlock'} style:--size="{size}px">
  <svg width={size} height={size} viewBox="2 2 28 28" aria-hidden="true">
    <path d="M19.14 6.51A9 9 0 1 0 19.96 19.96" fill="none" stroke="var(--text)" stroke-width="4" />
    <path d="M19.96 19.96L26.68 26.68" stroke="var(--text)" stroke-width="5" stroke-linecap="round" />
    <circle cx="13.6" cy="13.6" r="2.5" fill="var(--accent)" />
  </svg>
  {#if word}<span class="word">cerlock</span>{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--size) * 0.3);
    flex: none;
  }

  svg {
    display: block;
    flex: none;
  }

  .word {
    font-family: var(--display);
    font-weight: 700;
    font-size: calc(var(--size) * 0.84);
    line-height: 1;
    letter-spacing: -0.005em;
    color: var(--text);
    /* Sit the x-height on the middle of the lens. */
    transform: translateY(-0.04em);
  }
</style>
