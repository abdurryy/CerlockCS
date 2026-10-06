<script lang="ts">
  // Small gear and utility glyphs drawn on a 12x12 grid.
  const shapes: Record<string, string> = {
    smoke: 'M3.2 8.6a2.3 2.3 0 0 1 .5-4.5 2.8 2.8 0 0 1 5.2.6 2 2 0 0 1 .2 3.9z',
    flash: 'M6.8 1 3 6.8h2.6L5 11l4-6.1H6.4z',
    he: 'M6 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM5 1h2v2H5z',
    fire: 'M6 1c.4 2 2.8 2.7 2.8 5.6a2.8 2.8 0 0 1-5.6 0c0-1.5 1-2.1 1-3.1 1 .5 1.6 1.4 1.6 2.4C6.6 4.6 6 2.8 6 1z',
    decoy: 'M6 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
    armor: 'M6 1 2 2.6v3.1C2 8.3 3.7 10.2 6 11c2.3-.8 4-2.7 4-5.3V2.6z',
    helmet: 'M2 7.5a4 4 0 0 1 8 0V9H2zM1 9h10v1.4H1z',
    kit: 'M3 1.5h2v4.2L3.6 10.5H2.4L3 5.7zM7 1.5h2l.6 4.2-1.2 4.8H7.2L7 5.7z',
    bomb: 'M2 4h8v6H2zM4 2.5h4V4H4z',
  }
  let { name, title = '' }: { name: string; title?: string } = $props()
</script>

<svg class="glyph {name}" viewBox="0 0 12 12" width="12" height="12" role="img" aria-label={title || name}>
  {#if title}<title>{title}</title>{/if}
  <path d={shapes[name] ?? ''} />
</svg>

<style>
  .glyph {
    fill: var(--graphite);
    flex: none;
  }

  .smoke {
    fill: #cfcac0;
  }

  .flash {
    fill: #f3e3a0;
  }

  .he {
    fill: #e5484d;
  }

  .fire {
    fill: #f08a3c;
  }

  .decoy {
    fill: #8fbf9a;
  }

  .bomb {
    fill: #e5484d;
  }

  .kit {
    fill: var(--ct);
  }
</style>
