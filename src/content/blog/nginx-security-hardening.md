---
title: 'Nginx 反向代理安全加固实战：响应头、限流与 TLS'
description: '给面向公网的 Nginx 反代加上安全响应头、请求限流和现代 TLS 配置，附完整可复用配置片段。'
pubDate: '2026-08-01'
heroImage: '../../assets/blog-placeholder-4.jpg'
---

## 默认安装的 Nginx 暴露了什么

在 Ubuntu 24.04 上 `apt install nginx` 之后，一个默认配置的 Nginx 对外透露的信息比你想象的多。直接用 curl 看一眼响应头：

```bash
curl -I http://your-server-ip/
```

你会看到类似这样的输出：

```text
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Date: Sat, 01 Aug 2026 08:00:00 GMT
Content-Type: text/html
```

`Server: nginx/1.24.0 (Ubuntu)` 这一行把精确的版本号和发行版都告诉了扫描器。攻击者拿到版本号后，可以直接去查对应版本的已知 CVE 列表。除此之外，默认配置没有 HSTS、没有点击劫持防护、没有 MIME 嗅探防护，TLS 也可能还兼容着老掉牙的协议。下面我们逐项加固。

## 隐藏版本号

最简单的一步：在 `http` 块里加一行 `server_tokens off`。

```nginx
# /etc/nginx/nginx.conf 的 http 块内
http {
    server_tokens off;
    # ...
}
```

修改后执行 `nginx -t` 校验配置，再 `systemctl reload nginx` 重载，然后重新验证：

```bash
nginx -t && systemctl reload nginx
curl -I http://your-server-ip/
```

现在 `Server` 头只会显示 `nginx`，不再带版本号。

> **提示**：`server_tokens` 只隐藏响应头里的版本号，默认错误页面（如 404 页脚）上的版本信息也会一并去掉。要完全伪装 `Server` 字段需要编译 `headers-more` 模块，一般没必要。

## 安全响应头逐个讲

安全响应头是浏览器层面的防线，成本几乎为零，收益却很实在。逐个来看：

| 响应头 | 作用 | 推荐取值 |
| --- | --- | --- |
| Strict-Transport-Security | 强制浏览器只走 HTTPS | `max-age=63072000; includeSubDomains; preload` |
| X-Frame-Options | 防点击劫持，禁止被 iframe 嵌入 | `DENY` 或 `SAMEORIGIN` |
| X-Content-Type-Options | 禁止 MIME 嗅探 | `nosniff` |
| Referrer-Policy | 控制跳转时泄露的 Referer 信息 | `strict-origin-when-cross-origin` |
| Permissions-Policy | 禁用不需要的浏览器特性（摄像头、麦克风等） | `camera=(), microphone=(), geolocation=()` |
| Content-Security-Policy | 限制页面可加载的资源来源，防 XSS | 按站点实际情况逐级配置 |

对应的 `add_header` 配置块如下，通常放在 `server` 块里：

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# 一个最基础的 CSP：只允许同源资源。实际站点需按需放行。
add_header Content-Security-Policy "default-src 'self'" always;
```

几个要点：

- `always` 参数很关键——不加的话，`add_header` 只在 2xx/3xx 响应上生效，错误页面（4xx/5xx）不会带这些头。
- HSTS 的 `max-age=63072000` 是两年，这是 hstspreload.org 要求的最低值。`preload` 用于提交到浏览器内置的 HSTS 预加载列表。
- CSP 是最容易"误伤"自己的头，先上 `default-src 'self'` 这种最严策略前，务必确认站点没有外部字体、统计脚本、CDN 资源。

> **警告：add_header 的继承陷阱**。这是 Nginx 配置里最常见的坑之一——只要某个子级块（比如某个 `location`）里定义了**任何一条** `add_header`，父级（`http` 或 `server`）定义的**所有** `add_header` 在该子级内全部失效，不是合并，是整体覆盖。所以如果某个 `location` 需要额外的头（比如 CORS 头），必须把父级的安全头原样再写一遍，或者抽出成 include 文件复用。

## limit_req 请求限流

反向代理直接面对公网，登录接口、API 端点被刷是常态。Nginx 内置的 `limit_req` 模块基于漏桶算法，够用且零依赖。

限流分两步：先在 `http` 块定义共享内存区域（状态存储），再在 `server` 或 `location` 块里引用它。

```nginx
# http 块：zone=one 是区域名，10m 是共享内存大小（约可存 16 万个 IP 状态）
# rate=10r/s 表示每个 IP 每秒允许 10 个请求
limit_req_zone $binary_remote_addr zone=one:10m rate=10r/s;
```

```nginx
# server 或 location 块内
limit_req zone=one burst=20 nodelay;
limit_req_status 429;
```

参数解释：

- `$binary_remote_addr`：以客户端 IP 的二进制形式作为计数 key，比字符串形式省内存。
- `burst=20`：允许超出速率的 20 个请求进入队列等待处理，应对突发流量。
- `nodelay`：队列中的请求立即处理，不等待速率窗口。加上它，burst 更像"令牌桶"式的瞬时宽容；不加的话超出的请求会被延迟到符合速率才放行，用户体验上表现为"卡顿"而非拒绝。
- `limit_req_status 429`：超限默认返回 503，改成 429（Too Many Requests）语义更准确，也更友好——503 容易被监控系统误判为后端故障。

注意 `limit_req_zone` 只能放在 `http` 块，写进 `server` 块会报 `nginx: [emerg] "limit_req_zone" directive is not allowed here`。

## TLS 现代配置

2026 年了，TLSv1.0/1.1 早该淘汰。面向公网的服务只保留 TLSv1.2 和 TLSv1.3：

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
```

