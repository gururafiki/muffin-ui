/**
 * Muffin — kawaii blueberry-bakery design tokens.
 *
 * Warm, dusty palette inspired by purple-plaid blueberry-bakery illustrations:
 * a warm cream "dough" background, a confident grape "frosting" primary, deep
 * "blueberry" berries, "butter" golden accents and green "leaf" mint. Thick
 * "ink" doodle outlines, soft rounded "muffin"/"bun" radii and a cozy
 * "blueberry-night" dark theme.
 *
 * Raw values are mirrored in src/theme/colors.ts for APIs that need plain
 * colors (navigation theme, status bar, SVG fills, charts). Keep them in sync.
 */

const sans = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'];
const mono = [
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  'Liberation Mono',
  'monospace',
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand grape ("frosting") — the hero color.
        frosting: {
          50: '#F7F2FB',
          100: '#EEE4F6',
          200: '#DCC9EC',
          300: '#C2A4DC',
          400: '#A47EC6',
          500: '#875DAE', // primary
          600: '#6F4A93',
          700: '#5A3C77', // deep grape — header/footer bands
          800: '#46305C',
          900: '#342346',
        },
        // Deep blueberry berries — accent.
        blueberry: {
          300: '#6E63A6',
          400: '#524785',
          500: '#3C3366',
          600: '#2C2550',
        },
        // Golden baked-good accent — highlights, cheer, "neutral" signal.
        butter: {
          400: '#F3C06A',
          500: '#E9A94D',
          600: '#D98E3A',
        },
        // Mint leaf accent.
        leaf: {
          400: '#9BC97C',
          500: '#7FB35C',
          600: '#5E9440',
        },
        // Bakery surfaces (light).
        dough: '#FBF3E3', // warm cream app background
        crust: '#F3E7D2', // deeper cream raised surface
        // Grape ink text ramp (light theme): outlines/body → muted → soft
        // (done/disabled) → faint (placeholders, inactive tabs).
        ink: {
          DEFAULT: '#2E2140',
          muted: '#7A6A92',
          soft: '#9A8BB0',
          faint: '#BCA9D2',
        },
        // Subtle plaid / gingham pattern.
        plaid: {
          DEFAULT: '#ECE0F4',
          line: '#DBC8EC',
        },
        // "Blueberry night" dark theme surfaces (warm, not flat black).
        night: {
          bg: '#241B38',
          surface: '#2E2447',
          'surface-muted': '#3A2E57',
          border: '#45396A',
          text: '#F4ECDF', // warm cream
          'text-muted': '#B6A6CE',
        },
        // Semantic signal colors (buy/sell/hold), warmed to fit the palette.
        bullish: '#4FA86A',
        bearish: '#E0697F',
        neutral: '#E9A94D',
      },
      borderRadius: {
        crumb: '12px',
        muffin: '20px',
        bun: '28px',
        pill: '9999px',
      },
      // Weight is baked into each family (custom fonts ignore fontWeight on
      // native). Names match the expo-google-fonts keys loaded in _layout.tsx
      // and the @font-face families expo-font registers on web.
      fontFamily: {
        display: ['Baloo2_800ExtraBold', ...sans], // hero
        title: ['Baloo2_700Bold', ...sans], // page titles
        heading: ['Baloo2_600SemiBold', ...sans], // section headings
        rounded: ['Baloo2_600SemiBold', ...sans],
        body: ['Nunito_400Regular', ...sans], // default body
        semibold: ['Nunito_600SemiBold', ...sans],
        bold: ['Nunito_700Bold', ...sans],
        mono,
      },
      boxShadow: {
        // Soft offset "sticker" shadow (web; native uses style in Card).
        sticker: '0px 4px 0px rgba(46, 33, 64, 0.12)',
      },
    },
  },
  plugins: [],
};
