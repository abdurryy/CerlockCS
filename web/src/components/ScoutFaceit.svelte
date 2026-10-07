<script lang="ts">
  import { ApiError, saveFaceitKey, scoutFind, scoutLookup } from '../lib/api'
  import { mapLabel } from '../lib/format'
  import type { ScoutPlayer, ScoutTeam } from '../lib/types'
  import Icon from './Icon.svelte'
  import ScoutIcon from './ScoutIcon.svelte'
  import ScoutMatches from './ScoutMatches.svelte'
  import type { ScoutState } from './ScoutPage.svelte'

  let { s }: { s: ScoutState } = $props()

  let key = $state('')
  let editing = $state(false)
  let keyBusy = $state(false)
  let keyError = $state('')
  let looking = $state(false)
  let lookError = $state('')
  let finding = $state(false)
  let findError = $state('')
  let keyInput: HTMLInputElement | undefined = $state()

  const hasKey = $derived(!!s.settings?.faceitKey)
  const showKeyForm = $derived(s.settings !== null && (!hasKey || editing))
  const playerCount = $derived(s.faceitPlayers.length)
  // At most five play on one side, so the choices are 5, 4 and 3 of them.
  const together = $derived.by(() => {
    const top = Math.min(5, playerCount)
    const low = Math.max(Math.min(2, top), top - 2)
    const out: number[] = []
    for (let k = top; k >= low; k--) out.push(k)
    return out
  })

  $effect(() => {
    if (together.length && !together.includes(s.minTogether)) s.minTogether = Math.min(4, together[0])
  })

  // FACEIT errors come with a code, some of them need the key changed.
  function message(e: unknown): string {
    const err = e as ApiError
    if (err.code === 'bad_key' || err.code === 'no_key') {
      editing = true
      setTimeout(() => keyInput?.focus(), 0)
    }
    return err.message || 'Something went wrong'
  }

  async function saveKey(e?: SubmitEvent) {
    e?.preventDefault()
    const k = key.trim()
    if (!k) return
    keyBusy = true
    keyError = ''
    try {
      s.settings = await saveFaceitKey(k)
      key = ''
      editing = false
      // A new key may be allowed to download demos.
      s.downloadsAllowed = null
      s.failed = {}
    } catch (err) {
      keyError = (err as Error).message
    } finally {
      keyBusy = false
    }
  }

  async function removeKey() {
    if (!confirm('Remove the FACEIT API key from Cerlock?')) return
    keyBusy = true
    keyError = ''
    try {
      s.settings = await saveFaceitKey('')
      editing = false
    } catch (err) {
      keyError = (err as Error).message
    } finally {
      keyBusy = false
    }
  }

  async function look(e?: SubmitEvent) {
    e?.preventDefault()
    const url = s.url.trim()
    if (!url) return
    looking = true
    lookError = ''
    try {
      const l = await scoutLookup(url)
      if (!l.teams.length) throw new Error('FACEIT sent no teams for this link.')
      s.lookup = l
      s.teamIndex = -1
      s.off = []
      if (l.teams.length === 1) s.pickTeam(0)
    } catch (err) {
      lookError = message(err)
    } finally {
      looking = false
    }
  }

  async function find() {
    if (!s.team || !playerCount) return
    finding = true
    findError = ''
    try {
      const min = Math.min(s.minTogether, playerCount)
      s.found = await scoutFind(s.faceitPlayers, min)
      s.foundFor = s.teamKey
      s.mapFilter = ''
      s.failed = {}
    } catch (err) {
      findError = message(err)
    } finally {
      finding = false
    }
  }

  function toggle(p: ScoutPlayer) {
    const id = p.faceitId || p.nickname
    s.off = s.off.includes(id) ? s.off.filter((x) => x !== id) : [...s.off, id]
  }

  function initials(name: string): string {
    const clean = name.replace(/[^\p{L}\p{N}]/gu, '')
    return (clean || name).slice(0, 2).toUpperCase()
  }

  function when(sec: number): string {
    if (!sec) return ''
    const d = new Date(sec * 1000)
    const now = new Date()
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((day(d) - day(now)) / 86400000)
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diff === 0) return `Today ${time}`
    if (diff === 1) return `Tomorrow ${time}`
    if (diff === -1) return `Yesterday ${time}`
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
  }

  function hide(e: Event) {
    ;(e.currentTarget as HTMLElement).style.display = 'none'
  }

  const validSteam = (id: string) => /^\d{15,20}$/.test(id) && id !== '0'
</script>

