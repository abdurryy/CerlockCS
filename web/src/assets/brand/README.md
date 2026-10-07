# Cerlock logo files

The mark is a Counter-Terrorist operator seen from the side, built heavy and solid like a geared-up CS2 CT. He wears a high cut combat helmet with a small night vision mount, a thick plate carrier with magazine pouches on the chest, a wide duty belt with a pouch, loose tactical trousers with a knee pad, chunky combat boots and gloves. He stands in a firing stance: feet apart, knees bent, weight forward. Instead of a gun he holds up a magnifying glass. Both gloved hands grip the lower end of the handle, the rear hand supporting the front one like a pistol grip, and the lens sits at eye level just ahead of his face. A demo is a case, and he is looking for the evidence.

The magnifying glass is sized like a real one: the lens is a little narrower than his helmet, with an even rim, a long handle with a short collar where it meets the rim, and a small shine inside. The short red glint in the lens is the only brand red in the logo.

There is no background shape. The figure sits on a transparent background, so pick the file that matches the colour behind it.

## Files

| File | What it is | When to use it |
| --- | --- | --- |
| `mark-dark.svg` | Figure in `#ECEFF3` with a red `#F04B53` glint in the lens | On dark backgrounds, like the app background `#0B0D11` and dark panels |
| `mark-light.svg` | Figure in `#0B0D11` with the red glint | On white and light grey backgrounds |
| `mark-white.svg` | Pure white `#FFFFFF`, no red | Watermarks, overlays on screenshots or video, one colour use on dark |
| `mark-black.svg` | Pure black `#000000`, no red | One colour print, stamps, embossing, anywhere only black is allowed |
| `lockup-dark.svg` | Mark plus the "cerlock" wordmark in `#ECEFF3` | Headers, the README banner and slides on dark backgrounds |
| `lockup-light.svg` | Mark plus the wordmark in `#0B0D11` | The same places on light backgrounds |
| `favicon.svg` | A bolder, simpler version of the figure with a bigger helmet, thicker limbs, a slightly bigger lens with a thicker rim and a visible handle, made to read at 16 and 32 px | Browser tab icon. It switches by itself: near black on a light browser theme, light on a dark browser theme |
| `favicon-32.png` | 32 x 32 PNG of the favicon, transparent background | Fallback for browsers that do not support SVG favicons |
| `icon-192.png` | 192 x 192 PNG of the favicon, transparent background, small margin | Web app manifest icon |
| `icon-512.png` | 512 x 512 PNG of the favicon, transparent background, small margin | Web app manifest icon, large previews |

The PNG icons use the light background version (near black figure with the red glint), because a transparent PNG cannot switch colour with the theme. If an icon has to sit on a dark surface, use `mark-dark.svg` or the SVG favicon instead.

## Wordmark

The wordmark is "CERLOCK" in uppercase, set in Exo 2 Black Italic (900) with the font's own kerning. The letters are converted to outlines, so the lockups do not need the font to be loaded. Exo 2 is under the SIL Open Font License.

## Using the favicon

The favicon files live here with the rest of the brand files. To use them, copy them to `web/public/` and link them in `web/index.html`:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
```

## Simple rules

- Do not use the full mark smaller than 40 px tall. Below that, use `favicon.svg`.
- Do not use a lockup smaller than 20 px tall.
- Keep clear space around the logo at least as wide as the lens.
- Do not recolour the figure with team colours, add outlines or shadows, stretch it, or rotate it.
- Do not put a light background file on a dark background, or the other way round.
- Keep the red glint red and small. It is the only accent colour in the logo.

## Colours

| Name | Hex |
| --- | --- |
| Figure on dark | `#ECEFF3` |
| Figure on light | `#0B0D11` |
| Brand red (lens glint) | `#F04B53` |
