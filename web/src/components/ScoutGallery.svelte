<script module lang="ts">
  import { canvasToPng, type ScoutImage } from '../lib/scout/render'
  import { downloadBlob, zip } from '../lib/zip'

  // Picture is a rendered image kept as a PNG blob, with an object URL for
  // the preview.
  export interface Picture {
    name: string
    title: string
    subtitle: string
    blob: Blob
    url: string
    kind: string
    side: number
    player: string
    // "Lower floor" or "Upper floor" on multi floor maps.
    floor: string
  }

  // toPicture saves the canvas as PNG and frees it right after, so a big
  // set never keeps hundreds of MB of canvases alive.
  export async function toPicture(im: ScoutImage): Promise<Picture> {
    try {
      const png = (await canvasToPng(im.canvas)) as Uint8Array<ArrayBuffer>
      const blob = new Blob([png], { type: 'image/png' })
      const floor = /-lower$/.test(im.name) ? 'Lower floor' : /-upper$/.test(im.name) ? 'Upper floor' : ''
      const x = im as ScoutImage & { kind?: string; side?: number; player?: string }
      return {
        name: im.name,
        title: im.title,
        subtitle: im.subtitle,
        blob,
        url: URL.createObjectURL(blob),
        kind: x.kind ?? '',
        side: x.side ?? 0,
        player: x.player ?? '',
        floor,
      }
    } finally {
      im.canvas.width = 0
      im.canvas.height = 0
    }
  }

  export async function toPictures(images: ScoutImage[], onProgress?: (done: number, total: number) => void): Promise<Picture[]> {
    const out: Picture[] = []
    try {
      for (let i = 0; i < images.length; i++) {
        onProgress?.(i, images.length)
        out.push(await toPicture(images[i]))
      }
    } catch (e) {
      freePictures(out)
      throw e
    } finally {
      for (const im of images) im.canvas.width = im.canvas.height = 0
    }
    onProgress?.(images.length, images.length)
    return out
  }

  export function freePictures(list: Picture[]) {
    for (const p of list) URL.revokeObjectURL(p.url)
  }

  export function savePicture(p: Picture) {
    downloadBlob(p.blob, `${p.name}.png`)
  }

  // saveZip downloads the pictures as one zip, optionally in folders.
  export async function saveZip(sets: { folder?: string; pictures: Picture[] }[], filename: string) {
    const files: { name: string; data: Uint8Array }[] = []
    for (const s of sets) {
      for (const p of s.pictures) files.push({ name: `${s.folder ? `${s.folder}/` : ''}${p.name}.png`, data: new Uint8Array(await p.blob.arrayBuffer()) })
    }
    downloadBlob(zip(files), filename)
  }

  // fileName keeps a name readable in a file name: letters, digits, - and _.
  export function fileName(s: string, fallback: string): string {
    const out = s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 40)
    return out || fallback
  }

  const WORDS: Record<string, string> = {
    ct: 'CT',
    t: 'T',
    both: 'Both sides',
    early: 'early round',
    team: 'whole team',
    summary: 'Summary',
    execute: 'execute',
    postplant: 'after the plant',
    retake: 'retake',
    utility: 'utility',
    smokes: 'smokes',
    flashes: 'flashes',
    openings: 'opening duels',
    pistol: 'pistol rounds',
    eco: 'eco rounds',
    awp: 'AWP',
    kills: 'kills',
    deaths: 'deaths',
  }

  const PLAYER_TAILS: [string, string][] = [
    ['ct-early', 'CT, early round'],
    ['t-early', 'T, early round'],
    ['ct', 'CT, whole round'],
    ['t', 'T, whole round'],
    ['kills', 'Kills'],
    ['deaths', 'Deaths'],
  ]

  // labelOf names what an image of the scouting report shows, from its file
  // name: "nuke-t-execute-a" is "A execute", "nuke-player-carl-ct-early" is
  // "CT, early round". Empty when the name is not one of those.
  export function labelOf(p: Picture): string {
    const parts = p.name.replace(/-(lower|upper)$/, '').split('-').slice(1)
    if (!parts.length) return ''
    if (parts[0] === 'player') {
      const rest = parts.slice(1).join('-')
      for (const [tail, label] of PLAYER_TAILS) if (rest.endsWith(`-${tail}`)) return label
      return ''
    }
    if (parts.some((w) => !(w in WORDS) && !/^[a-c]$/.test(w))) return ''
    const site = parts.find((w) => /^[a-c]$/.test(w))
    const split = parts.includes('smokes') || parts.includes('flashes')
    const words = parts.filter((w) => w !== site && !(split && w === 'utility')).map((w) => WORDS[w])
    if (parts[0] === 'team') words.shift()
    let text = words.length > 1 && (words[0] === 'CT' || words[0] === 'T') ? `${words[0]}, ${words.slice(1).join(' ')}` : words.join(' ')
    if (site) text = `${site.toUpperCase()} ${words.filter((w) => w !== 'CT' && w !== 'T').join(' ')}`
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  export interface PictureGroup {
    id: string
    title: string
    hint: string
    pictures: Picture[]
  }

  const SECTIONS: { id: string; title: string; hint: string; kinds: string[] }[] = [
    { id: 'overview', title: 'Overview', hint: 'The summary card and the whole team on each side.', kinds: ['summary', 'team'] },
    { id: 't', title: 'T side', hint: 'How they get onto each site, with the utility, and how they play after the plant.', kinds: ['executes', 'postplant'] },
    { id: 'ct', title: 'CT side', hint: 'Where they come from to retake each site.', kinds: ['retake'] },
    { id: 'utility', title: 'Utility', hint: 'Where their grenades land on each side.', kinds: ['utility'] },
    { id: 'rounds', title: 'Duels and buy rounds', hint: 'Opening duels, pistol and eco rounds, the AWP, kills and deaths.', kinds: ['openings', 'pistol', 'eco', 'awp', 'kills', 'deaths'] },
  ]

  // groupScout sorts the images of a map into the sections of the report:
  // team wide sections first, then one section per player.
  export function groupScout(list: Picture[], earlySeconds: number): PictureGroup[] {
    const groups: PictureGroup[] = SECTIONS.map((s) => ({ id: s.id, title: s.title, hint: s.hint, pictures: [] }))
    const players = new Map<string, PictureGroup>()
    const other: PictureGroup = { id: 'other', title: 'More', hint: '', pictures: [] }
    for (const p of list) {
      if (p.player || p.kind.startsWith('player')) {
        const name = p.player || p.title
        let g = players.get(name)
        if (!g) {
          g = { id: `player-${players.size}`, title: name, hint: `Early round (first ${earlySeconds}s), whole rounds, kills and deaths.`, pictures: [] }
          players.set(name, g)
        }
        g.pictures.push(p)
        continue
      }
      const at = SECTIONS.findIndex((s) => s.kinds.includes(p.kind))
      if (at >= 0) groups[at].pictures.push(p)
      else other.pictures.push(p)
    }
    return [...groups, other, ...players.values()].filter((g) => g.pictures.length)
  }
</script>

<script lang="ts">
  import ScoutIcon from './ScoutIcon.svelte'

  // A grid of rendered images with a download button on each, and a large
  // view that opens on click.
  let {
    pictures,
    placeholders = 0,
    compact = false,
    labels = false,
  }: { pictures: Picture[]; placeholders?: number; compact?: boolean; labels?: boolean } = $props()

  const head = (p: Picture) => (labels && labelOf(p)) || p.title

  let open = $state(-1)
  let dialog: HTMLDivElement | undefined = $state()
  let opener: HTMLElement | null = null
  const current = $derived(open >= 0 ? pictures[open] : null)

  function show(i: number) {
    opener = document.activeElement as HTMLElement | null
    open = i
  }

  // Focus goes back to the image that was opened, so Escape and Tab keep
  // working in a dialog behind it.
  function close() {
    open = -1
    opener?.focus()
    opener = null
  }

  $effect(() => {
    if (current) dialog?.focus()
  })

  $effect(() => {
    if (open >= pictures.length) open = -1
  })

  function onKey(e: KeyboardEvent) {
    if (open < 0) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      open = (open - 1 + pictures.length) % pictures.length
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      open = (open + 1) % pictures.length
    }
  }
