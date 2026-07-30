import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
// https://astro.build/config
export default defineConfig({
site: 'https://dxj.dpdns.org',
integrations: [mdx(), sitemap()],
markdown: {
shikiConfig: {
theme: 'one-dark-pro', // 代码高亮主题，如 dracula, github-dark 等
wrap: true,
},
},
vite: {
plugins: [tailwindcss()],
},
});