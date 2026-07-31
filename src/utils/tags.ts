import { pinyin } from 'pinyin-pro';

/**
 * 把标签转成 URL 安全的 ASCII slug。
 * - 纯 ASCII 标签：小写化，非字母数字字符转为连字符（如 "GitHub Actions" → "github-actions"）
 * - 含中文的标签：转无声调拼音并用连字符连接（如 "安全加固" → "an-quan-jia-gu"）
 * 仅构建期使用（getStaticPaths / 链接生成），不会进入客户端 bundle。
 */
export function tagSlug(tag: string): string {
	if (/^[\x20-\x7E]+$/.test(tag)) {
		return tag
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
	}
	return pinyin(tag, { toneType: 'none', type: 'array' })
		.join('-')
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/(^-|-$)/g, '');
}