</script>

<div class="grid" class:compact>
  {#each pictures as p, i (p.url)}
    <figure class="card">
      <button class="shot" title="Open {p.title} larger" onclick={() => show(i)}>
        <img src={p.url} alt="{p.title}, {p.subtitle}" loading="lazy" />
        <span class="zoom"><ScoutIcon name="zoom" size={15} /></span>
      </button>
      <figcaption>
        <span class="text">
          <span class="top">
            <b title={head(p)}>{head(p)}</b>
            {#if p.floor}<em>{p.floor}</em>{/if}
          </span>
          <span class="sub" title={p.subtitle}>{p.subtitle}</span>
        </span>
        <button class="plain save" title="Download {p.name}.png" aria-label="Download {p.name}.png" onclick={() => savePicture(p)}>
          <ScoutIcon name="download" size={15} />
        </button>
      </figcaption>
    </figure>
  {/each}
  {#each { length: placeholders } as _, i (i)}
    <div class="card ghost" aria-hidden="true">
      <span class="shot"></span>
      <span class="lines"><i></i><i></i></span>
    </div>
  {/each}
</div>

{#if current}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="lightbox" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="frame" role="dialog" aria-modal="true" aria-label={current.title} tabindex="-1" bind:this={dialog} onkeydown={onKey} onclick={(e) => e.stopPropagation()}>
      <div class="lb-head">
        <span class="lb-title">
          <b>{current.title}</b>
          <span>{labels && labelOf(current) ? `${labelOf(current)} · ` : ''}{current.subtitle}</span>
        </span>
        <span class="lb-count num">{open + 1} / {pictures.length}</span>
        <button class="lb-save" onclick={() => savePicture(current)}><ScoutIcon name="download" size={15} />Download PNG</button>
        <button class="plain lb-close" title="Close (Esc)" aria-label="Close" onclick={close}>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="lb-body">
        {#if pictures.length > 1}
          <button class="plain nav prev" title="Previous" aria-label="Previous image" onclick={() => (open = (open - 1 + pictures.length) % pictures.length)}>
            <ScoutIcon name="left" size={22} />
          </button>
        {/if}
        <img src={current.url} alt="{current.title}, {current.subtitle}" />
        {#if pictures.length > 1}
          <button class="plain nav next" title="Next" aria-label="Next image" onclick={() => (open = (open + 1) % pictures.length)}>
            <ScoutIcon name="right" size={22} />
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(212px, 1fr));
    gap: 14px;
  }

  .grid.compact {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  .card {
    margin: 0;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    overflow: hidden;
    transition: border-color 0.12s;
  }

  .card:hover {
    border-color: var(--line-2);
  }

  .shot {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: var(--bg);
    cursor: zoom-in;
    overflow: hidden;
  }

  .shot:hover {
    background: var(--bg);
  }

  .shot img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transition: transform 0.25s;
  }

  .shot:hover img {
    transform: scale(1.03);
  }

  .shot:focus-visible {
    outline-offset: -3px;
  }

  .zoom {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: rgba(11, 13, 17, 0.8);
    color: var(--text);
    opacity: 0;
    transition: opacity 0.12s;
  }

  .shot:hover .zoom,
  .shot:focus-visible .zoom {
    opacity: 1;
  }

  figcaption {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 6px 9px 12px;
    min-width: 0;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .top em {
    flex: none;
    padding: 0 5px;
    border-radius: 3px;
    background: var(--surface-3);
    font-family: var(--display);
    font-size: 11px;
    font-style: normal;
    font-weight: 600;
    line-height: 17px;
    color: var(--text-2);
  }

  .text b {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-3);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    min-height: 2.7em;
  }


  .save {
    width: 30px;
    height: 30px;
    margin-top: 2px;
    padding: 0;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
  }

  .save:hover {
    color: var(--text);
  }

  .ghost .shot {
    cursor: default;
    background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 12px 13px;
  }

  .lines i {
    display: block;
    height: 9px;
    width: 60%;
    border-radius: 3px;
    background: var(--surface-3);
  }

  .lines i + i {
    width: 85%;
    height: 7px;
    background: var(--surface-2);
  }

  /* Large view */

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(5, 6, 9, 0.86);
  }

  .frame {
    display: flex;
    flex-direction: column;
    max-width: 100%;
    max-height: 100%;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .frame:focus {
    outline: none;
  }

  .lb-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }

  .lb-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .lb-title b {
    font-family: var(--display);
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
  }

  .lb-title span {
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lb-count {
    color: var(--text-3);
    font-size: 12.5px;
  }

  .lb-save {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px 0 10px;
    font-family: var(--display);
    font-size: 13.5px;
    font-weight: 600;
  }

  .lb-close {
    width: 30px;
    height: 30px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
  }

  .lb-body {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    min-height: 0;
  }

  .lb-body img {
    display: block;
    width: min(calc(100vh - 110px), calc(100vw - 50px));
    height: auto;
    max-height: calc(100vh - 110px);
    aspect-ratio: 1;
    object-fit: contain;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 56px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(11, 13, 17, 0.7);
    color: var(--text);
  }

  .nav:hover {
    background: rgba(32, 37, 44, 0.9);
  }

  .prev {
    left: 10px;
  }

  .next {
    right: 10px;
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ghost .shot {
      animation: none;
    }
  }
</style>
