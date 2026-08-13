---
title: '从零开始玩转 Ubuntu ④：SSH 远程登录与密钥认证'
description: '服务器不用接显示器：开启 SSH 服务、从 Windows/macOS/Linux 远程连接、配置密钥登录取代密码，以及 scp 传文件的完整入门。'
pubDate: '2026-08-12'
heroImage: '../../assets/blog-placeholder-4.jpg'
tags: ['从零开始玩转Ubuntu', 'Ubuntu', 'SSH', '服务器']
---

服务器装好系统后，正常状态是塞进角落、不接显示器键盘，所有操作都通过网络远程完成。实现这件事的协议叫 **SSH**（Secure Shell）——加密的远程终端，也是你今后和服务器打交道的主要方式。

这篇走完「能连上 → 连得安全 → 连得方便」三步。

## 第一步：确认服务端就绪

安装系统时勾选了 OpenSSH Server 的话，服务已经在跑了。在服务器本机确认：

```bash
# 没装的话先装
sudo apt update && sudo apt install -y openssh-server

# 查看服务状态，应该是 active (running)
systemctl status ssh

# 确认在监听 22 端口
sudo ss -tlnp | grep :22
```

再查一下服务器的内网 IP：

```bash
ip a
# 找到 inet 开头的那行，比如 192.168.1.100
```

## 第二步：从你的电脑连上去

**Windows**：Win10 1809 之后的系统自带 SSH 客户端，打开 PowerShell 或 Windows Terminal 直接用。老系统可以装 PuTTY 或 Tabby。

**macOS / Linux**：终端里自带。

连接命令都一样：

```bash
ssh cyril@192.168.1.100
# 格式：ssh 用户名@服务器IP
```

第一次连接会提示确认服务器指纹：

```
The authenticity of host '192.168.1.100' can't be established.
ED25519 key fingerprint is SHA256:xxxx...
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

输入 `yes` 回车，然后输密码（输入时屏幕不显示任何字符，这是正常的，不是卡住了）。看到欢迎信息和服务器的命令行提示符，就登录成功了——现在你敲的每条命令都是在服务器上执行。

## 第三步：改用密钥登录，告别密码

密码登录有两个问题：每次输密码麻烦；密码可能被暴力破解（服务器一旦暴露公网，扫描器分分钟找上门）。**密钥认证**是标准解法：一对密钥，私钥留在你的电脑上，公钥放到服务器上，配对成功即登录。

**1. 在你的电脑上生成密钥对**（不是服务器上）：

```bash
ssh-keygen -t ed25519 -C "my-laptop"
```

一路回车即可（密钥会存到 `~/.ssh/id_ed25519` 和 `~/.ssh/id_ed25519.pub`）。ed25519 是目前推荐的算法，比老的 RSA 更短更快更安全。

**2. 把公钥送上服务器**：

```bash
# Linux / macOS 一条命令搞定
ssh-copy-id cyril@192.168.1.100

# Windows 没有 ssh-copy-id，用这条等价命令（PowerShell）
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh cyril@192.168.1.100 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**3. 验证**：再 `ssh cyril@192.168.1.100`，不输密码直接进去了，说明密钥认证生效。

**4. 确认生效后，关掉密码登录**（在服务器上操作）：

```bash
sudo nano /etc/ssh/sshd_config
```

找到并修改这两行（行首有 `#` 就去掉）：

```
PasswordAuthentication no
PubkeyAuthentication yes
```

保存后重启服务：

```bash
sudo systemctl restart ssh
```

> ⚠️ **顺序很重要**：先确认密钥能登录，再关密码登录。反过来的话密钥没配好就把自己锁在门外了。改配置时保留当前已登录的会话别断，新开一个终端测试，确认没问题再退出旧会话。

## 顺手再做两件事

**起个别名，少打字**。在你电脑的 `~/.ssh/config` 里加：

```
Host myserver
    HostName 192.168.1.100
    User cyril
```

以后直接 `ssh myserver` 就能连。

**传文件用 scp / sftp**：

```bash
# 从本地上传到服务器
scp ./index.html myserver:/home/cyril/

# 从服务器下载到本地
scp myserver:/var/log/nginx/access.log ./

# 传整个目录加 -r
scp -r ./site/ myserver:/var/www/
```

图形化用户也可以用 WinSCP（Windows）或 FileZilla（跨平台），协议选 SFTP，本质都是走 SSH 通道。

## 如果连公网：必须看加固篇

以上配置在内网练手完全够用。但如果服务器要暴露到公网（云 VPS 天然就是），只做密钥认证还不够——改默认端口、fail2ban 防爆破、禁用 root 登录这些都得上。我之前写过一篇完整的[《Ubuntu Server 24.04 初始安全加固清单》](/blog/ubuntu-server-hardening/)，公网机器照着做一遍再上线。

## 小结

| 目标 | 做法 |
| :--- | :--- |
| 连上服务器 | `ssh 用户名@IP` |
| 连得安全 | ed25519 密钥 + 关闭密码登录 |
| 连得方便 | `~/.ssh/config` 起别名 |
| 传文件 | `scp` / `sftp` / WinSCP |

会远程登录之后，服务器才算真正「能用」了。下一篇进入实战环节：在这台机器上装 Nginx，让浏览器访问到你部署的第一个网站。
