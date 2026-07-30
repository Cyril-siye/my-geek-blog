import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
// https://astro.build/config
export default defineConfig({
site: 'https://blog.cyrilapp.cn', // 换成你的博客实际最终访问域名
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