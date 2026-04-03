import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'UnitMetal Wallet',
    description: 'Super lightweight extension wallet for professionals',
    side_panel: {
      default_path: 'sidepanel.html',
    },
    permissions: ['tabs', 'scripting', 'sidePanel', 'storage'],
  },
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: new URL('./assets/icon.svg', import.meta.url).pathname,
  },
  alias: {
    '@': new URL('.', import.meta.url).pathname,
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
