import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Open_Translator',
    description:
      'Translate YouTube subtitles and webpage text through a local OpenAI-compatible proxy running on your machine.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['http://127.0.0.1/*'],
    web_accessible_resources: [
      {
        resources: ['youtube-hook.js'],
        matches: ['https://www.youtube.com/*'],
      },
    ],
    action: {
      default_title: 'Subtitle Settings',
      default_popup: 'popup.html',
    },
  },
});
