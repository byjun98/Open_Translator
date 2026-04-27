import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import App from './App.tsx';
import './style.css';

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*', 'https://www.youtube.com/shorts/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'Open_Translator',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const appContainer = document.createElement('div');
        appContainer.id = 'Open_Translator-root';
        container.append(appContainer);

        const root = ReactDOM.createRoot(appContainer);
        root.render(<App />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
