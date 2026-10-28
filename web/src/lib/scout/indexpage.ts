import { mapLabel } from '../format'
import { BUY_ORDER } from './situations'
import type { MapScout, Situation } from './types'

// indexHtml writes the page saved next to the videos: every map with its
// tendencies and roles, then every saved video and round sheet by side and
// round type. Paths are relative to the page.

export interface SavedVideo {
  map: string
  situation: Situation
  path: string
  // Which rounds a part of a split situation has, 1 based.
  part?: { from: number; to: number }
  // Where each round starts in a round by round video, to jump there.
  chapters?: { round: number; at: number }[]
}

// SavedSheet is a round sheet image.
export interface SavedSheet {
  map: string
  situation: Situation
  path: string
  part?: { from: number; to: number }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function buyName(s: Situation): string {
  const b = s.title.replace(/^(CT|T) /, '')
  return b.charAt(0).toUpperCase() + b.slice(1)
}

function clock(sec: number): string {
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function chapterList(s: Situation, v: SavedVideo): string {
  if (!v.chapters?.length) return ''
  const items = v.chapters
    .map((c) => {
      const tr = s.tracks[c.round]
      if (!tr) return ''
      const hit = tr.hit ? `, ${esc(tr.hit)}` : ''
      return `<li><button type="button" data-t="${c.at.toFixed(2)}"><span><time>${clock(c.at)}</time>${esc(tr.label)}</span><span class="${tr.won ? 'good' : 'bad'}">${tr.won ? 'Won' : 'Lost'}${hit}</span></button></li>`
    })
    .join('')
  return `<ol class="ch">${items}</ol>`
}

function situationCard(s: Situation, videos: SavedVideo[], sheets: SavedSheet[]): string {
  const notes = s.notes.slice(0, 2).map((n) => `<li>${esc(n)}</li>`).join('')
  const clips = videos
    .map((v) => {
      const label = v.part ? `<div class="part">Rounds ${v.part.from} to ${v.part.to}</div>` : ''
      return `<div class="clip">${label}<video controls preload="metadata" src="${esc(v.path)}"></video>${chapterList(s, v)}</div>`
    })
    .join('')
  const pics = sheets
    .map((p) => {
      const what = p.part ? `Round sheet, rounds ${p.part.from} to ${p.part.to}` : 'Round sheet'
      return `<a class="sheet" href="${esc(p.path)}" target="_blank" title="${what}, opens full size"><img src="${esc(p.path)}" alt="${what}" loading="lazy"><span>${what}</span></a>`
    })
    .join('')
  const won = s.won * 2 >= s.rounds ? 'good' : 'bad'
  return `<article class="card">
<header><h4>${esc(buyName(s))}</h4><span class="rec"><b class="${won}">${s.won}</b>/${s.rounds} won</span></header>
${notes ? `<ul class="notes">${notes}</ul>` : ''}
${clips}
${pics}
</article>`
}

function mapSection(m: MapScout, videos: SavedVideo[], sheets: SavedSheet[]): string {
  const name = mapLabel(m.map)
  const tend = m.tendencies.slice(0, 5).map((t) => `<li>${esc(t)}</li>`).join('')
  const roles = m.roles
    .map((r) => `<tr><td><i style="background:${esc(r.color)}"></i>${esc(r.name)}</td><td>${esc(r.ct.label || '-')}</td><td>${esc(r.t.label || '-')}</td></tr>`)
    .join('')
  const sides = (['ct', 't'] as const)
    .map((side) => {
      const list = BUY_ORDER.flatMap((buy) => {
        const s = m.situations.find((x) => x.side === side && x.buy === buy)
        const vids = s ? videos.filter((v) => v.situation === s) : []
        const pics = s ? sheets.filter((p) => p.situation === s) : []
        return s && (vids.length || pics.length) ? [situationCard(s, vids, pics)] : []
      })
      if (!list.length) return ''
      return `<h3 class="${side}">${side.toUpperCase()} side</h3><div class="grid">${list.join('')}</div>`
    })
    .join('')
  return `<section id="${esc(m.map)}">
<h2>${esc(name)}</h2>
<p class="dim">${plural(m.replays.length, 'match')}, CT ${m.won.ct}/${m.ctRounds} and T ${m.won.t}/${m.tRounds} rounds won</p>
<div class="top">
${tend ? `<div><h5>Tendencies</h5><ul class="notes">${tend}</ul></div>` : ''}
${roles ? `<div><h5>Roles</h5><table><tr><th>Player</th><th>CT</th><th>T</th></tr>${roles}</table></div>` : ''}
</div>
${sides}
</section>`
}

// Jumps a video to a round from its list and marks the round playing.
const SCRIPT = `document.addEventListener('click', (e) => {
  const b = e.target.closest('.ch button')
  if (!b) return
  const v = b.closest('.clip').querySelector('video')
  v.currentTime = Number(b.dataset.t)
  v.play()
})
for (const v of document.querySelectorAll('.clip video')) {
  const list = [...v.closest('.clip').querySelectorAll('.ch button')]
  v.addEventListener('timeupdate', () => {
    let k = -1
    list.forEach((b, i) => { if (Number(b.dataset.t) <= v.currentTime + 0.05) k = i })
    list.forEach((b, i) => b.classList.toggle('on', i === k))
  })
}`

export function indexHtml(teamName: string, scouts: MapScout[], videos: SavedVideo[], sheets: SavedSheet[] = []): string {
  const maps = scouts.filter((m) => videos.some((v) => v.map === m.map) || sheets.some((p) => p.map === m.map))
  const team = teamName.trim() || 'the team'
  const nav = maps.map((m) => `<a href="#${esc(m.map)}">${esc(mapLabel(m.map))}</a>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(team)} scouting videos</title>
<style>
:root{color-scheme:dark;--bg:#0b0d11;--surface:#12151a;--line:#242a32;--text:#eceff3;--text-2:#a6afba;--text-3:#6e7883;--ct:#62a9f5;--t:#efa63c;--good:#3ccb8a;--bad:#ff6464;--accent:#f04b53}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:30px;margin:0 0 4px}
h2{font-size:24px;margin:40px 0 2px}
h3{font-size:16px;letter-spacing:.06em;text-transform:uppercase;margin:24px 0 10px}
h3.ct{color:var(--ct)}h3.t{color:var(--t)}
h4{margin:0;font-size:16px}
h5{margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.dim{color:var(--text-2);margin:0}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}
nav a{color:var(--text);text-decoration:none;border:1px solid var(--line);border-radius:4px;padding:4px 10px;background:var(--surface)}
.top{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:14px}
.top>div{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:12px 14px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid var(--line)}
th{color:var(--text-3);font-weight:600;font-size:12px}
td i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:12px}
.card header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.rec{color:var(--text-3)}.good{color:var(--good)}.bad{color:var(--bad)}
.notes{margin:0 0 8px;padding-left:18px;color:var(--text-2)}
.part{color:var(--text-3);font-size:13px;margin:8px 0 4px}
.clip+.clip{margin-top:10px}
video{width:100%;border-radius:4px;background:#000;display:block}
.ch{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:180px;overflow-y:auto}
.ch button{all:unset;box-sizing:border-box;width:100%;display:flex;justify-content:space-between;gap:10px;padding:3px 8px;border-radius:4px;cursor:pointer;color:var(--text-2);font-size:13px}
.ch button:hover{background:var(--line);color:var(--text)}
.ch button:focus-visible{outline:2px solid var(--accent)}
.ch button.on{background:var(--line);color:var(--text)}
.ch span+span{font-size:12px}
.ch time{color:var(--text-3);font-variant-numeric:tabular-nums;margin-right:10px}
.sheet{display:block;margin-top:10px;color:var(--text-3);font-size:13px;text-decoration:none}
.sheet img{width:100%;border-radius:4px;display:block;border:1px solid var(--line)}
.sheet span{display:block;margin-top:4px}
.sheet:hover span{color:var(--text)}
footer{margin-top:48px;color:var(--text-3);font-size:13px}
</style>
</head>
<body>
<main>
<h1>${esc(team)}</h1>
<p class="dim">Scouting videos and round sheets by map, side and round type.</p>
<nav>${nav}</nav>
${maps.map((m) => mapSection(m, videos.filter((v) => v.map === m.map), sheets.filter((p) => p.map === m.map))).join('\n')}
<footer>Made with CerlockCS</footer>
</main>
<script>
${SCRIPT}
</script>
</body>
</html>
`
}
