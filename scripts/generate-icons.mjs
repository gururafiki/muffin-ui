// Render the Muffin mascot into every launcher/app icon the project ships.
//
// WHY THIS EXISTS: the icons were still `create-expo-app`'s blue chevron on
// Android, iOS and the web, while the app's real mark lived only inside the UI
// (`src/components/ui/logo.tsx`). Rather than hand-cut PNGs that rot the moment
// the mascot changes, this regenerates them all from one SVG.
//
// KEEP IN SYNC: `MUFFIN` below mirrors `src/components/ui/logo.tsx`. It cannot
// import it — that component is `react-native-svg`, which does not render in a
// browser — so if the mascot changes, change it in both places and re-run this.
//
//   node scripts/generate-icons.mjs
//
// Requires system Chrome + puppeteer-core (a devDependency), the same pair the
// smoke tests already use.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');

// Mirrors `theme/colors.ts`.
const C = {
  ink: '#2E2140',
  crust: '#F3E7D2',
  pleat: '#D9C7A8',
  butter500: '#E9A94D',
  blueberry400: '#524785',
  blueberry500: '#3C3366',
  leaf500: '#7FB35C',
  frosting700: '#5A3C77',
};

// The mark's own 64x64 space, framed TIGHTLY to its artwork (x 6.7..55.3,
// y 11..59.6) rather than to the viewBox. The art is not centred in 0 0 64 64 —
// it sits low and left — so framing by the viewBox would push the muffin
// off-centre inside the launcher mask.
const ART_VIEWBOX = '6.7 11 48.6 48.6';

const MUFFIN = `
  <ellipse cx="32" cy="57" rx="17" ry="2.6" fill="${C.ink}" opacity="0.08"/>
  <path d="M18 34 H46 L42.5 52.5 A3 3 0 0 1 39.6 55 H24.4 A3 3 0 0 1 21.5 52.5 Z"
        fill="${C.crust}" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/>
  <!-- Pleats stop short of the liner's bottom curve. At 48px in the app the
       original lengths (53 / 54.5) were invisible; at 1024px the centre pleat
       visibly pierced the cup outline. Kept in step with logo.tsx. -->
  <path d="M27 35.5 26 50 M32 35.5 V51.5 M37 35.5 38 50"
        stroke="${C.pleat}" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <path d="M15.5 35 C13 22 21 13.5 32 13.5 C43 13.5 51 22 48.5 35
           C46 33.5 43 34.5 41 36 C37.5 33.8 26.5 33.8 23 36 C21 34.5 18 33.5 15.5 35 Z"
        fill="${C.butter500}" stroke="${C.ink}" stroke-width="2.4" stroke-linejoin="round"/>
  <circle cx="24" cy="26" r="3.1" fill="${C.blueberry500}" stroke="${C.ink}" stroke-width="1.6"/>
  <circle cx="32.5" cy="22" r="3.4" fill="${C.blueberry400}" stroke="${C.ink}" stroke-width="1.6"/>
  <circle cx="41" cy="27" r="3.1" fill="${C.blueberry500}" stroke="${C.ink}" stroke-width="1.6"/>
  <circle cx="23" cy="25" r="0.8" fill="#FFFFFF" opacity="0.7"/>
  <circle cx="31.4" cy="20.9" r="0.9" fill="#FFFFFF" opacity="0.7"/>
  <circle cx="40" cy="26" r="0.8" fill="#FFFFFF" opacity="0.7"/>
  <path d="M37 16 C40 11 46 11 48 13 C46 18 40 18 37 16 Z"
        fill="${C.leaf500}" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/>
`;

// Android's themed-icon layer is tinted by the system and only the ALPHA
// channel is used — so it must be one solid silhouette, not the coloured mark.
// Strokes are painted too, so the outline fuses the shapes into one blob
// instead of leaving the berries floating.
const MUFFIN_MONO = `
  <g fill="#000" stroke="#000" stroke-width="2.4" stroke-linejoin="round">
    <path d="M18 34 H46 L42.5 52.5 A3 3 0 0 1 39.6 55 H24.4 A3 3 0 0 1 21.5 52.5 Z"/>
    <path d="M15.5 35 C13 22 21 13.5 32 13.5 C43 13.5 51 22 48.5 35
             C46 33.5 43 34.5 41 36 C37.5 33.8 26.5 33.8 23 36 C21 34.5 18 33.5 15.5 35 Z"/>
    <circle cx="24" cy="26" r="3.1"/>
    <circle cx="32.5" cy="22" r="3.4"/>
    <circle cx="41" cy="27" r="3.1"/>
    <path d="M37 16 C40 11 46 11 48 13 C46 18 40 18 37 16 Z"/>
  </g>
`;

/**
 * One icon. `scale` is the fraction of the canvas the artwork occupies:
 * Android's adaptive icon keeps only the inner 66/108 (~61%) of the drawable
 * once a launcher mask is applied, so anything larger gets its edges cropped.
 */
function page({ size, art, scale, background }) {
  const box = Math.round(size * scale);
  const offset = Math.round((size - box) / 2);
  return `<!doctype html><html><body style="margin:0">
    <div style="width:${size}px;height:${size}px;position:relative;
                ${background ? `background:${background};` : ''}">
      <svg width="${box}" height="${box}" viewBox="${ART_VIEWBOX}" fill="none"
           style="position:absolute;left:${offset}px;top:${offset}px">${art}</svg>
    </div>
  </body></html>`;
}

const OUTPUTS = [
  // Android adaptive icon: transparent foreground over a flat brand background
  // (`android.adaptiveIcon.backgroundColor` in app.json — no background PNG).
  { file: 'android-icon-foreground.png', size: 1024, art: MUFFIN, scale: 0.6 },
  { file: 'android-icon-monochrome.png', size: 1024, art: MUFFIN_MONO, scale: 0.6 },
  // iOS + web: opaque, masked to a squircle by the OS, so it keeps a margin.
  { file: 'icon.png', size: 1024, art: MUFFIN, scale: 0.66, background: C.frosting700 },
  { file: 'favicon.png', size: 96, art: MUFFIN, scale: 0.78, background: C.frosting700 },
  // Splash: transparent so the one asset works on the light AND dark splash
  // backgrounds app.json declares. Sized there via `imageWidth`.
  { file: 'splash-icon.png', size: 512, art: MUFFIN, scale: 1 },
];

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
try {
  const tab = await browser.newPage();
  for (const out of OUTPUTS) {
    await tab.setViewport({ width: out.size, height: out.size, deviceScaleFactor: 1 });
    await tab.setContent(page(out), { waitUntil: 'load' });
    const png = await tab.screenshot({ omitBackground: !out.background, type: 'png' });
    writeFileSync(join(IMAGES, out.file), png);
    console.log(`  wrote ${out.file.padEnd(30)} ${out.size}x${out.size}  ${png.length} bytes`);
  }
} finally {
  await browser.close();
}
console.log('\nIcons regenerated. Run `npx expo prebuild -p android --clean` to rebuild the mipmaps.');
