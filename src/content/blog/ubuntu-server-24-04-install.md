---
title: '从零开始玩转 Ubuntu ②：安装 Ubuntu Server 24.04 全流程'
description: '从下载镜像、校验完整性、制作启动盘，到安装器每一步怎么选，手把手把 Ubuntu Server 24.04 LTS 装进机器，装完即可开机。'
pubDate: '2026-08-10'
heroImage: '../../assets/blog-placeholder-2.jpg'
tags: ['从零开始玩转Ubuntu', 'Ubuntu', 'Linux']
---

上一篇讲了为什么选 Ubuntu Server 24.04 LTS，这篇直接动手装系统。整个过程分三步：**下载镜像 → 制作启动盘 → 走安装器**。顺利的话半小时搞定。

## 第一步：下载镜像并校验

打开 Ubuntu 官网的 Server 下载页（`ubuntu.com/download/server`），下载 `ubuntu-24.04.x-live-server-amd64.iso`，大约 2 GB。国内网络慢的话可以换清华、阿里云的镜像站，搜「ubuntu-releases 镜像」即可。

下载完**务必校验文件完整性**——镜像下载过程中损坏是小概率但真实存在的事，装到一半报错排查半天不值当。在下载目录执行：

```bash
# Linux / macOS
sha256sum ubuntu-24.04.2-live-server-amd64.iso

# Windows（PowerShell）
Get-FileHash .\ubuntu-24.04.2-live-server-amd64.iso -Algorithm SHA256
```

把输出的哈希值和下载页面上 `SHA256SUMS` 里的对应值比对，一致才继续。

## 第二步：制作启动盘

准备一个 4 GB 以上的 U 盘（数据会被清空）。按你手头电脑的系统选一个工具：

- **Ventoy（推荐）**：开源工具，装一次到 U 盘，以后直接把 ISO 文件拷进 U 盘就能启动，支持多镜像共存，最省事。
- **Rufus（Windows）**：选 ISO、选 U 盘、点开始，写入模式保持默认。
- **dd（Linux/macOS 命令行）**：

```bash
# 先用 lsblk 确认 U 盘设备名（比如 /dev/sdb），千万别写成系统盘！
sudo dd if=ubuntu-24.04.2-live-server-amd64.iso of=/dev/sdb bs=4M status=progress oflag=sync
```

> `dd` 没有二次确认，设备名写错会直接把目标盘抹掉。执行前用 `lsblk` 看清楚哪个是 U 盘。

## 第三步：安装系统

U 盘插到要装系统的机器上，开机按启动菜单键（常见是 F12 / F11 / ESC，因主板而异）选择从 U 盘启动，进入安装器。Ubuntu Server 的安装器是文字界面，用方向键 + 回车操作，关键几步这么选：

**语言**：直接选 English。别选中文——Server 版的终端对中文支持不好，以后查报错信息也是英文资料多。

**网络配置**：插了网线会自动 DHCP 拿到 IP。记下这里显示的 IP 地址（比如 `192.168.1.100`），后面 SSH 要用。家用建议之后到路由器后台把这个 MAC 地址绑定成固定 IP，免得重启后地址变了找不到机器。

**代理**：留空。

**软件源镜像**：默认的 `archive.ubuntu.com` 国内偏慢，可以改成 `https://mirrors.tuna.tsinghua.edu.cn/ubuntu`，装完系统再换也行。

**磁盘分区**：新手直接选 **Use an entire disk**（整块盘自动分区），确认目标磁盘是你的系统盘（看容量认盘），LVM 保持默认勾选即可。这一步会清空整块盘，数据机请三思。

**用户信息**：设置主机名、用户名和密码。用户名别用 root（Ubuntu 默认也禁用了 root 直接登录），起一个普通用户名，比如 `cyril`。

**SSH 设置**：**勾选 Install OpenSSH Server**。这是服务器安装器和桌面版最大的区别之一，勾上装完就能远程登录，不用再接显示器。

**附加软件**：最后会推荐 snap 包（Docker、microk8s 之类），全部不选，装完系统后用 apt 自己装更干净。

确认后开始安装，几分钟装完，拔 U 盘重启。

## 首次开机检查

重启后用刚建的用户登录，黑底白字的终端映入眼帘——恭喜，系统装好了。做四件事确认状态：

```bash
# 1. 确认版本
lsb_release -a

# 2. 确认网络通了
ping -c 3 mirrors.tuna.tsinghua.edu.cn

# 3. 更新系统补丁（装完第一件事永远是这个）
sudo apt update && sudo apt upgrade -y

# 4. 确认 SSH 服务在跑
systemctl status ssh
```

`systemctl status ssh` 显示绿色的 `active (running)`，说明 SSH 已经在 22 端口监听了。

## 常见问题

| 问题 | 原因与解决 |
| :--- | :--- |
| 启动菜单里看不到 U 盘 | 镜像没写好，重做一次启动盘；或进 BIOS 关掉 Secure Boot 再试 |
| 安装器卡在检测更新 | 网络不通，检查网线；或跳过网络更新，装完再 `apt update` |
| 重启后进不了系统 | 启动顺序还指着 U 盘，进 BIOS 把硬盘调回第一启动项 |
| 装完没网 | 用 `ip a` 看网卡有没有拿到 IP；家用机器基本都是 DHCP 自动获取，没拿到多半是网线或路由器问题 |

到这里，一台能开机的 Ubuntu Server 就有了。下一篇进入正题：命令行里那些天天要用的命令，30 个就够你应付 90% 的日常操作。
