---
title: '从零开始玩转 Ubuntu ⑤：用 Nginx 部署你的第一个网站'
description: '装完系统干点实事：安装 Nginx、写第一个网页、配置站点目录、放行防火墙，十分钟让局域网里的浏览器访问到你的页面。'
pubDate: '2026-08-13'
heroImage: '../../assets/blog-placeholder-5.jpg'
tags: ['从零开始玩转Ubuntu', 'Ubuntu', 'Nginx', '建站']
---

前面三篇把地基打好了：系统装上了、命令会用了、能远程登录了。这篇做一件有正反馈的事——**在服务器上跑一个网站**，让同一网络下的任何设备都能用浏览器访问它。

Web 服务器软件选 **Nginx**：全球占有率第一的 Web 服务器，配置简单，性能强悍，以后做反向代理、挂 HTTPS 都要靠它。

## 第一步：安装并启动 Nginx

SSH 登录服务器，三条命令：

```bash
sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

`enable --now` 的意思是「设为开机自启，并且现在就启动」。验证：

```bash
systemctl status nginx
```

看到绿色的 `active (running)` 就成功了。Nginx 默认监听 80 端口。

## 第二步：从浏览器访问

在服务器上查一下 IP（`ip a`，比如 `192.168.1.100`），然后在你自己电脑的浏览器输入：

```
http://192.168.1.100
```

看到 **Welcome to nginx!** 的页面，说明 Web 服务已经通了。这个默认页面的文件在 `/var/www/html/index.nginx-debian.html`。

如果打不开，大概率是防火墙挡着。Ubuntu 用 `ufw` 管防火墙：

```bash
sudo ufw status                  # 看防火墙是否启用
sudo ufw allow 'Nginx Full'      # 放行 80 和 443 端口
sudo ufw allow 'OpenSSH'         # 顺手确认 SSH 是放行的，否则下次开防火墙会锁死自己
```

> ⚠️ 如果你打算启用 ufw（`sudo ufw enable`），**必须先放行 OpenSSH**，否则启用瞬间你的 SSH 会话就断了，再也连不上。

## 第三步：换成自己的页面

默认页面太没意思，建一个自己的站点目录：

```bash
# 建目录
sudo mkdir -p /var/www/mysite

# 把目录所有者改成自己，以后编辑不用 sudo
sudo chown -R $USER:$USER /var/www/mysite
```

写一个简单的首页：

```bash
nano /var/www/mysite/index.html
```

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>我的第一台服务器</title>
</head>
<body>
    <h1>Hello from Ubuntu Server!</h1>
    <p>这个页面跑在我自己的 Ubuntu 服务器上。</p>
</body>
</html>
```

## 第四步：让 Nginx 指向新站点

Nginx 的站点配置文件在 `/etc/nginx/sites-available/`，通过软链接到 `sites-enabled/` 生效。这个「available / enabled」两段式设计很实用：配置写好了不等于启用，链接过去才生效，下线站点只需删链接。

新建配置：

```bash
sudo nano /etc/nginx/sites-available/mysite
```

写入：

```nginx
server {
    listen 80;
    server_name _;                # 匹配任意主机名

    root /var/www/mysite;         # 站点文件目录
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

启用并生效：

```bash
# 建立软链接，启用站点
sudo ln -s /etc/nginx/sites-available/mysite /etc/nginx/sites-enabled/

# 删掉默认站点（它占着 80 端口的默认 server 位置）
sudo rm /etc/nginx/sites-enabled/default

# 测试配置语法——每次改完配置都先测再 reload，好习惯
sudo nginx -t

# 平滑重载配置，不断连接
sudo systemctl reload nginx
```

`nginx -t` 输出 `syntax is ok` 和 `test is successful` 后，浏览器刷新 `http://192.168.1.100`，看到你的页面就大功告成了。

## 验证一下你都学会了什么

```bash
# 页面文件确实在自己的目录里
ls -l /var/www/mysite/

# Nginx 错误日志在这里，页面打不开时先看它
sudo tail -f /var/log/nginx/error.log

# 访问日志能看到每次请求
sudo tail -f /var/log/nginx/access.log
```

改一下 `index.html` 的内容，刷新浏览器立即生效——静态文件不需要重启任何东西。

## 常见问题

| 现象 | 排查方向 |
| :--- | :--- |
| 浏览器超时 | 防火墙没放行；或不在同一内网，IP 不通，先 `ping` 测 |
| 403 Forbidden | 目录权限问题，`/var/www/mysite` 要对 Nginx 的 www-data 用户可读 |
| 404 Not Found | `root` 路径写错，或文件名不是 `index.html` |
| 改配置后 502/起不来 | 配置语法错误，`sudo nginx -t` 会指出第几行 |

## 这只是开始

一个静态页面跑通了，但这台服务器能干的事远不止这些：

- 想上**博客**？把 Astro / Hugo 生成的静态文件丢进 `/var/www/mysite` 就行（本站就是这么做的）。
- 想跑 **后端服务**？Nginx 反向代理到本机 3000、8000 端口，一行 `proxy_pass` 的事。
- 想挂 **HTTPS**？装个 certbot，`sudo certbot --nginx` 自动申请证书改好配置。

这些后面遇到都会展开讲。下一篇收尾这个系列：服务器跑起来之后怎么照看它——查日志、管服务、看资源、定时任务，日常运维四件套。