说明：

- TLSv1.3 的密码套件由协议固定且全部安全，不受 `ssl_ciphers` 控制；上面那串只影响 TLSv1.2，全部是基于 ECDHE 的 AEAD 套件，带前向保密。
- TLSv1.3 下 `ssl_prefer_server_ciphers` 已无意义，设 `off` 即可；TLSv1.2 的现代客户端（浏览器）也都会优先选择安全的套件。
- `ssl_session_cache shared:SSL:10m` 让多个 worker 进程共享会话缓存，10MB 约可存 4 万个会话，能显著减少 TLS 握手开销。
- `ssl_session_tickets off` 关闭会话票据，避免票据密钥长期不变导致前向保密受损。

证书方面，免费方案直接用 Let's Encrypt，Ubuntu 24.04 上通过 certbot 申请并自动续期：

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d example.com -d www.example.com
# 验证自动续期定时器已启用
systemctl list-timers | grep certbot
```

certbot 的 nginx 插件会自动改写你的 server 块，把 443 监听和证书路径配好。

## 屏蔽敏感路径

站点根目录下经常有 `.git`、`.env`、`.htaccess` 这类隐藏文件，一旦被 Nginx 当静态文件吐出去就是事故。统一拒绝所有以点开头的路径：

```nginx
location ~ /\. {
    deny all;
    return 404;
}
```

返回 404 而不是 403，可以让扫描器无法区分"文件不存在"和"文件存在但被拒绝"。如果你的站点确实需要 `.well-known`（比如 certbot 的 HTTP-01 验证或某些服务的域名所有权验证），在前面加一条例外：

```nginx
location ^~ /.well-known/ {
    # 正常处理，不拦截
}
```

`^~` 的优先级高于 `~` 正则匹配，保证 ACME 续期不受影响。

## 完整可复用的 server 块

把上面所有内容组合起来，一份反代到本地 3000 端口应用的完整配置：

```nginx
# /etc/nginx/sites-available/example.com
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name example.com;

    # TLS
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # 安全响应头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # 屏蔽隐藏文件
    location ~ /\. {
        deny all;
        return 404;
    }

    # 反代 + 限流
    location / {
        limit_req zone=one burst=20 nodelay;
        limit_req_status 429;

        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

别忘了 `limit_req_zone` 和 `server_tokens off` 要放在 `/etc/nginx/nginx.conf` 的 `http` 块里。另外注意 Ubuntu 24.04 仓库里的 Nginx 1.24 支持 `http2 on;` 这种新写法；旧版本请改回 `listen 443 ssl http2;`。

## 验证方法

改完配置，逐项验证：

```bash
# 1. 校验语法并重载
nginx -t && systemctl reload nginx

# 2. 检查响应头（应看不到版本号，且安全头齐全）
curl -I https://example.com/

# 3. 检查隐藏文件被拦截（应返回 404）
curl -I https://example.com/.git/config
```

TLS 配置用 SSL Labs 的在线测试跑一遍（浏览器访问 `https://www.ssllabs.com/ssltest/`），目标是 A 或 A+ 评级。

限流效果用压测工具触发，比如 hey（`apt install hey` 或用 Go 安装）：

```bash
# 50 并发共 200 个请求，应看到大量 200 之后出现 429
hey -n 200 -c 50 https://example.com/
```

用 `ab`（apache2-utils 包）也可以：`ab -n 200 -c 50 https://example.com/`。看到一部分请求返回 429，说明限流生效。

## 常见坑

- **HSTS 开了就难回头**。一旦浏览器缓存了 HSTS 策略，在 `max-age` 过期之前都会强制走 HTTPS。如果你还没想好要不要全站 HTTPS，先用小的 `max-age`（如 300 秒）试探，确认无误再加大。提交到 preload 列表后更是按年计算的回退周期，务必确认所有子域名都支持 HTTPS 再加 `includeSubDomains` 和 `preload`。
- **CSP 过严导致页面白屏**。`default-src 'self'` 会把外部字体、统计脚本、图片 CDN 全部拦掉，浏览器控制台会刷满 CSP 报错。正确做法是先用 `Content-Security-Policy-Report-Only` 头试运行一段时间，收集违规报告，再逐级放行（`script-src`、`style-src`、`img-src` 等），最后切换为强制执行。
- **add_header 继承陷阱**，前面已经强调过：子级写了任何 `add_header`，父级的安全头全丢。建议把公共安全头抽成 `/etc/nginx/snippets/security-headers.conf`，需要的块里 `include` 它。
- **限流误伤 NAT 后的用户**。`$binary_remote_addr` 按 IP 计数，公司、校园网出口 IP 后的几百个用户共享一个配额。如果站点有大量此类用户，适当调大 `rate` 和 `burst`，或者改用 `$http_authorization`、API key 等作为计数 key。
- **别忘了 IPv6**。如果服务器有 AAAA 记录，`listen [::]:443 ssl;` 和 `listen [::]:80;` 也要配上，否则 IPv6 用户可能直接访问失败或落到默认站点。

加固不是一次性工作——定期跑一遍 SSL Labs、跟进 Nginx 的安全公告、留意日志里的 4xx/5xx 比例，才能让这道防线长期有效。
