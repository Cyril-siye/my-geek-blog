---
title: 'Cloudflare 源站保护实战：只允许 CDN 回源，堵住直连攻击'
description: '攻击者扫到源站 IP 就能绕过 Cloudflare 直连攻击，本文用防火墙白名单 + Nginx real-ip + Authenticated Origin Pull 三层手段锁死源站。'
pubDate: '2026-08-02'
heroImage: '../../assets/blog-placeholder-5.jpg'
---

## 源站 IP 是怎么泄露的

很多人以为域名套上 Cloudflare 就高枕无忧：解析出来的全是 CF 的 Anycast IP，DDoS 打在 CF 的清洗中心上，源站岁月静好。但只要攻击者拿到源站的真实 IP，就能绕过 CDN 直连源站——DDoS、端口扫描、漏洞探测全部直击本体，CDN 层的防护瞬间归零。

而源站 IP 的泄露途径远比想象中多：

- **DNS 历史记录**：接入 CF 之前的 A 记录会被各类 DNS 历史数据库永久存档，翻一遍就露底。
- **子域没套 CDN**：`mail`、`ftp`、`direct` 这类"仅 DNS"（灰云）的子域如果指向同一台服务器，解析一下就把源站供出来了。
- **证书透明度日志（CT Log）**：你签过的每张证书都在公共日志里，任何人都能枚举出你所有的域名和子域，再逐个解析试探。

就算以上记录都干干净净，攻击者还会对云厂商的 IP 段做全网扫描，顶着各种 Host 头挨个试探 443——只要源站对公网开放，被动暴露只是时间问题。

对应的防御思路是三层叠加，一层漏了还有下一层：

| 层级 | 手段 | 解决什么问题 |
| --- | --- | --- |
| 第一层 | 防火墙白名单 | 只放行 CF 官方 IP 段访问 80/443，其余来源直接丢弃 |
| 第二层 | Nginx real-ip | 还原真实访客 IP，日志和限流不再被 CF 节点 IP 污染 |
| 第三层 | Authenticated Origin Pull | mTLS 双向认证，非 CF 回源连 TLS 握手都过不了 |

以下操作基于 Ubuntu 24.04 + Nginx，全程 root 或 sudo 执行。

## 第一层：防火墙只放行 Cloudflare 官方 IP 段

Cloudflare 在 `cloudflare.com/ips` 页面公布了全部回源 IP 段，并提供两个纯文本接口方便脚本拉取：`https://www.cloudflare.com/ips-v4` 和 `https://www.cloudflare.com/ips-v6`，每行一个 CIDR。

思路很直接：只允许这些段访问 80/443，其余入站流量默认拒绝。用系统自带的 UFW 就够：

```bash
# 先放行 SSH，再设默认策略，顺序不能反
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 逐段放行 Cloudflare IPv4 回源段
for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4); do
  sudo ufw allow from "$ip" to any port 80,443 proto tcp comment 'Cloudflare'
done

# IPv6 段同样处理
for ip in $(curl -fsSL https://www.cloudflare.com/ips-v6); do
  sudo ufw allow from "$ip" to any port 80,443 proto tcp comment 'Cloudflare'
done

sudo ufw enable
sudo ufw status numbered
```

> **注意**：先放 SSH 再 `ufw enable`，反了会把自己锁在门外。云主机还要确认厂商安全组与 UFW 规则不冲突。

CF 偶尔会调整 IP 段，把同步逻辑写成脚本交给 cron 定期跑（UFW 对已存在的规则会跳过，直接重放即可）：

```bash
#!/usr/bin/env bash
# /usr/local/sbin/cf-ufw-sync.sh
set -euo pipefail
for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6); do
  ufw allow from "$ip" to any port 80,443 proto tcp comment 'Cloudflare' >/dev/null
done
```

crontab 里加一行 `17 3 * * 1 /usr/local/sbin/cf-ufw-sync.sh`，每周同步一次。

> **提醒**：这个脚本只增不删。CF 若下线某段 IP，旧规则仍然残留，每隔几个月用 `ufw status numbered` 审计清理一次。

顺带一提，`default deny incoming` 还有个附带收益：除了显式放行的 22、80、443，服务器上其余端口（数据库、Redis、各种调试端口）也一并被收拢，等于顺手做了一次攻击面清理。如果某个服务确实需要对公网开放，单独加规则即可，不要把默认策略改回去。

## 第二层：Nginx 还原真实访客 IP

锁了防火墙之后，所有到达源站的流量都来自 CF 节点，副作用立刻显现：Nginx 看到的 `$remote_addr` 全是 CF 的 IP。access log 失去意义，`limit_req` 之类的限流会把同一节点上的所有访客当成一个人，要么误伤要么失效。

解法是 ngx_http_realip_module（Ubuntu 的 nginx 包默认已编译）：声明信任 CF 的 IP 段，从 `CF-Connecting-IP` 请求头取真实访客 IP。Cloudflare 官方文档推荐的做法是生成一份独立配置文件。Ubuntu 的 nginx 默认在 http 块里 include 了 `/etc/nginx/conf.d/*.conf`，放这里即可：

```bash
#!/usr/bin/env bash
# 生成 Cloudflare real-ip 配置
CONF=/etc/nginx/conf.d/cloudflare-realip.conf
{
  echo '# Cloudflare IP ranges'
  for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo 'real_ip_header CF-Connecting-IP;'
} | sudo tee "$CONF"

sudo nginx -t && sudo systemctl reload nginx
```

