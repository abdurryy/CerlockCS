<script lang="ts">
  import { mapLabel } from '../lib/format'
  import { SPEEDS, type Tab, type Viewer } from '../lib/viewer.svelte'
  import BallisticsPanel from './BallisticsPanel.svelte'
  import BriefingPanel from './BriefingPanel.svelte'
  import EvidencePanel from './EvidencePanel.svelte'
  import Hud from './Hud.svelte'
  import Icon from './Icon.svelte'
  import KillFeed from './KillFeed.svelte'
  import Logo from './Logo.svelte'
  import MapPanel from './MapPanel.svelte'
  import PlayersPanel from './PlayersPanel.svelte'
  import Radar from './Radar.svelte'
  import RoundsPanel from './RoundsPanel.svelte'
  import TeamPanel from './TeamPanel.svelte'
  import Timeline from './Timeline.svelte'
  import Toolbar from './Toolbar.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  let radar: ReturnType<typeof Radar> | undefined = $state()
  let help = $state(false)
  let dialog: HTMLDivElement | undefined = $state()

  const tabs: { id: Tab; label: string }[] = [
    { id: 'briefing', label: 'Briefing' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'players', label: 'Players' },
    { id: 'ballistics', label: 'Ballistics' },
    { id: 'rounds', label: 'Rounds' },
    { id: 'map', label: 'Map' },
  ]

  // Keys named left and right are drawn as arrows.
  const shortcuts: { title: string; rows: { keys: string[]; text: string; or?: boolean }[] }[] = [
    {
      title: 'Playback',
      rows: [
        { keys: ['Space'], text: 'Play or pause' },
        { keys: ['left', 'right'], text: 'Back or forward 5 s' },
        { keys: ['Shift', 'left', 'right'], text: 'Back or forward 1 s' },
        { keys: ['P', 'N'], text: 'Previous or next round' },
        { keys: ['[', ']'], text: 'Slower or faster' },
      ],
    },
    {
      title: 'Players',
      rows: [
        { keys: ['1', '0'], text: 'Follow a player', or: true },
        { keys: ['Esc'], text: 'Stop following' },
        { keys: ['R'], text: 'Rotate with the followed player' },
        { keys: ['V'], text: 'Team vision, what they could see' },
        { keys: ['G'], text: 'Ghosts from other rounds' },
      ],
    },
    {
      title: 'Map',
      rows: [
        { keys: ['E'], text: 'Evidence markers' },
        { keys: ['C'], text: 'Callouts' },
        { keys: ['H'], text: 'Names' },
        { keys: ['L'], text: 'Switch floor' },
        { keys: ['?'], text: 'Show this list' },
      ],
    },
  ]

  const mouse = [
    ['Drag', 'Pan the map'],
    ['Scroll', 'Zoom'],
    ['Click', 'Follow a player'],
    ['Double click', 'Reset the view'],
  ]

  // Team names take the colour of the side they play in the current round.
  const sides = $derived([r.sideOf(0, v.round), r.sideOf(1, v.round)])
  const score = $derived([r.match.teams[0].score, r.match.teams[1].score])

  // Number keys follow players in the order of the roster.
  const order = $derived([...r.teamPlayers[0].slice(0, 5), ...r.teamPlayers[1].slice(0, 5)])

  $effect(() => {
    if (help) dialog?.focus()
  })

  function sideClass(side: number): string {
    return side === 3 ? 'ct' : side === 2 ? 't' : ''
  }

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === ' ') {
      e.preventDefault()
      v.toggle()
    } else if (k === 'ArrowLeft') {
      e.preventDefault()
      v.step(e.shiftKey ? -1 : -5)
    } else if (k === 'ArrowRight') {
      e.preventDefault()
      v.step(e.shiftKey ? 1 : 5)
    } else if (k === 'n') {
      v.seekRound(v.round + 1)
    } else if (k === 'p') {
      v.seekRound(v.round - 1)
    } else if (k === ']') {
      v.speed = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v.speed) + 1)]
    } else if (k === '[') {
      v.speed = SPEEDS[Math.max(0, SPEEDS.indexOf(v.speed) - 1)]
    } else if (/^[0-9]$/.test(k)) {
      const p = order[k === '0' ? 9 : Number(k) - 1]
      if (p !== undefined) v.setFollow(p)
    } else if (k === 'Escape') {
      if (help) {
        help = false
        return
      }
      v.follow = -1
      v.focus = []
    } else if (k === 'r') {
      if (v.follow >= 0) v.rotate = !v.rotate
    } else if (k === 'v') {
      v.teamVision = !v.teamVision
    } else if (k === 'h') {
      v.names = !v.names
    } else if (k === 'c') {
      v.callouts = !v.callouts
    } else if (k === 'e') {
      v.evidence = !v.evidence
    } else if (k === 'g') {
      v.ghosts = v.ghosts >= 0 ? -1 : Math.max(0, r.match.players[v.follow]?.team ?? 0)
    } else if (k === 'l' && v.map.multiLevel) {
      v.layer = v.layer < 0 ? (radar?.level() === 0 ? 1 : 0) : -1
    } else if (k === '?') {
      help = !help
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
  <title>{mapLabel(r.match.map)} {score[0]}:{score[1]} · Cerlock</title>
</svelte:head>

{#snippet arrow(dir: 'left' | 'right')}
  <svg width="11" height="11" viewBox="0 0 12 12" role="img" aria-label={dir === 'left' ? 'Left arrow' : 'Right arrow'}>
    <path d={dir === 'left' ? 'M10 6H2.5M5.5 2.5 2 6l3.5 3.5' : 'M2 6h7.5M6.5 2.5 10 6 6.5 9.5'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
{/snippet}

<div class="view">
  <header>
    <a class="home" href="#/" title="Back to case files"><Logo size={26} /></a>
    <span class="sep"></span>
    <h1>{mapLabel(r.match.map)}</h1>
    <div class="match" role="group" aria-label="Final score">
      <span class="final label">Final</span>
      <span class="team {sideClass(sides[0])}" title={r.teamName(0)}>{r.teamName(0)}</span>
      <span class="score num">
        <b class:lost={score[0] < score[1]}>{score[0]}</b>
        <i>:</i>
        <b class:lost={score[1] < score[0]}>{score[1]}</b>
      </span>
      <span class="team {sideClass(sides[1])}" title={r.teamName(1)}>{r.teamName(1)}</span>
    </div>
    <span class="spacer"></span>
    <span class="facts">
      <span><b class="num">{r.match.rounds.length}</b> rounds</span>
    </span>
    <button class="plain keys" class:on={help} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onclick={() => (help = !help)}>
      <Icon name="keyboard" size={17} />
    </button>
  </header>

  <aside class="roster">
    <TeamPanel {v} team={0} />
    <TeamPanel {v} team={1} />
  </aside>

  <section class="stage">
    <Radar {v} bind:this={radar} />
    <Hud {v} />
    <KillFeed {v} />
    <Toolbar {v} level={() => radar?.level() ?? 0} reset={() => radar?.resetCamera()} />
    {#if help}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="scrim" onclick={() => (help = false)}></div>
      <div class="help" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1" bind:this={dialog}>
        <div class="help-head">
          <h2 id="help-title">Keyboard shortcuts</h2>
          <button class="plain close" title="Close (Esc)" aria-label="Close" onclick={() => (help = false)}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div class="groups">
          {#each shortcuts as g (g.title)}
            <section>
              <h3 class="label">{g.title}</h3>
              {#each g.rows as row (row.text)}
                <div class="row">
                  <span class="combo">
                    {#each row.keys as key, i (i)}
                      {#if row.or && i > 0}<span class="to">to</span>{/if}
                      <kbd class:wide={key.length > 1 && key !== 'left' && key !== 'right'}>
                        {#if key === 'left' || key === 'right'}{@render arrow(key)}{:else}{key}{/if}
                      </kbd>
                    {/each}
                  </span>
                  <span class="what">{row.text}</span>
                </div>
              {/each}
            </section>
          {/each}
          <section>
            <h3 class="label">Mouse</h3>
            {#each mouse as [how, what] (how)}
              <div class="row">
                <span class="combo"><span class="gesture">{how}</span></span>
                <span class="what">{what}</span>
              </div>
            {/each}
          </section>
        </div>
      </div>
    {/if}
  </section>

  <aside class="side">
    <nav aria-label="Analysis">
      <div class="tabs" role="tablist">
        {#each tabs as t (t.id)}
          <button class="tab" class:active={v.tab === t.id} role="tab" aria-selected={v.tab === t.id} onclick={() => (v.tab = t.id)}>
            <span>{t.label}</span>
            {#if t.id === 'evidence' && r.blunders.length}<span class="count num" title="{r.blunders.length} pieces of evidence">{r.blunders.length}</span>{/if}
          </button>
        {/each}
      </div>
    </nav>
    <div class="tab-body" role="tabpanel">
      {#if v.tab === 'briefing'}
        <BriefingPanel {v} />
      {:else if v.tab === 'evidence'}
        <EvidencePanel {v} />
      {:else if v.tab === 'players'}
        <PlayersPanel {v} />
      {:else if v.tab === 'ballistics'}
        <BallisticsPanel {v} />
      {:else if v.tab === 'rounds'}
        <RoundsPanel {v} />
      {:else}
        <MapPanel {v} />
      {/if}
    </div>
  </aside>

  <footer>
    <Timeline {v} />
  </footer>
</div>

<style>
  .view {
    height: 100%;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 410px;
    grid-template-rows: 48px minmax(0, 1fr) auto;
    grid-template-areas:
      'head head head'
      'roster stage side'
      'foot foot foot';
    background: var(--bg);
  }

  /* Header */

  header {
    grid-area: head;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    min-width: 0;
  }

  .home {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 6px;
    margin-left: -6px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    transition: background 0.12s;
  }

  .home:hover {
    background: var(--surface-2);
  }

  .sep {
    width: 1px;
    height: 20px;
    background: var(--line-2);
    flex: none;
  }

  h1 {
    font-size: 19px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.01em;
    flex: none;
  }

  .match {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    height: 28px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--line);
  }

  .final {
    font-size: 10px;
    padding-right: 10px;
    border-right: 1px solid var(--line-2);
    line-height: 14px;
  }

  .team {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.3s;
  }

  .team.ct {
    color: var(--ct);
  }

  .team.t {
    color: var(--t);
  }

  .score {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    flex: none;
  }

  .score b {
    font-weight: 700;
    color: var(--text);
  }

  .score b.lost {
    color: var(--text-3);
  }

  .score i {
    font-style: normal;
    color: var(--text-3);
    font-weight: 600;
    transform: translateY(-1px);
  }

  .spacer {
    flex: 1;
  }

  .facts {
    display: flex;
    gap: 16px;
    flex: none;
    font-size: 12.5px;
    color: var(--text-3);
    white-space: nowrap;
  }

  .facts b {
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2);
  }

  .keys {
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    flex: none;
  }

  .keys:hover,
  .keys.on {
    color: var(--text);
  }

  /* Columns */

  .roster {
    grid-area: roster;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    background: var(--surface);
  }

  .stage {
    grid-area: stage;
    position: relative;
    min-height: 0;
    min-width: 0;
    background: var(--bg);
  }

  .side {
    grid-area: side;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    border-left: 1px solid var(--line);
    background: var(--surface);
  }

  /* Tabs */

  nav {
    flex: none;
  }

  .tabs {
    display: flex;
    height: 42px;
    padding: 0 6px;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tab {
    position: relative;
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 100%;
    padding: 0 7px;
    border: none;
    border-radius: 0;
    background: transparent;
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    white-space: nowrap;
  }

  .tab::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: -1px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: transparent;
    transition: background 0.15s;
  }

  .tab:hover {
    background: transparent;
    color: var(--text-2);
  }

  .tab.active {
    color: var(--text);
  }

  .tab.active::after {
    background: var(--accent);
  }

  .tab:focus-visible {
    outline-offset: -4px;
  }

  .count {
    min-width: 18px;
    height: 16px;
    padding: 0 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    background: var(--evidence);
    color: #1a1406;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
  }

  .tab:not(.active) .count {
    background: rgba(255, 194, 71, 0.16);
    color: var(--evidence);
  }

  .tab-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  footer {
    grid-area: foot;
    border-top: 1px solid var(--line);
    background: var(--surface);
    min-width: 0;
  }

  /* Shortcuts */

  .scrim {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(11, 13, 17, 0.62);
  }

  .help {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 21;
    width: min(660px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }

  .help:focus {
    outline: none;
  }

  .help-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 12px 12px 20px;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    font-size: 16px;
    font-weight: 700;
  }

  .close {
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
  }

  .close:hover {
    color: var(--text);
  }

  .groups {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px 28px;
    padding: 16px 20px 20px;
  }

  h3 {
    margin-bottom: 8px;
  }

  .row {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    min-height: 28px;
  }

  .combo {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 5px;
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    color: var(--text);
    background: var(--surface-3);
    border: 1px solid var(--line-2);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
  }

  kbd.wide {
    padding: 0 7px;
  }

  .to {
    font-size: 11px;
    color: var(--text-3);
    padding: 0 2px;
  }

  .gesture {
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }

  .what {
    color: var(--text-2);
    font-size: 13px;
    line-height: 1.3;
  }

  @media (max-width: 1280px) {
    .view {
      grid-template-columns: 240px minmax(0, 1fr) 370px;
    }

    .team {
      max-width: 150px;
    }

    .tabs {
      padding: 0 2px;
    }

    .tab {
      padding: 0 5px;
      font-size: 12px;
      letter-spacing: 0.04em;
    }

    .tab::after {
      left: 4px;
      right: 4px;
    }
  }

  @media (max-width: 1100px) {
    .facts {
      display: none;
    }
  }

  @media (max-width: 960px) {
    .view {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 48px 62vh auto auto auto;
      grid-template-areas: 'head' 'stage' 'foot' 'roster' 'side';
      height: auto;
    }

    .team {
      max-width: 130px;
    }

    .roster {
      border-right: none;
      border-top: 1px solid var(--line);
    }

    .side {
      min-height: 520px;
      border-left: none;
      border-top: 1px solid var(--line);
    }

    nav {
      position: sticky;
      top: 0;
      z-index: 6;
      background: var(--surface);
    }

    .groups {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    header {
      gap: 12px;
    }

    .match {
      display: none;
    }
  }
</style>