{#snippet avatar(src: string, name: string, size: number, round: boolean)}
  <span class="av" class:round style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.4)}px">
    <span class="ini">{initials(name)}</span>
    {#if src}<img {src} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={hide} />{/if}
  </span>
{/snippet}

{#snippet teamCard(t: ScoutTeam, i: number)}
  {@const picked = s.teamIndex === i}
  <div class="team" class:picked>
    <button class="team-head" aria-pressed={picked} onclick={() => s.pickTeam(i)}>
      {@render avatar(t.avatar, t.name, 38, false)}
      <span class="tname">
        <b title={t.name}>{t.name || 'Unnamed team'}</b>
        <span>{t.players.length} {t.players.length === 1 ? 'player' : 'players'}</span>
      </span>
      {#if picked}
        <span class="chip on">Scouting</span>
      {:else}
        <span class="chip">Scout this team</span>
      {/if}
    </button>
    <ul class="players">
      {#each t.players as p (p.faceitId || p.nickname)}
        {@const out = picked && s.off.includes(p.faceitId || p.nickname)}
        <li class:out>
          {#if picked}
            <label class="pick" title={out ? 'Left out of the search and the report' : 'In the search and the report'}>
              <input type="checkbox" checked={!out} onchange={() => toggle(p)} />
              {@render avatar(p.avatar, p.nickname, 24, true)}
              <span class="nick">{p.nickname}</span>
            </label>
          {:else}
            <span class="pick">
              {@render avatar(p.avatar, p.nickname, 24, true)}
              <span class="nick">{p.nickname}</span>
            </span>
          {/if}
          {#if !validSteam(p.steamId)}
            <span class="warn" title="FACEIT has no SteamID for this player, so Cerlock cannot find them in demos">No SteamID</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

<div class="panel">
  <!-- API key -->
  <div class="row keyrow">
    <span class="rlabel"><ScoutIcon name="key" size={15} />FACEIT API key</span>
    {#if s.settings === null}
      <span class="faint">Checking...</span>
    {:else if showKeyForm}
      <form class="keyform" onsubmit={saveKey}>
        <input
          bind:this={keyInput}
          bind:value={key}
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="Paste your server side API key"
          aria-label="FACEIT API key"
        />
        <button class="btn" type="submit" disabled={keyBusy || !key.trim()}>{keyBusy ? 'Checking...' : 'Save key'}</button>
        {#if hasKey}<button class="btn plain" type="button" onclick={() => (editing = false)}>Cancel</button>{/if}
      </form>
    {:else}
      <span class="saved"><Icon name="check" size={14} />Key saved <b class="num">{s.settings.faceitKeyHint}</b></span>
      <span class="grow"></span>
      <button class="btn small" onclick={() => (editing = true)}>Change</button>
      <button class="btn small plain" disabled={keyBusy} onclick={removeKey}>Remove</button>
    {/if}
  </div>
  {#if showKeyForm}
    <p class="help">
      Free from <a href="https://developers.faceit.com" target="_blank" rel="noopener noreferrer">developers.faceit.com<ScoutIcon name="external" size={12} /></a>:
      create an app, then add a server side API key and paste it here. It stays on this computer.
    </p>
  {/if}
  {#if keyError}<p class="err" role="alert">{keyError}</p>{/if}

  <!-- Match room or team link -->
  <form class="row lookrow" onsubmit={look}>
    <label class="rlabel" for="scout-url"><ScoutIcon name="users" size={15} />Match room or team</label>
    <input
      id="scout-url"
      class="url"
      bind:value={s.url}
      type="text"
      spellcheck="false"
      autocomplete="off"
      placeholder="https://www.faceit.com/en/cs2/room/1-... or a team link"
    />
    <button class="btn primary" type="submit" disabled={looking || !s.url.trim() || !hasKey} title={hasKey ? '' : 'Save your FACEIT API key first'}>
      {#if looking}<i class="spin"></i>{/if}
      <span>{looking ? 'Looking up' : 'Look up'}</span>
    </button>
  </form>
  {#if lookError}<p class="err" role="alert">{lookError}</p>{/if}

  {#if s.lookup}
    <div class="lookup">
      <div class="lhead">
        {#if s.lookup.matchId}
          <span class="label">Match</span>
          <span class="what">{s.lookup.competition || 'FACEIT match'}</span>
          {#if s.lookup.startedAt}<span class="faint">{when(s.lookup.startedAt)}</span>{/if}
          {#if s.lookup.map}<span class="faint">{mapLabel(s.lookup.map)}</span>{/if}
        {:else}
          <span class="label">Team</span>
          <span class="what">{s.lookup.teams[0]?.name}</span>
        {/if}
        <span class="grow"></span>
        {#if s.teamIndex < 0}<span class="hint">Pick the team to scout</span>{/if}
      </div>
      <div class="teams" class:single={s.lookup.teams.length === 1}>
        {#each s.lookup.teams as t, i (i)}
          {@render teamCard(t, i)}
        {/each}
      </div>

      {#if s.team}
        <div class="row findrow">
          <label class="together">
            <span>Played together</span>
            <select bind:value={s.minTogether} disabled={finding}>
              {#each together as k (k)}
                <option value={k}>{k} of {playerCount}</option>
              {/each}
            </select>
          </label>
          <button class="btn primary" disabled={finding || !playerCount} onclick={find}>
            {#if finding}<i class="spin"></i>{/if}
            <span>{finding ? 'Looking through their matches' : 'Find their matches'}</span>
          </button>
          <span class="faint small">Checks the last 100 matches of each player, pugs and practice included.</span>
        </div>
        {#if findError}<p class="err" role="alert">{findError}</p>{/if}
      {/if}
    </div>
  {/if}
</div>

{#if s.found && s.foundFor === s.teamKey && s.team}
  <ScoutMatches {s} />
{/if}

<style>
  .panel {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 10px 16px;
    min-width: 0;
  }

  .row + .row,
  .help + .row,
  .err + .row {
    border-top: 1px solid var(--line);
  }

  .rlabel {
    width: 178px;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }

  .rlabel :global(.icon) {
    color: var(--text-3);
  }

  input[type='text'],
  input[type='password'] {
    height: 36px;
    min-width: 0;
    padding: 0 12px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
  }

  input::placeholder {
    color: var(--text-3);
  }

  .keyform {
    flex: 1;
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .keyform input {
    flex: 1;
    max-width: 440px;
  }

  .url {
    flex: 1;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    flex: none;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  .btn.small {
    height: 30px;
    padding: 0 12px;
    font-size: 13px;
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: #f6636a;
    border-color: #f6636a;
  }

  .saved {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text-2);
  }

  .saved :global(.icon) {
    color: var(--good);
  }

  .saved b {
    font-family: var(--display);
    font-weight: 600;
    color: var(--text);
  }

  .grow {
    flex: 1;
  }

  .help {
    margin: -6px 0 0;
    padding: 0 16px 12px 206px;
    color: var(--text-2);
  }

  .help a {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text);
    font-weight: 500;
  }

  .err {
    margin: -4px 16px 12px 206px;
    color: var(--bad);
  }

  .small {
    font-size: 12.5px;
  }

  .spin {
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: spin 0.8s linear infinite;
  }

  /* Lookup result */

  .lookup {
    border-top: 1px solid var(--line);
    padding: 14px 16px 4px;
    background: var(--bg);
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .lhead {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 12px;
    min-width: 0;
  }

  .what {
    font-family: var(--display);
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    font-family: var(--display);
    font-size: 13px;
    font-weight: 600;
    color: var(--evidence);
  }

  .teams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .teams.single {
    grid-template-columns: minmax(0, 560px);
  }

  .team {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    transition: border-color 0.12s;
  }

  .team.picked {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .team-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: var(--radius) var(--radius) 0 0;
    background: transparent;
    text-align: left;
  }

  .team-head:hover {
    background: var(--surface-2);
  }

  .tname {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .tname b {
    font-family: var(--display);
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tname span {
    font-size: 12.5px;
    color: var(--text-3);
  }

  .chip {
    flex: none;
    height: 24px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-2);
    font-family: var(--display);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-2);
  }

  .chip.on {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .players {
    list-style: none;
    margin: 0;
    padding: 6px 0;
  }

  .players li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 12px;
  }

  .players li.out .nick,
  .players li.out .av {
    opacity: 0.4;
  }

  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
  }

  label.pick {
    cursor: pointer;
  }

  .pick input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
  }

  .nick {
    font-family: var(--display);
    font-size: 14.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .warn {
    font-size: 12px;
    color: var(--warn);
    white-space: nowrap;
  }

  .av {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--line-2);
    overflow: hidden;
  }

  .av.round {
    border-radius: 50%;
  }

  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .ini {
    font-family: var(--display);
    font-weight: 700;
    color: var(--text-2);
    letter-spacing: 0.02em;
  }

  .findrow {
    margin: 12px -16px 0;
    border-top: 1px solid var(--line);
    flex-wrap: wrap;
  }

  .together {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  .together select {
    height: 36px;
    padding: 0 8px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 600;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 860px) {
    .row {
      flex-wrap: wrap;
    }

    .rlabel {
      width: 100%;
    }

    .help,
    .err {
      padding-left: 16px;
      margin-left: 16px;
    }

    .help {
      padding-left: 16px;
      margin-left: 0;
    }

    .teams {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
