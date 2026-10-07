<script lang="ts">
  // Line icons for the scouting screens, drawn like Icon.svelte (2px lines
  // on a 24x24 grid).
  const paths: Record<string, string> = {
    download: 'M12 4v11M7 10.5l5 5 5-5M4.5 19.5h15',
    external: 'M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1 1 0 01-1 1H6a1 1 0 01-1-1V8.5a1 1 0 011-1h4.5',
    image: 'M4.5 4.5h15a1 1 0 011 1v13a1 1 0 01-1 1h-15a1 1 0 01-1-1v-13a1 1 0 011-1zM3.5 16l5-5 4.5 4.5 2.5-2.5 5 5M15.5 8.5h.01',
    users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.5-3.6 3-5.5 6.5-5.5s6 1.9 6.5 5.5M16 4.3a3.5 3.5 0 010 6.4M18.5 14.8c1.8.7 2.8 2.4 3 5.2',
    key: 'M8 14.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zM11.5 11.5L20 20M16.5 16.5l2-2M18.5 18.5l1.5-1.5',
    left: 'M15 5l-7 7 7 7',
    right: 'M9 5l7 7-7 7',
    zoom: 'M10.5 3.5a7 7 0 100 14 7 7 0 000-14zM15.5 15.5l5 5M8 10.5h5M10.5 8v5',
    info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5.5M12 7.5h.01',
    map: 'M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5zM9 4v13.5M15 6.5V20',
    play: 'M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z',
    refresh: 'M20 12a8 8 0 11-2.4-5.7M20.5 4v4.5H16',
  }
  const filled = new Set(['play'])

  let { name, size = 16 }: { name: string; size?: number } = $props()
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] ?? ''} fill={filled.has(name) ? 'currentColor' : 'none'} />
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
  }
</style>
