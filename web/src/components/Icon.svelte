<script lang="ts">
  // Interface icons drawn with 2px lines on a 24x24 grid. Game icons
  // (weapons, utility, bomb) live in GameIcon.
  const paths: Record<string, string> = {
    // Playback, these are filled.
    play: 'M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z',
    pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
    prev: 'M5.5 5v14M18.5 6v12a.8.8 0 01-1.25.66L9 12.6a.8.8 0 010-1.2l8.25-6.06A.8.8 0 0118.5 6z',
    next: 'M18.5 5v14M5.5 6v12a.8.8 0 001.25.66L15 12.6a.8.8 0 000-1.2L6.75 5.34A.8.8 0 005.5 6z',
    rewind: 'M11 7v10l-7-5zM20 7v10l-7-5z',
    forward: 'M13 7v10l7-5zM4 7v10l7-5z',

    // Lines.
    back: 'M15 5l-7 7 7 7',
    chevron: 'M6 9l6 6 6-6',
    x: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    names: 'M12 4a4 4 0 100 8 4 4 0 000-8zM5 16.5h14M8 20h8',
    cone: 'M12 20L5.6 8.2a10 10 0 0112.8 0z',
    target: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M12 6.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
    nade: 'M3.5 19C5 12 9.5 7 15 7c2.6 0 4.3 1.2 5 3M18.5 14a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
    pin: 'M12 21.5s-6.5-5.7-6.5-11.5a6.5 6.5 0 0113 0c0 5.8-6.5 11.5-6.5 11.5zM12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
    search: 'M10.5 3.5a7 7 0 100 14 7 7 0 000-14zM15.5 15.5l5 5',
    eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    rotate: 'M20 12a8 8 0 11-2.4-5.7M20.5 4v4.5H16',
    ghost: 'M5 21V11a7 7 0 0114 0v10l-2.4-1.8-2.3 1.8-2.3-1.8-2.3 1.8-2.3-1.8zM9.5 10.5v1.5M14.5 10.5v1.5',
    fire: 'M12 21a6 6 0 006-6c0-4-3-6.5-4.5-11.5C12 6 10 7 9.5 9.5 9 8.6 8.6 7.8 8.5 7 7 9 6 11.5 6 15a6 6 0 006 6zM12 21a2.5 2.5 0 002.5-2.5c0-1.6-1.3-2.5-2.5-4-1.2 1.5-2.5 2.4-2.5 4A2.5 2.5 0 0012 21z',
    layers: 'M12 3.5l9 4.75-9 4.75-9-4.75zM3 12.5l9 4.75 9-4.75M3 16.5l9 4.75 9-4.75',
    frame: 'M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4M12 10v4M10 12h4',
    skip: 'M5 6l6 6-6 6M12 6l6 6-6 6',
    compass: 'M12 2.5a9.5 9.5 0 100 19 9.5 9.5 0 000-19zM15.5 8.5l-2 5-5 2 2-5z',
    upload: 'M12 15.5V4M7 9l5-5 5 5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4',
    trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5',
    folder: 'M3.5 6.5a1 1 0 011-1h5l2 2.5h8a1 1 0 011 1v9.5a1 1 0 01-1 1h-15a1 1 0 01-1-1z',
    keyboard: 'M3.5 6.5h17a1 1 0 011 1v9a1 1 0 01-1 1h-17a1 1 0 01-1-1v-9a1 1 0 011-1zM7 10.5h.01M11 10.5h.01M15 10.5h.01M17 10.5h.01M8 14h8',
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5V12l3 2',
  }
  const filled = new Set(['play', 'pause', 'prev', 'next', 'rewind', 'forward'])

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
