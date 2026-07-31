---
title: '无追踪流量统计实战：Cloudflare Web Analytics 与自建 Umami'
description: '不用 Google Analytics，用 Cloudflare Web Analytics 和自建 Umami 获得不收集隐私、不触发 Cookie 弹窗的访问统计。'
pubDate: '2026-08-04'
heroImage: '../../assets/blog-placeholder-4.jpg'
---

## 为什么换掉 Google Analytics

个人博客想看访问量，默认答案往往是 Google Analytics（GA）。但用了一段时间后，我决定把它撤掉，原因有三个：

- **隐私合规压力**：GA 默认收集 IP、设备指纹、跨站行为，并向客户端写入 Cookie。在 GDPR、个保法等框架下，这意味着你 legally 需要向访客展示「本网站使用 Cookie」的同意弹窗，还要维护一份隐私政策。对一个静态博客来说，这完全是自找麻烦。
- **Cookie 弹窗伤害体验**：读者打开一篇技术文章，先被一个占屏三分之一的横幅拦住——这和博客「内容优先」的气质背道而驰。
- **加载开销不小**：GA 的 `gtag.js` 加上后续的数据上报，会让 Lighthouse 的 Performance 分数掉好几分。而 Astro 静态站本来引以为傲的就是「零 JS 运行时」，为了一个统计脚本破功很不值。

替代方案的思路是：**只收集聚合的匿名数据，不碰 Cookie，不做跨站追踪**。这样既不触发 Cookie 同意要求，也对读者更诚实。本文介绍两个我实际用过的方案：零维护的 Cloudflare Web Analytics，和数据完全自有的自建 Umami。

> 两个方案可以同时启用，也可以只用一个。本博客（Astro）已经内置了接入代码，只需要填入配置即可，下文会讲到。

## 方案一：Cloudflare Web Analytics

如果你的站点已经托管在 Cloudflare（或者域名 DNS 在 Cloudflare），这是成本最低的方案：免费、无 Cookie、服务端在边缘节点统计，几乎零维护。

### 开启步骤

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)，在左侧导航找到 **Analytics & Logs → Web Analytics**（旧版界面直接叫 Web Analytics）。
2. 点击 **Add a site**，输入你的站点主机名（如 `blog.example.com`）。
3. 如果域名没有接入 Cloudflare 代理，页面会提示你复制一段 JS beacon 代码——关键是里面的 **token**（一串 32 位十六进制字符串）。
4. 如果域名已在 Cloudflare 托管，也可以直接在站点下开启自动注入，但手动拿 token 的方式对任何托管平台都通用。

### 本博客的接入方式

本博客已经在 `src/consts.ts` 里预留了配置项：

```typescript
// 无追踪流量统计（留空则不注入任何脚本，二者可独立启用）
export const ANALYTICS = {
	cloudflareToken: '',
	umamiScriptUrl: '',
	umamiWebsiteId: '',
};
```

把拿到的 token 填进 `cloudflareToken` 即可。注入逻辑在 `src/components/BaseHead.astro` 中，是**条件渲染**——留空就不会输出任何脚本：

```astro
{
	ANALYTICS.cloudflareToken && (
		<script
			defer
			src="https://static.cloudflareinsights.com/beacon.min.js"
			data-cf-beacon={JSON.stringify({ token: ANALYTICS.cloudflareToken })}
		/>
	)
}
```

`defer` 保证脚本不阻塞首屏渲染；`BaseHead` 被所有页面共用，所以填一次全站生效，不需要逐页修改。

## 方案二：自建 Umami

