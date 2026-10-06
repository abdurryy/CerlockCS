<script lang="ts">
  // A few stroke icons drawn on a 24x24 grid.
  const paths: Record<string, string> = {
    play: 'M7 5l12 7-12 7z',
    pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
    prev: 'M6 5v14M18 5L9 12l9 7z',
    next: 'M18 5v14M6 5l9 7-9 7z',
    back: 'M15 5l-7 7 7 7',
    rewind: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
    forward: 'M13 6l7 6-7 6zM4 6l7 6-7 6z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 7a5 5 0 100 10 5 5 0 000-10z',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    x: 'M6 6l12 12M18 6L6 18',
    compass: 'M12 2a10 10 0 100 20 10 10 0 000-20zM15 9l-2 5-4 1 2-5z',
    fire: 'M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-6 2 1 3 3 3 5 1-2 0-6 0-9z',
    folder: 'M3 6h6l2 2h10v11H3z',
    keyboard: 'M3 7h18v10H3zM7 11h1M11 11h1M15 11h1M8 14h8',
  }
  let { name, size = 16 }: { name: string; size?: number } = $props()
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] ?? ''} fill={name === 'play' || name === 'pause' || name === 'prev' || name === 'next' || name === 'rewind' || name === 'forward' ? 'currentColor' : 'none'} />
</svg>
