<script lang="ts">
  import { COLORED, iconUrl, icons } from '../lib/icons.svelte'

  // A game icon (weapon, grenade, armor, killfeed modifier...) at a given
  // height. Icons take the text colour unless `color` is set. When the icon
  // is not available (offline, unknown weapon) the fallback text is shown.
  let {
    name,
    h = 14,
    color,
    title,
    fallback = '',
  }: { name: string | null; h?: number; color?: string; title?: string; fallback?: string } = $props()

  const ok = $derived(icons.has(name))
  const w = $derived(ok ? h * icons.aspect(name!) : 0)
</script>

{#if ok && COLORED.has(name!)}
  <img class="icon" src={iconUrl(name!)} alt={title ?? ''} {title} style:height="{h}px" style:width="{w}px" />
{:else if ok}
  <i
    class="icon"
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : 'true'}
    {title}
    style:--u="url({iconUrl(name!)})"
    style:height="{h}px"
    style:width="{w}px"
    style:background-color={color}
  ></i>
{:else if fallback}
  <span class="fallback" {title} style:color>{fallback}</span>
{/if}

<style>
  .icon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
  }

  i.icon {
    background-color: currentColor;
    -webkit-mask: var(--u) center / contain no-repeat;
    mask: var(--u) center / contain no-repeat;
  }

  .fallback {
    font-family: var(--display);
    font-weight: 600;
    font-size: 0.92em;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
</style>
