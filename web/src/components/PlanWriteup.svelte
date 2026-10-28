<script lang="ts">
  import { ApiError, aiModels, getSettings, saveAi, writePlan } from '../lib/api'
  import { copyText } from '../lib/clipboard'
  import { mapLabel } from '../lib/format'
  import { factsText, writeupBlocks } from '../lib/scout/plan'
  import type { MapScout } from '../lib/scout/types'
  import type { AiProvider, AiSettings } from '../lib/types'
  import Icon from './Icon.svelte'

  // Writes the game plan up in plain words with a model the user picked:
  // Ollama on their own PC, or Groq or OpenRouter with their own key. Only
  // the plan, the tendencies and the roles are sent.
  let { scout, teamName, onclose }: { scout: MapScout; teamName: string; onclose: () => void } = $props()

  type Stage = 'loading' | 'setup' | 'writing' | 'done'
  let stage = $state<Stage>('loading')
  let ai = $state<AiSettings | null>(null)
  let provider = $state('ollama')
  let model = $state('')
  let url = $state('')
  let key = $state('')
  let models = $state<string[]>([])
  let error = $state('')
  let saving = $state(false)
  let result = $state<{ text: string; model: string; provider: string } | null>(null)
  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const HELP: Record<string, { label: string; text: string; link: string; linkText: string }> = {
    ollama: {
      label: 'Ollama, on your PC',
      text: 'Free and nothing leaves your PC. Install Ollama, then run "ollama pull llama3.1:8b" once. On a PC without a strong graphics card it can take a minute.',
      link: 'https://ollama.com/download',
      linkText: 'Get Ollama',
    },
    groq: {
      label: 'Groq, free key',
      text: 'Fast and free with a key from Groq. The plan text is sent to Groq, the demos stay on your PC.',
      link: 'https://console.groq.com/keys',
      linkText: 'Get a Groq key',
    },
    openrouter: {
      label: 'OpenRouter, free models',
      text: 'Free models with a key from OpenRouter. The plan text is sent to OpenRouter, the demos stay on your PC.',
      link: 'https://openrouter.ai/keys',
      linkText: 'Get an OpenRouter key',
    },
  }

  const providers = $derived<AiProvider[]>(ai?.providers ?? [])
  const current = $derived(providers.find((p) => p.id === provider))
  const savedKey = $derived(ai?.keys[provider])
  const ready = $derived(!!ai && !!ai.provider && !!providers.find((p) => p.id === ai!.provider && (!p.needsKey || ai!.keys[p.id]?.saved)))
  const shown = $derived(result ? writeupBlocks(result.text) : [])

  $effect(() => {
    let live = true
    getSettings()
      .then((s) => {
        if (!live) return
        ai = s.ai ?? null
        provider = ai?.provider || 'ollama'
        model = ai?.model ?? ''
        url = ai?.url ?? ''
        if (ready) write()
        else openSetup()
      })
      .catch((e) => {
        if (!live) return
        error = (e as Error).message
        stage = 'setup'
      })
    return () => {
      live = false
      clearTimeout(timer)
    }
  })

  function openSetup() {
    stage = 'setup'
    key = ''
    if (provider === 'ollama' && ai?.provider === 'ollama') {
      aiModels()
        .then((m) => (models = m))
        .catch(() => {})
    }
  }

  function pick(id: string) {
    if (id === provider) return
    provider = id
    // Each provider has its own model names.
    model = ai?.provider === id ? ai.model : ''
    key = ''
    error = ''
  }

  async function saveAndWrite() {
    if (saving) return
    error = ''
    if (current?.needsKey && !key.trim() && !savedKey?.saved) {
      error = `Paste your ${current.name} key first`
      return
    }
    saving = true
    try {
      ai = await saveAi({
        provider,
        model: model.trim(),
        url: provider === 'ollama' ? url.trim() : undefined,
        key: current?.needsKey && key.trim() ? key.trim() : undefined,
      })
      key = ''
      await write()
    } catch (e) {
      error = (e as Error).message || 'Could not save it'
    } finally {
      saving = false
    }
  }

  async function write() {
    stage = 'writing'
    error = ''
    try {
      result = await writePlan(factsText(scout, mapLabel(scout.map), teamName))
      stage = 'done'
    } catch (e) {
      error = (e as Error).message || 'Could not write it'
      // A wrong key or model is fixed in the setup.
      const code = e instanceof ApiError ? e.code : ''
      if (code === 'ai_off' || code === 'ai_bad_key' || code === 'ai_no_model' || code === 'ai_unreachable' || !result) openSetup()
      else stage = 'done'
    }
  }

  async function copy() {
    if (!result) return
    copied = await copyText(result.text)
    clearTimeout(timer)
    timer = setTimeout(() => (copied = false), 2000)
  }
