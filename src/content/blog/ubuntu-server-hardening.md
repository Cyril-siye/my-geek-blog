---
title: 'Ubuntu Server 24.04 初始安全加固清单：从裸机到可用'
description: '新装 Ubuntu Server 后必做的安全加固步骤：SSH 密钥登录、禁用 root、UFW 防火墙、fail2ban 与自动安全更新。'
pubDate: '2026-07-31'
tags: ['安全加固', 'Linux', 'SSH']
heroImage: '../../assets/blog-placeholder-2.jpg'
---

## 为什么新装的服务器要先加固

一台刚装好的 Ubuntu Server 24.04，只要公网 IP 一分配，通常在几分钟到几小时内就会迎来第一批「访客」——自动化的扫描机器人。它们遍历整个 IPv4 空间，对 22 端口做密码爆破，对常见弱口令做字典攻击。如果你装完系统就放着不管，用着默认的密码登录加 root 直连，被攻破只是时间问题。

好消息是，初始加固并不复杂。下面这套流程是我每次开新机器都会跑一遍的清单，半小时内就能完成，做完之后裸机才算真正「可用」。

## 第一步：新建 sudo 用户

云服务商初始化机器时通常直接给你 root 密码，或者一个默认用户。长期使用 root 操作既危险又无法审计，先创建一个普通用户并赋予 sudo 权限。

以创建用户 `cyril` 为例：

```bash
adduser cyril
usermod -aG sudo cyril
```

`adduser` 是 Ubuntu 推荐的交互式命令，会引导你设置密码并创建家目录；`usermod -aG sudo` 把用户加入 sudo 组，Ubuntu 24.04 默认配置下 sudo 组成员即可使用 `sudo` 提权。

> **提示**：`-aG` 中的 `a`（append）不能省，否则会把用户从其他组里踢出去，只留在 sudo 组。

切换验证一下：

```bash
su - cyril
sudo whoami
```

输出 `root` 说明 sudo 权限正常。

## 第二步：SSH 加固

SSH 是服务器的大门，也是爆破攻击的头号目标。加固分两块：改用密钥登录，然后收紧 sshd 配置。

### 配置密钥登录

在你**本地电脑**上生成密钥对（如果还没有的话）：

```bash
ssh-keygen -t ed25519 -C "cyril@laptop"
```

然后把公钥推送到服务器的新用户上：

```bash
ssh-copy-id cyril@<服务器IP>
```

`ssh-copy-id` 会把公钥追加到服务器的 `~/.ssh/authorized_keys`，并自动修正 `.ssh` 目录（700）和 `authorized_keys`（600）的权限。确认能用密钥免密登录后，再进行下一步。

### 修改 sshd 配置

编辑 `/etc/ssh/sshd_config`：

```bash
sudo nano /etc/ssh/sshd_config
```

修改或确认以下几项：

```ini
Port 2222
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

- `Port 2222`：换成自定义端口（1024–65535 之间挑一个不常用的），可以挡掉绝大多数针对 22 端口的无脑扫描。这不是安全的核心，但能显著减少日志噪音。
- `PermitRootLogin no`：禁止 root 直接登录。
- `PasswordAuthentication no`：只认密钥，密码爆破从此无效。

改完后**先验证语法，再重载服务**：

```bash
sudo sshd -t
sudo systemctl reload ssh
```

`sshd -t` 没有输出代表配置合法。Ubuntu 24.04 中 SSH 服务名是 `ssh`（ssh.service），用 `reload` 而不是 `restart`，重载不会断开现有连接——这是给自己留后路的关键细节。

> **警告**：在确认新配置能登录之前，**不要关闭当前已连接的终端**。保留这个会话作为回退通道，万一新配置有问题还能改回来。

## 第三步：UFW 防火墙

Ubuntu 自带 UFW（Uncomplicated Firewall），它是 iptables/nftables 的友好封装，默认未启用。策略很简单：默认拒绝所有入站，只放行需要的端口。

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw enable
```

`ufw enable` 会提示可能中断现有连接，确认 `y`。由于我们在上一步已经把 SSH 改到 2222 并在这里放行了它，现有会话不受影响。

检查状态：

```bash
sudo ufw status verbose
```

应该能看到 `Status: active`、默认策略 `deny (incoming)`，以及三条放行规则。

