<script lang="ts">
  import { mapLabel, ms } from '../lib/format'
  import { SPEEDS, type Tab, type Viewer } from '../lib/viewer.svelte'
  import BallisticsPanel from './BallisticsPanel.svelte'
  import BriefingPanel from './BriefingPanel.svelte'
  import EvidencePanel from './EvidencePanel.svelte'
  import Hud from './Hud.svelte'
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'briefing', label: 'Briefing' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'players', label: 'Players' },
    { id: 'ballistics', label: 'Ballistics' },
    { id: 'rounds', label: 'Rounds' },
    { id: 'map', label: 'Map' },
  ]

  // Number keys follow players in the order of the roster.
  const order = $derived([...r.teamPlayers[0].slice(0, 5), ...r.teamPlayers[1].slice(0, 5)])

  function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
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
      v.follow = -1
      v.focus = []
      help = false
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

<div class="view">
  <header>
    <a class="home" href="#/" title="Back to case files"><Logo size={24} word /></a>
    <span class="rule"></span>
    <h1>{mapLabel(r.match.map)}</h1>
    <span class="case">
      <span>{r.teamName(0)}</span>
      <span class="mono score">{r.match.teams[0].score} : {r.match.teams[1].score}</span>
      <span>{r.teamName(1)}</span>
    </span>
    <span class="spacer"></span>
    <span class="label">{r.match.rounds.length} rounds · read in {ms(r.parseMs)}</span>
    <button class="plain keys" title="Keyboard shortcuts (?)" onclick={() => (help = !help)}>?</button>
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
      <div class="help" role="dialog">
        <div class="help-head">
          <span class="label">Shortcuts</span>
          <button class="plain" onclick={() => (help = false)}>close</button>
        </div>
        <dl>
          <dt>Space</dt><dd>Play or pause</dd>
          <dt>← →</dt><dd>Back or forward 5 s, hold Shift for 1 s</dd>
          <dt>P N</dt><dd>Previous or next round</dd>
          <dt>[ ]</dt><dd>Slower or faster</dd>
          <dt>1 to 0</dt><dd>Follow a player</dd>
          <dt>Esc</dt><dd>Stop following</dd>
          <dt>R</dt><dd>Rotate with the followed player</dd>
          <dt>V</dt><dd>Team vision, only what the team could see</dd>
          <dt>G</dt><dd>Ghosts from the same moment in other rounds</dd>
          <dt>E</dt><dd>Evidence markers</dd>
          <dt>C</dt><dd>Callouts</dd>
          <dt>H</dt><dd>Names</dd>
          <dt>L</dt><dd>Switch floor</dd>
          <dt>Mouse</dt><dd>Drag to pan, scroll to zoom, click a player to follow, double click to reset</dd>
        </dl>
      </div>
    {/if}
  </section>

  <aside class="side">
    <nav>
      {#each tabs as t (t.id)}
        <button class="tab" class:active={v.tab === t.id} onclick={() => (v.tab = t.id)}>
          {t.label}
          {#if t.id === 'evidence' && r.blunders.length}<span class="count">{r.blunders.length}</span>{/if}
        </button>
      {/each}
    </nav>
    <div class="tab-body">
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
    grid-template-rows: 50px minmax(0, 1fr) auto;
    grid-template-areas:
      'head head head'
      'roster stage side'
      'foot foot foot';
  }

  header {
    grid-area: head;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 16px;
    border-bottom: 1px solid var(--rule);
    background: var(--ink);
  }

  .home {
    text-decoration: none;
    display: inline-flex;
  }

  .rule {
    width: 1px;
    height: 22px;
    background: var(--rule-2);
  }

  h1 {
    font-size: 20px;
    font-variation-settings: 'opsz' 48;
  }

  .case {
    display: flex;
    gap: 10px;
    align-items: baseline;
    color: var(--graphite);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .score {
    color: var(--paper);
  }

  .spacer {
    flex: 1;
  }

  .keys {
    font-family: var(--mono);
    width: 26px;
    height: 26px;
    padding: 0;
  }

  .roster {
    grid-area: roster;
    overflow-y: auto;
    border-right: 1px solid var(--rule);
    background: var(--desk);
  }

  .stage {
    grid-area: stage;
    position: relative;
    min-height: 0;
    background: var(--ink);
  }

  .side {
    grid-area: side;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--rule);
    background: var(--desk);
  }

  nav {
    display: flex;
    justify-content: space-between;
    padding: 0 8px;
    border-bottom: 1px solid var(--rule);
    overflow-x: auto;
  }

  .tab {
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 12px 5px 10px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--pencil);
    white-space: nowrap;
    display: inline-flex;
    gap: 5px;
    align-items: center;
  }

  .tab:hover {
    background: transparent;
    color: var(--graphite);
  }

  .tab.active {
    color: var(--paper);
    border-bottom-color: var(--marker);
  }

  .count {
    font-size: 9.5px;
    color: var(--ink);
    background: var(--evidence);
    border-radius: 2px;
    padding: 0 3px;
    letter-spacing: 0;
  }

  .tab-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  footer {
    grid-area: foot;
    border-top: 1px solid var(--rule);
    background: var(--desk);
  }

  .help {
    position: absolute;
    top: 70px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(21, 23, 27, 0.98);
    border: 1px solid var(--rule-2);
    border-radius: 3px;
    padding: 14px 18px;
    width: min(480px, 92%);
    z-index: 5;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  }

  .help-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .help-head button {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--graphite);
  }

  dl {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 7px 14px;
    margin: 12px 0 0;
  }

  dt {
    font-family: var(--mono);
    color: var(--paper);
    font-size: 12px;
  }

  dd {
    margin: 0;
    color: var(--graphite);
  }

  @media (max-width: 1280px) {
    .view {
      grid-template-columns: 240px minmax(0, 1fr) 370px;
    }

    .tab {
      padding: 12px 3px 10px;
      letter-spacing: 0.02em;
    }
  }

  @media (max-width: 960px) {
    .view {
      grid-template-columns: 1fr;
      grid-template-rows: 50px 62vh auto auto auto;
      grid-template-areas: 'head' 'stage' 'foot' 'roster' 'side';
      height: auto;
    }

    .case {
      display: none;
    }

    .side {
      min-height: 520px;
    }
  }
</style>