如果你想要更完整的功能（实时访客、事件追踪、UTM 分析、自定义报表），或者不想把数据交给任何第三方，可以自建 [Umami](https://umami.is/)——一个开源（MIT）、专注隐私的统计工具。它不写 Cookie、匿名化 IP，同样不需要弹窗。

### docker-compose 部署

Umami 官方提供了镜像，配合 PostgreSQL 一个 compose 文件就能跑起来：

```yaml
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://umami:umami@db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: replace-me-with-a-random-string
    depends_on:
      db:
        condition: service_healthy
    restart: always

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: umami
    volumes:
      - umami-db-data:/var/lib/postgresql/data
    restart: always
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  umami-db-data:
```

启动：

```bash
docker compose up -d
docker compose logs -f umami   # 确认数据库迁移完成、服务监听 3000
```

> 注意：`APP_SECRET` 一定要换成随机长字符串（`openssl rand -hex 32`），生产环境的 `POSTGRES_PASSWORD` 也不要用示例里的弱口令。

### Nginx 反代 + TLS

不建议把 3000 端口直接暴露到公网，用 Nginx 反代并挂上 Let's Encrypt 证书：

```nginx
server {
    listen 443 ssl;
    server_name stats.example.com;

    ssl_certificate     /etc/letsencrypt/live/stats.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stats.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

证书用 `certbot --nginx -d stats.example.com` 一条命令签发即可。若服务器在 Cloudflare 后面，也可以用 Origin Certificate。

### 创建网站，拿 website-id

1. 浏览器打开 `https://stats.example.com`，用默认账号 `admin` / `umami` 登录，**第一时间改密码**。
2. 进入 **设置 → 网站 → 添加网站**，填名称和域名（域名只是标识，不影响统计范围）。
3. 在网站的 **Tracking code** 标签页，能看到自动生成的脚本，形如：

```html
<script defer src="https://stats.example.com/script.js" data-website-id="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></script>
```

把 `src` 和 `data-website-id` 分别填入 `src/consts.ts`：

```typescript
export const ANALYTICS = {
	cloudflareToken: '',
	umamiScriptUrl: 'https://stats.example.com/script.js',
	umamiWebsiteId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
};
```

`BaseHead.astro` 里对应的条件注入如下，两个字段都非空才输出脚本：

```astro
{
	ANALYTICS.umamiScriptUrl && ANALYTICS.umamiWebsiteId && (
		<script defer src={ANALYTICS.umamiScriptUrl} data-website-id={ANALYTICS.umamiWebsiteId} />
	)
}
```

## 两个方案对比

| 维度 | Cloudflare Web Analytics | 自建 Umami |
| --- | --- | --- |
| 部署成本 | 零，dashboard 点几下 | 一台 VPS + Docker + 证书维护 |
| 数据归属 | Cloudflare（仅聚合数据） | 完全自有，存在自己的 Postgres |
| 功能 | 访问量、来源、页面、设备等基础指标 | 实时访客、事件追踪、UTM、漏斗、多站点 |
| 脚本体积 | beacon.min.js，约几 KB | script.js，约 2 KB |
| 隐私合规 | 无 Cookie，不收集个人数据 | 无 Cookie，IP 匿名化，可完全自控 |
| 适用人群 | 只想看个大概流量、不想运维 | 想要完整功能、愿意自己运维一台小机器 |

我的建议是：纯展示型博客用 Cloudflare 就够了；如果你还运营多个站点、想看事件级数据，再上 Umami。两者字段独立，同时填也不冲突。

## 验证

配置生效与否，不要靠猜，部署后按下面几步确认。

### 确认脚本已注入

重新构建部署后，打开博客任意页面，DevTools → **Elements** 面板搜索 `beacon` 或 `script.js`，应该能在 `<head>` 里看到对应的 `<script defer ...>` 标签。也可以直接 `curl`：

```bash
curl -s https://blog.example.com/ | grep -E 'beacon|website-id'
```

如果什么都没匹配到，先检查 `src/consts.ts` 里的字段是否真的非空——条件注入意味着空字符串会被静默跳过，这是最常见的坑。

### 确认数据上报

- **Cloudflare**：DevTools → **Network** 面板刷新页面，过滤 `cloudflareinsights.com`，应看到对 `beacon.min.js` 的请求和后续上报。Dashboard 的 Web Analytics 面板通常几分钟内出数据，最长可能有小时级延迟，别急着判定失败。
- **Umami**：Network 面板过滤你的统计域名，应看到对 `/api/send` 的 POST 请求返回 200。然后登录 Umami 面板，切到 **实时（Realtime）** 视图，自己访问一下博客，几秒内就能看到这次访问。

### 常见坑

- **AdBlock 拦截**：uBlock Origin 等插件默认拦截 Umami 和 Cloudflare beacon。自己测试时记得先关掉拦截器，否则永远看不到请求——这也意味着你的真实统计会系统性偏低 10%–30%，要有心理预期。
- **CSP 拦脚本**：如果站点配置了 Content-Security-Policy，记得把 `static.cloudflareinsights.com` 和你的 Umami 域名加进 `script-src`，上报接口加进 `connect-src`。
- **Umami 里看不到自己**：Umami 面板登录后默认不统计管理员自己的访问行为之外，早期版本还依赖 `data-domains` 等属性；如果脚本注入了但没数据，优先看 `/api/send` 的响应内容，而不是面板。
- **docker-compose 版本**：`depends_on` 的 `condition: service_healthy` 需要较新的 Compose 插件，老版本 `docker-compose` 1.x 会报错，升级或用 `docker compose`（V2）命令。

至此，你的博客就有了一套不写 Cookie、不弹窗、读者友好的访问统计。数据够了就看，不看也不欠谁——这才是个人网站该有的样子。
