/**
 * supabase-shim.js — Silently intercept & stub Supabase REST/Auth calls
 *
 * The compiled game bundle still makes fetch() calls to the original
 * penfight.xyz Supabase project for leaderboards, matchmaking queue,
 * solo career sync, attendance, and anonymous auth.  On a cloned
 * deployment those calls all fail (401/403/CORS) and produce noisy
 * console errors + trigger Turnstile captcha flows that can never
 * succeed.
 *
 * This shim wraps window.fetch BEFORE the bundle loads.  Any request
 * whose URL contains the original Supabase host is short-circuited
 * with a graceful empty JSON response so the bundle's error-handling
 * paths treat them as "offline / unavailable" rather than throwing.
 *
 * Load this script FIRST in <head>, before the Vite bundle.
 */
(function () {
  'use strict';

  const BLOCKED_HOST = 'lqdkycjrvrkpwwkiccll.supabase.co';
  const originalFetch = window.fetch;

  window.fetch = function shimmedFetch(input, init) {
    let url = '';
    try {
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input instanceof Request) {
        url = input.url;
      }
    } catch (_) { /* fall through to real fetch */ }

    if (url && url.includes(BLOCKED_HOST)) {
      // Determine a sensible stub response based on the endpoint
      const isAuth = url.includes('/auth/');
      const status = isAuth ? 401 : 200;
      const body = isAuth
        ? JSON.stringify({ error: 'unauthorized', message: 'Supabase auth disabled on clone' })
        : JSON.stringify(null);

      return Promise.resolve(
        new Response(body, {
          status: status,
          statusText: isAuth ? 'Unauthorized' : 'OK',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }

    // Everything else passes through to real fetch
    return originalFetch.apply(this, arguments);
  };
})();