> **顺序很重要**：一定先 `ufw allow` 放行你的 SSH 端口，再 `ufw enable`。反过来的话，你会把自己锁在门外。

## 第四步：fail2ban 防爆破

即使换了端口、禁了密码登录，日志里仍然会有各种探测。fail2ban 通过监控日志，把多次认证失败的 IP 临时拉入防火墙黑名单。

```bash
sudo apt update
sudo apt install fail2ban
```

fail2ban 的主配置文件是 `/etc/fail2ban/jail.conf`，但**不要直接改它**——包升级会覆盖。正确做法是创建 `/etc/fail2ban/jail.local`：

```bash
sudo nano /etc/fail2ban/jail.local
```

写入：

```ini
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = 2222
```

- `bantime`：封禁时长，这里 1 小时。
- `findtime`：统计窗口，10 分钟内的失败次数才累计。
- `maxretry`：窗口内失败 5 次就封。
- `[sshd]` 段的 `port` 要写你自定义的 SSH 端口，否则 fail2ban 封的是默认 22 端口。

重启并验证：

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status sshd
```

输出中能看到 `Currently failed`、`Total banned` 等计数，说明 sshd jail 已生效。Ubuntu 24.04 默认用 systemd journal 作为日志后端，fail2ban 的默认配置可以直接读到 sshd 日志，无需额外指定 `backend`。

## 第五步：unattended-upgrades 自动安全更新

大部分被攻破的服务器不是因为 0day，而是因为已知漏洞迟迟没打补丁。让安全更新自动装上：

```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

第二条命令会弹出一个确认界面，选「是」即可启用。它会生成 `/etc/apt/apt.conf.d/20auto-upgrades`，内容类似：

```ini
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

实际生效的源策略在 `/etc/apt/apt.conf.d/50unattended-upgrades` 中，Ubuntu 24.04 默认只自动应用 security 源的更新，这正是我们想要的——安全补丁自动打，普通更新留给人工窗口。

想验证配置是否生效，可以空跑一次：

```bash
sudo unattended-upgrade --dry-run --debug
```

## 验证清单

全部做完后，对照这张表逐项确认：

| 检查项 | 命令 | 期望结果 |
| --- | --- | --- |
| 新用户可登录且有 sudo | `ssh -p 2222 cyril@IP` 后 `sudo whoami` | 输出 `root` |
| root 直连被拒 | `ssh -p 2222 root@IP` | `Permission denied` |
| 密码登录已禁用 | 登录时观察或使用密钥以外的方式 | 不再提示输入密码 |
| sshd 配置合法 | `sudo sshd -t` | 无输出 |
| UFW 已启用 | `sudo ufw status verbose` | `Status: active`，仅放行 2222/80/443 |
| fail2ban 运行中 | `sudo fail2ban-client status sshd` | 显示 jail 统计信息 |
| 自动更新已启用 | `systemctl status apt-daily-upgrade.timer` | `active (waiting)` |

## 常见坑

- **改端口后把自己锁死**：正确顺序永远是「先在 UFW（和云安全组）放行新端口 → 再改 sshd_config → 重载 ssh → 开新终端验证 → 确认能连后再收紧旧端口」。任何一步顺序错了，都可能需要控制台救援。
- **断开前不测试**：保持至少一个已连接的 root/sudo 会话作为保险丝，新终端确认能登录之前不要退出旧会话。
- **云安全组是另一层防火墙**：AWS Security Group、阿里云/腾讯云安全组在 hypervisor 层面生效，优先级高于 UFW。如果你改了 SSH 端口却发现连不上，先去云控制台检查安全组入站规则——UFW 放行了不代表云平台也放行了。
- **fail2ban 的 port 忘改**：sshd 换端口后 jail 里的 `port` 必须同步，否则封禁规则打在 22 端口上，形同虚设。
- **密钥没备份**：`PasswordAuthentication no` 之后，私钥就是唯一的钥匙。本地私钥丢失且没有备用登录方式时，只能走云服务商的 VNC/救援模式。

到这一步，一台裸机就完成了从「能开机」到「能见人」的转变。后续再按需叠加——比如双因子认证、日志集中收集、入侵检测——但先把这五件事做扎实，已经能挡住 99% 的自动化攻击。
