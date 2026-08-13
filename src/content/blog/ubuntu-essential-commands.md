---
title: '从零开始玩转 Ubuntu ③：新手必学的 30 个命令'
description: '按真实使用场景分类讲解文件操作、权限、软件安装、系统状态查看等核心命令，每条都带实例，看完就能脱离图形界面管理服务器。'
pubDate: '2026-08-11'
heroImage: '../../assets/blog-placeholder-3.jpg'
tags: ['从零开始玩转Ubuntu', 'Ubuntu', 'Linux', '命令行']
---

系统装好了，面对黑漆漆的终端，新手最常问的是：命令那么多，先学哪些？

答案是 30 个左右。Linux 命令有几百个，但日常管理服务器真正高频的就那么一小撮。这篇按**你会遇到的场景**分类讲，每条命令都配实例。建议开着终端跟着敲一遍——命令这东西，看十遍不如敲一遍。

## 先记住两个通用技巧

- **Tab 补全**：敲路径或命令的前几个字母按 Tab，自动补全。这是命令行效率的来源，养成肌肉记忆。
- **`man` 和 `--help`**：忘了参数就 `man ls` 看手册（按 q 退出），或者 `ls --help` 看速查。

## 场景一：我在哪、这里有什么

```bash
pwd                 # 显示当前所在目录
ls                  # 列出当前目录内容
ls -lh              # 详细列表，文件大小用 K/M/G 显示
ls -la              # 连隐藏文件（.开头）一起显示
cd /etc/nginx       # 进入目录
cd ..               # 回上一级目录
cd ~                # 回家目录（/home/你的用户名）
```

## 场景二：操作文件和目录

```bash
mkdir projects              # 建目录
mkdir -p a/b/c              # 一次建多层目录
cp app.log app.log.bak      # 复制文件
cp -r projects/ /tmp/       # 复制整个目录（-r 递归）
mv app.log.bak /tmp/        # 移动文件，也用来改名
rm file.txt                 # 删除文件
rm -r olddir/               # 删除目录及其内容
touch newfile.txt           # 建空文件
```

> ⚠️ `rm` 删除不进回收站，直接消失。`rm -rf` 更是无条件强删，敲之前确认三遍路径。无数人（包括老手）的惨痛事故都来自这一条。

## 场景三：看文件内容

```bash
cat /etc/os-release         # 小文件直接全部输出
less /var/log/syslog        # 大文件分页看，方向键翻页，q 退出
tail -n 50 app.log          # 看最后 50 行
tail -f app.log             # 实时追踪日志增长（Ctrl+C 退出）——排障神器
head -n 20 app.log          # 看开头 20 行
grep "error" app.log        # 在文件里搜索含 error 的行
```

`tail -f` 是运维日常使用频率最高的命令之一：服务出问题，一边操作一边盯着日志滚动。

## 场景四：编辑文件

服务器上没有图形界面，编辑配置文件用 **nano** 入门足够：

```bash
sudo nano /etc/ssh/sshd_config
```

界面底部有快捷键提示（`^` 代表 Ctrl）：`Ctrl+O` 保存、`Ctrl+X` 退出、`Ctrl+W` 搜索。等熟练了再去学 vim，不用一开始就跟 vim 的退出键较劲。

## 场景五：权限——为什么总提示 Permission denied

Linux 里每个文件都有「所有者」和「读/写/执行」权限。看到 `Permission denied`，就是权限不够：

```bash
ls -l file.txt
# -rw-r--r-- 1 cyril cyril 128 Aug 11 10:00 file.txt
#  权限      所有者  所属组
```

两个命令搞定大部分权限问题：

```bash
chmod +x script.sh          # 给脚本加执行权限
sudo chown cyril:cyril file.txt   # 把文件所有者改成自己
```

而 `sudo` 是「以管理员身份执行这一条命令」，系统级的操作（改 `/etc` 下的配置、装软件）都需要它。

## 场景六：装软件——apt 三板斧

Ubuntu 装软件不用去网上找安装包，`apt` 从官方软件源一条命令搞定：

```bash
sudo apt update             # 刷新软件源列表（装东西前必做）
sudo apt install nginx      # 安装软件
sudo apt remove nginx       # 卸载
sudo apt upgrade -y         # 升级所有已装软件的补丁
apt search sqlite           # 搜索软件包
```

## 场景七：系统状况怎么样

```bash
df -h               # 磁盘使用情况（-h 人类可读）——磁盘写满会导致各种灵异故障
du -sh /var/log     # 看某个目录占多大空间
free -h             # 内存使用情况
top                 # 实时进程和资源占用（q 退出）；装了 htop 更直观
uptime              # 开机时长和负载
ip a                # 查看 IP 地址和网卡状态
ping -c 3 baidu.com # 测网络通不通（-c 3 发 3 个包就停）
```

## 场景八：一些保命杂项

```bash
history             # 查看敲过的命令
clear               # 清屏（或 Ctrl+L）
sudo reboot         # 重启
sudo poweroff       # 关机
exit                # 退出当前登录会话
```

## 小结：一张速查表

| 想干什么 | 命令 |
| :--- | :--- |
| 找路、看目录 | `pwd` `ls` `cd` |
| 增删改文件 | `mkdir` `cp` `mv` `rm` `touch` |
| 看内容、搜日志 | `cat` `less` `tail -f` `grep` |
| 编辑配置 | `nano` |
| 权限问题 | `sudo` `chmod` `chown` |
| 装/卸/更新软件 | `apt update / install / remove / upgrade` |
| 看系统状态 | `df -h` `free -h` `top` `ip a` |

这 30 来个命令覆盖了日常操作的绝大多数场景。剩下的不用背，用到了再查，查得多了自然就记住了。

下一篇解决一个现实问题：服务器塞在角落没接显示器，怎么从自己的电脑上远程管理它——SSH 登场。
