<script lang="ts">
  import { copyText } from '../lib/clipboard'
  import { mapLabel } from '../lib/format'
  import { scoutLabels, scoutOptions } from '../lib/scout/aggregate'
  import { cfgName, findSpots, spotCommand, spotsCfg, type Spot } from '../lib/scout/spots'
  import type { MapScout } from '../lib/scout/types'
  import { downloadBlob } from '../lib/zip'
  import ScoutIcon from './ScoutIcon.svelte'

  // Spots: where each player usually stands, as console commands to stand
  // there yourself, and a config file with all of them.
  let { scout, teamName }: { scout: MapScout; teamName: string } = $props()

  const spots = $derived(findSpots(scout, scoutLabels(scout), scoutOptions(scout).trackStep))
  const sides = $derived(
    (['ct', 't'] as const).map((side) => ({ side, at: spots.find((s) => s.side === side)?.at ?? 0, list: spots.filter((s) => s.side === side) })).filter((c) => c.list.length),
  )
  const file = $derived(cfgName(scout.map, teamName))

  let copied = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(s: Spot) {
    if (!(await copyText(spotCommand(s)))) return
    copied = s.alias
    clearTimeout(timer)
    timer = setTimeout(() => (copied = ''), 1600)
  }

  function saveCfg() {
    const text = spotsCfg(scout.map, mapLabel(scout.map), teamName, scout.replays.length, spots)
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${file}.cfg`)
  }

  // A player's first spot shows the name, the others leave it out.
  function first(list: Spot[], i: number): boolean {
    return i === 0 || list[i - 1].steamId !== list[i].steamId
  }
</script>

{#if sides.length}
  <section class="spots" aria-labelledby="spots-{scout.map}">
    <div class="shead">
      <div>
        <h3 id="spots-{scout.map}">Spots in game</h3>
        <p class="dim">Where each player usually stands and looks. Copy a spot into the CS2 console on a practice server with <code>sv_cheats 1</code> to stand there, or get all of them as a config.</p>
      </div>
      <button class="primary" onclick={saveCfg} title="Put it in game\csgo\cfg and type exec {file} in the console">
        <ScoutIcon name="download" size={15} /><span>Download {file}.cfg</span>
      </button>
    </div>

    <div class="cols">
      {#each sides as c (c.side)}
        <div class="col">
          <div class="ch">
            <span class="tag {c.side}">{c.side.toUpperCase()}</span>
            <span class="faint">{c.at} s after freeze time</span>
          </div>
          <ul>
            {#each c.list as s, i (s.alias)}
              <li class:next={first(c.list, i) && i > 0}>
                <span class="who">
                  {#if first(c.list, i)}
                    <i class="dot" style:background={s.color}></i>
                    <b style:color={s.color} title={s.name}>{s.name}</b>
                  {/if}
                </span>
                <span class="place" title={s.place ? `Near ${s.place}` : 'No callout here'}>{s.place || '-'}</span>
                <span class="num n" title="Stood here in {s.rounds} of their {s.of} {c.side.toUpperCase()} rounds">{s.rounds}/{s.of}</span>
                <button class="plain copy" class:done={copied === s.alias} title={spotCommand(s)} onclick={() => copy(s)}>
                  {copied === s.alias ? 'Copied' : 'Copy'}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
    <p class="hint faint">In the config, <code>spot_next</code> goes through every spot and <code>spots</code> lists them. Bind it to a key to step through quickly: <code>bind n spot_next</code>.</p>
  </section>
{/if}

<style>
  .spots {
    margin-top: 28px;
  }

  .shead {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }

  h3 {
    font-size: 21px;
  }

  .shead p {
    margin: 2px 0 0;
    max-width: 720px;
  }

  code {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--surface-3);
    color: var(--text);
    font-size: 0.92em;
  }

  .primary {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 14px 0 12px;
    background: var(--surface-3);
    border-color: var(--line-2);
    color: var(--text);
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .primary:hover {
    border-color: var(--text-3);
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 10px;
  }

  .col {
    min-width: 0;
    padding: 10px 12px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .ch {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .tag {
    flex: none;
    height: 18px;
    padding: 0 5px;
    border-radius: 3px;
    font-family: var(--display);
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    letter-spacing: 0.04em;
  }

  .tag.ct {
    color: var(--ct);
    background: rgba(98, 169, 245, 0.13);
  }

  .tag.t {
    color: var(--t);
    background: rgba(239, 166, 60, 0.13);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    height: 30px;
  }

  li.next {
    border-top: 1px solid var(--line);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .who b {
    font-family: var(--display);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  .place {
    min-width: 0;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .n {
    color: var(--text-2);
  }

  .copy {
    height: 24px;
    min-width: 58px;
    padding: 0 8px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-size: 12.5px;
  }

  .copy:hover {
    color: var(--text);
  }

  .copy.done {
    color: var(--good);
    border-color: var(--good);
  }

  .hint {
    margin: 8px 0 0;
    font-size: 13px;
  }

  @media (max-width: 700px) {
    .shead {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
