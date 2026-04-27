// Runs in ISOLATED world at document_start. Its sole job is to inject
// youtube-hook.js as a plain synchronous <script> into the page (MAIN world)
// BEFORE any YouTube bundle runs. This bypasses WXT's async IIFE wrapper
// (WXT #357) that otherwise makes manifest-declared MAIN-world content
// scripts run too late to monkey-patch window.fetch.

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*', 'https://www.youtube.com/shorts/*'],
  runAt: 'document_start',
  main() {
    try {
      // Cast: WXT's PublicPath type is generated from public/ and known
      // entries only; the unlisted script output path is not in that union.
      const url = browser.runtime.getURL(
        '/youtube-hook.js' as unknown as never,
      );
      const script = document.createElement('script');
      script.src = url;
      script.async = false; // critical: preserve execution order
      const parent = document.head || document.documentElement;
      if (parent) {
        parent.prepend(script);
      }
      // Remove the tag; the script keeps running after removal.
      script.addEventListener('load', () => script.remove());
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[LST] failed to inject page-world hook', error);
    }
  },
});
