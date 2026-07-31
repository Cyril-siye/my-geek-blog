// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = 'Cyril\'s Geek Blog';
export const SITE_DESCRIPTION = '记录 Linux 系统运维、后端开发与网络技术的个人博客';

// Giscus 评论系统配置（基于 GitHub Discussions）
// 前置条件：1) 仓库开启 Discussions；2) 安装 https://github.com/apps/giscus
// categoryId 在 https://giscus.app/zh-CN 配置后生成，填入即可
export const GISCUS = {
	repo: 'Cyril-siye/my-geek-blog',
	repoId: '1317650552',
	category: 'General',
	categoryId: 'DIC_kwDOTonAeM4DCV_T',
	mapping: 'pathname',
	lang: 'zh-CN',
};

// 无追踪流量统计（留空则不注入任何脚本，二者可独立启用）
// cloudflareToken: Cloudflare Web Analytics 的 beacon token（https://dash.cloudflare.com → Web Analytics）
// umamiScriptUrl / umamiWebsiteId: 自建或云端 Umami 的脚本地址与 website-id
export const ANALYTICS = {
	cloudflareToken: '',
	umamiScriptUrl: '',
	umamiWebsiteId: '',
};