生成的文件形如：

```nginx
# Cloudflare IP ranges
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ... 其余 IPv4 段省略 ...
set_real_ip_from 2400:cb00::/32;
# ... 其余 IPv6 段省略 ...
real_ip_header CF-Connecting-IP;
```

生效后 `$remote_addr` 就是访客真实 IP，默认的 combined 日志格式直接受益；原来的 CF 节点 IP 仍可从 `$realip_remote_addr` 取到。IP 段更新可以复用第一层的 cron 思路，改完记得 `nginx -t` 再 reload。

为什么不用更常见的 `X-Forwarded-For`？CF 回源时确实也带它，但 realip 模块只信任 `set_real_ip_from` 列出的代理地址，配合 `CF-Connecting-IP` 这个 CF 专用头，伪造门槛更高；而且 `$remote_addr` 被真正改写，日志、限流、allow/deny 等所有依赖客户端 IP 的模块零改动全部生效。

> **警告**：`set_real_ip_from` 必须列全 CF 的段。漏掉的节点不会被信任，其伪造的 `CF-Connecting-IP` 头也不会被采用——好在第一层防火墙已把非 CF 来源挡死，等于双保险。

## 第三层：Authenticated Origin Pull（mTLS 双向认证）

防火墙白名单有个理论缺口：任何人都能把流量"借道" CF 的 IP 段到达你的源站——比如攻击者自己也在 CF 上挂个站，把回源地址填成你的源站 IP。Authenticated Origin Pull（AOP）堵的就是这一口。原理一句话：**回源时 Cloudflare 会出示由 CF 专用 CA 签发的客户端证书，Nginx 验证不过就直接拒绝握手**，TLS 层都过不去，HTTP 请求根本到不了应用。

配置分四步：

1. 下载 CF 官方的 Origin Pull CA 证书：

```bash
sudo mkdir -p /etc/nginx/certs
sudo curl -fsSL -o /etc/nginx/certs/origin-pull-ca.pem \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
```

2. 在站点的 server 块里加两行：

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    # ... 原有 ssl_certificate 等配置保持不变 ...

    # Authenticated Origin Pull
    ssl_client_certificate /etc/nginx/certs/origin-pull-ca.pem;
    ssl_verify_client on;
}
```

3. 校验并重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

4. 最后到 Cloudflare 后台 **SSL/TLS → Origin Server**，打开 **Authenticated Origin Pulls** 开关。

> **顺序很重要**：必须先配好 Nginx 再开后台开关。反过来做，CF 回源握手失败，全站立刻 5xx。

AOP 只能保护 443——80 端口没有 TLS，谈不上客户端证书。所以 80 的安全完全交给第一层防火墙，这也是为什么三层必须叠着用。

## 验证

三层配完，从外部机器逐项验证（把 `203.0.113.10` 换成你的源站 IP）：

```bash
# 1. 直连源站 IP 的 80/443：应当超时
curl -m 5 -I http://203.0.113.10

# 2. 绕过 DNS 强制连源站（模拟攻击者）：应当 TLS 握手失败
curl -m 5 -vk --resolve example.com:443:203.0.113.10 https://example.com

# 3. 正常经域名访问：应当返回 200
curl -I https://example.com
```

预期结果：第 1 条应当输出 `curl: (28) Connection timed out`，防火墙把包直接丢弃，源站对外界等于不存在。第 2 条里 `--resolve` 跳过 DNS 直接连源站，最接近真实攻击手法：防火墙生效时同样超时；即使临时放开防火墙，没有 CF 的客户端证书也过不了 mTLS，握手阶段就被 TLS alert 打断（报 `certificate required` 或 `handshake failure`），连一个 HTTP 状态码都拿不到。第 3 条经域名走完整链路，应当返回 `HTTP/2 200`。

最后确认 access log 里 `$remote_addr` 显示的是访客真实 IP，而不是 `162.158.x.x` 之类的 CF 节点：

```bash
sudo tail -f /var/log/nginx/access.log
```

## 常见坑

- **锁源前没确认 DNS 已全量代理**：只要还有灰云记录指向这台源站，防火墙一锁该服务立刻失联。先把需要代理的记录全部点亮橙色云；必须直连的服务（如邮件）拆到别的机器或别的 IP。
- **健康检查和监控探针被误杀**：UptimeRobot、Prometheus blackbox 之类的探针改走域名；确实需要直连源站的，把探针出口 IP 单独加白。
- **IPv6 段漏了**：服务器有公网 IPv6 时，只放 ips-v4 等于留了两扇后门——CF 的 IPv6 回源段没放会导致回源失败，而攻击者却能从 IPv6 直连。确认 `/etc/default/ufw` 里 `IPV6=yes`，ips-v6 的段一段不落。
- **HTTP/3 被顺手掐掉**：上面的规则只放行 TCP，而 HTTP/3 (QUIC) 走 UDP 443。被拦后浏览器会自动回退 TCP，功能不坏但性能吃亏；想保留就按段批量补一条 `sudo ufw allow from <段> to any port 443 proto udp`。
- **IP 段长期不同步**：CF 新增段而本地没放行时，新节点回源被防火墙丢弃，会出现间歇性的 522 错误，极难排查。cron 同步不是可选项。

三层叠完，源站从"戴面具裸奔"变成"只认 CF 证书、只见 CF 流量"。扫描器和 DDoS 再想绕过 CDN 直连，连门都摸不到。
