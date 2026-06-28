/**
 * JS-side mirror of the Tailwind palette (tailwind.config.js).
 *
 * NativeWind `className` covers most styling, but some APIs need raw color
 * values (navigation theme, status bar, SVG fills, chart libs). Keep this in
 * sync with tailwind.config.js.
 */
export const palette = {
  // Brand grape ("frosting").
  frosting: {
    50: '#F7F2FB',
    100: '#EEE4F6',
    200: '#DCC9EC',
    300: '#C2A4DC',
    400: '#A47EC6',
    500: '#875DAE',
    600: '#6F4A93',
    700: '#5A3C77',
    800: '#46305C',
    900: '#342346',
  },
  // Deep blueberry berries.
  blueberry: { 300: '#6E63A6', 400: '#524785', 500: '#3C3366', 600: '#2C2550' },
  // Golden baked-good accent.
  butter: { 400: '#F3C06A', 500: '#E9A94D', 600: '#D98E3A' },
  // Mint leaf accent.
  leaf: { 400: '#9BC97C', 500: '#7FB35C', 600: '#5E9440' },
  // Bakery surfaces (light).
  dough: '#FBF3E3',
  crust: '#F3E7D2',
  // Near-black grape — outlines + text on light.
  ink: '#2E2140',
  // Plaid / gingham pattern.
  plaid: { base: '#ECE0F4', line: '#DBC8EC' },
  // "Blueberry night" dark surfaces.
  night: {
    bg: '#241B38',
    surface: '#2E2447',
    surfaceMuted: '#3A2E57',
    border: '#45396A',
    text: '#F4ECDF',
    textMuted: '#B6A6CE',
  },
  // Semantic signals.
  bullish: '#4FA86A',
  bearish: '#E0697F',
  neutral: '#E9A94D',
  white: '#FFFFFF',
  // Back-compat alias (was the old "almost black"); now the grape ink.
  black: '#2E2140',
} as const;

export const theme = {
  light: {
    background: palette.dough,
    surface: palette.white,
    surfaceMuted: palette.crust,
    text: palette.ink,
    textMuted: '#7A6A92',
    primary: palette.frosting[500],
    accent: palette.butter[500],
    border: palette.frosting[200],
  },
  dark: {
    background: palette.night.bg,
    surface: palette.night.surface,
    surfaceMuted: palette.night.surfaceMuted,
    text: palette.night.text,
    textMuted: palette.night.textMuted,
    primary: palette.frosting[300],
    accent: palette.butter[400],
    border: palette.night.border,
  },
} as const;

export type ThemeMode = keyof typeof theme;
