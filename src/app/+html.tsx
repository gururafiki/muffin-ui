import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only root HTML shell used during Expo's static web export. Matches Expo's
 * default template, with one addition: it loads `/runtime-config.js` (served by
 * nginx, written from deployment env — see `deploy/40-runtime-config.sh`) BEFORE
 * the app bundle, so `window.__MUFFIN_CONFIG__` (Supabase URL + anon key) is set
 * when the settings/auth modules initialise. In dev the file 404s harmlessly.
 *
 * Runs in Node during static rendering — no DOM / browser APIs here.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script src="/runtime-config.js" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
