<script lang="ts">
  import { mapLabel, ms } from '../lib/format'
  import { SPEEDS, type Tab, type Viewer } from '../lib/viewer.svelte'
  import AimPanel from './AimPanel.svelte'
  import Hud from './Hud.svelte'
  import Icon from './Icon.svelte'
  import KillFeed from './KillFeed.svelte'
  import PlayersPanel from './PlayersPanel.svelte'
  import Radar from './Radar.svelte'
  import ReviewPanel from './ReviewPanel.svelte'
  import RoundsPanel from './RoundsPanel.svelte'
  import TeamPanel from './TeamPanel.svelte'
  import Timeline from './Timeline.svelte'
  import Toolbar from './Toolbar.svelte'

  let { v }: { v: Viewer } = $props()
  const r = $derived(v.replay)
  let radar: ReturnType<typeof Radar> | undefined = $state()
  let help = $state(false)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'review', label: 'Review' },
    { id: 'players', label: 'Players' },
    { id: 'aim', label: 'Aim' },
    { id: 'rounds', label: 'Rounds' },
  ]

  // Number keys follow players in the order of the side panels.
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
    <a class="back" href="#/" title="Back to library"><Icon name="back" /></a>
    <strong>{mapLabel(r.match.map)}</strong>
    <span class="muted">{r.teamName(0)} {r.match.teams[0].score} : {r.match.teams[1].score} {r.teamName(1)}</span>
    <span class="spacer"></span>
    <span class="muted small" title="Parse time on the server">parsed in {ms(r.parseMs)}</span>
    <button class="ghost" title="Keyboard shortcuts (?)" onclick={() => (help = !help)}><Icon name="keyboard" /></button>
  </header>

  <aside class="teams">
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
        <div class="help-head"><strong>Shortcuts</strong><button class="ghost" onclick={() => (help = false)}><Icon name="x" size={14} /></button></div>
        <dl>
          <dt>Space</dt><dd>Play / pause</dd>
          <dt>Left / Right</dt><dd>Back / forward 5 s (Shift for 1 s)</dd>
          <dt>P / N</dt><dd>Previous / next round</dd>
          <dt>[ / ]</dt><dd>Slower / faster</dd>
          <dt>1 - 0</dt><dd>Follow a player</dd>
          <dt>Esc</dt><dd>Stop following</dd>
          <dt>R</dt><dd>Rotate with the followed player</dd>
          <dt>V</dt><dd>Team vision, only show what the team could see</dd>
          <dt>G</dt><dd>Ghosts from the same moment in other rounds</dd>
          <dt>H</dt><dd>Names</dd>
          <dt>L</dt><dd>Switch floor on two level maps</dd>
          <dt>Mouse</dt><dd>Drag to pan, wheel to zoom, click a player to follow, double click to reset</dd>
        </dl>
      </div>
    {/if}
  </section>

  <aside class="side">
    <nav>
      {#each tabs as t (t.id)}
        <button class="tab" class:active={v.tab === t.id} onclick={() => (v.tab = t.id)}>{t.label}</button>
      {/each}
    </nav>
    <div class="tab-body">
      {#if v.tab === 'review'}
        <ReviewPanel {v} />
      {:else if v.tab === 'players'}
        <PlayersPanel {v} />
      {:else if v.tab === 'aim'}
        <AimPanel {v} />
      {:else}
        <RoundsPanel {v} />
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
    grid-template-columns: 290px minmax(0, 1fr) 390px;
    grid-template-rows: 44px minmax(0, 1fr) auto;
    grid-template-areas:
      'head head head'
      'teams stage side'
      'foot foot foot';
  }

  header {
    grid-area: head;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .back {
    display: inline-flex;
    color: var(--text-2);
    padding: 4px;
    border-radius: 6px;
  }

  .back:hover {
    background: var(--panel-3);
    color: var(--text);
  }

  .spacer {
    flex: 1;
  }

  .small {
    font-size: 12px;
  }

  .teams {
    grid-area: teams;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    background: var(--panel);
    display: flex;
    flex-direction: column;
  }

  .stage {
    grid-area: stage;
    position: relative;
    min-height: 0;
    background: var(--bg);
  }

  .side {
    grid-area: side;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--line);
    background: var(--panel);
  }

  nav {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid var(--line);
  }

  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 8px 10px;
    color: var(--text-2);
  }

  .tab:hover {
    background: transparent;
    color: var(--text);
  }

  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
    background: transparent;
  }

  .tab-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  footer {
    grid-area: foot;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }

  .help {
    position: absolute;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(17, 22, 29, 0.97);
    border: 1px solid var(--line-2);
    border-radius: 10px;
    padding: 12px 16px;
    width: min(460px, 90%);
    z-index: 5;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .help-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  dl {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 6px 12px;
    margin: 10px 0 0;
  }

  dt {
    font-family: var(--mono);
    color: var(--text-2);
  }

  dd {
    margin: 0;
  }

  @media (max-width: 1250px) {
    .view {
      grid-template-columns: 250px minmax(0, 1fr) 330px;
    }
  }

  @media (max-width: 960px) {
    .view {
      grid-template-columns: 1fr;
      grid-template-rows: 44px 60vh auto auto auto;
      grid-template-areas: 'head' 'stage' 'foot' 'teams' 'side';
      height: auto;
    }

    .side {
      min-height: 500px;
    }
  }
</style>
