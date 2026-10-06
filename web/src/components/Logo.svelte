<script lang="ts">
  // The C of Cerlock drawn as a magnifying glass lens, with a red handle and
  // a red dot where the crosshair sits.
  let { size = 28, word = false }: { size?: number; word?: boolean } = $props()
</script>

<span class="logo">
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M22.4 9.6 A9 9 0 1 0 22.4 22.4" fill="none" stroke="#ece6da" stroke-width="3" stroke-linecap="round" />
    <path d="M22.6 22.6 L28.5 28.5" stroke="#e5484d" stroke-width="3.6" stroke-linecap="round" />
    <circle cx="16" cy="16" r="2.2" fill="#e5484d" />
  </svg>
  {#if word}<span class="word">cerlock</span>{/if}
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .word {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 19px;
    letter-spacing: -0.01em;
    color: var(--paper);
    font-variation-settings: 'opsz' 48;
  }
</style>