</script>

<div class="wu" aria-live="polite">
  {#if stage === 'loading'}
    <p class="faint"><i class="spin"></i> One moment</p>
  {:else if stage === 'setup'}
    <div class="setup">
      <div class="top">
        <b>Write it up in plain words</b>
        <button class="plain x" aria-label="Close" title="Close" onclick={onclose}><Icon name="x" size={14} /></button>
      </div>
      <p class="dim">A language model turns the plan above into a short text for your team. It only gets the lines of this plan, their tendencies and roles, so it cannot make up much. Pick one:</p>
      <div class="seg" role="group" aria-label="Model">
        {#each providers as p (p.id)}
          <button class:on={provider === p.id} aria-pressed={provider === p.id} onclick={() => pick(p.id)}>{HELP[p.id]?.label ?? p.name}</button>
        {/each}
      </div>
      {#if HELP[provider]}
        <p class="help">{HELP[provider].text} <a href={HELP[provider].link} target="_blank" rel="noreferrer">{HELP[provider].linkText}</a></p>
      {/if}
      <div class="fields">
        {#if current?.needsKey}
          <label>
            <span>{current.name} key</span>
            <input type="password" autocomplete="off" spellcheck="false" bind:value={key} placeholder={savedKey?.saved ? `Saved ${savedKey.hint}, leave empty to keep it` : 'Paste your key'} />
          </label>
        {/if}
        <label>
          <span>Model</span>
          <input type="text" spellcheck="false" bind:value={model} placeholder={current?.model ?? ''} list="ai-models-{scout.map}" />
          {#if models.length}
            <datalist id="ai-models-{scout.map}">
              {#each models as m (m)}<option value={m}></option>{/each}
            </datalist>
          {/if}
        </label>
        {#if provider === 'ollama'}
          <label>
            <span>Address</span>
            <input type="text" spellcheck="false" bind:value={url} placeholder={current?.url ?? 'http://127.0.0.1:11434'} />
          </label>
        {/if}
      </div>
      {#if error}<p class="err">{error}</p>{/if}
      <div class="row">
        <button class="primary" disabled={saving} onclick={saveAndWrite}>{saving ? 'Saving' : 'Save and write'}</button>
        <button class="btn" onclick={onclose}>Cancel</button>
        <span class="faint small">Keys stay in Cerlock's settings on this PC.</span>
      </div>
    </div>
  {:else if stage === 'writing'}
    <p class="writing"><i class="spin"></i> Writing the plan with {ai?.model || current?.model || 'the model'}{ai?.provider === 'ollama' ? ', this can take a minute' : ''}</p>
  {:else if result}
    <div class="text">
      {#each shown as b, i (i)}
        {#if b.kind === 'h'}<h5>{b.text}</h5>{:else if b.kind === 'li'}<p class="li">{b.text}</p>{:else}<p>{b.text}</p>{/if}
      {/each}
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    <div class="row">
      <button class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy text'}</button>
      <button class="btn" onclick={write}>Write again</button>
      <button class="plain link" onclick={openSetup}>Change model</button>
      <span class="faint small">Written by {result.provider} {result.model} from the plan above. Check it against the rounds.</span>
    </div>
  {/if}
</div>

<style>
  .wu {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius);
    background: var(--surface-2);
  }

  .wu p {
    margin: 0;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--display);
    font-size: 16px;
  }

  .x {
    padding: 4px;
  }

  .setup .dim {
    margin: 4px 0 10px;
    font-size: 13px;
  }

  .seg button {
    font-family: var(--display);
    font-weight: 600;
  }

  .help {
    margin-top: 8px !important;
    font-size: 13px;
    color: var(--text-2);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-top: 10px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 220px;
    flex: 1;
    font-size: 12px;
    color: var(--text-3);
  }

  input {
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--line-2);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
  }

  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
    margin-top: 12px;
  }

  .btn,
  .primary {
    height: 32px;
    padding: 0 12px;
    font-family: var(--display);
    font-weight: 600;
  }

  .link {
    color: var(--text-2);
    font-size: 13px;
    text-decoration: underline;
  }

  .small {
    font-size: 12px;
  }

  .err {
    margin-top: 10px !important;
    color: var(--bad);
    font-size: 13px;
  }

  .writing {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-2);
    font-size: 13.5px;
  }

  .text h5 {
    margin: 12px 0 4px;
    font-family: var(--display);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }

  .text h5:first-child {
    margin-top: 0;
    font-size: 16px;
  }

  .text p {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-2);
  }

  .text p.li {
    position: relative;
    padding-left: 14px;
  }

  .text p.li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.62em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-3);
  }

  .spin {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--line-2);
    border-top-color: var(--text-2);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
