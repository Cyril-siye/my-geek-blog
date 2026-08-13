---
title: '从零开始玩转 Ubuntu ⑥：日常运维四件套——服务、日志、资源、定时任务'
description: '服务器跑起来之后怎么照看它：systemctl 管服务、journalctl 看日志、df/free 查资源、cron 跑定时任务，掌握日常运维的四个基本功。'
pubDate: '2026-08-14'
heroImage: '../../assets/blog-placeholder-1.jpg'
tags: ['从零开始玩转Ubuntu', 'Ubuntu', '运维', 'Linux']
---

系列最后一篇。网站跑起来之后，服务器的日常就是「偶尔上去看看状态、出了毛病知道去哪查、定期的活让机器自己干」。这篇讲四件基本功，学会它们，你就能独立照看一台生产服务器了。

## 一、管服务：systemctl

现代 Ubuntu 里所有后台服务（Nginx、SSH、Docker……）都归 **systemd** 管，统一用 `systemctl` 操作：

```bash
systemctl status nginx      # 看状态：是否在跑、PID、最近日志
sudo systemctl start nginx      # 启动
sudo systemctl stop nginx       # 停止
sudo systemctl restart nginx    # 重启（改配置后常用）
sudo systemctl reload nginx     # 平滑重载配置，不断开现有连接
sudo systemctl enable nginx     # 开机自启
sudo systemctl disable nginx    # 取消自启
```

记住 **`status` 是排障第一步**：任何服务出问题，先 `systemctl status 服务名` 看一眼，状态信息和最近的报错日志都在里面。

查看系统里所有服务的状态：

```bash
systemctl --type=service --state=running   # 正在运行的服务
systemctl --failed                         # 启动失败的服务——开机后查一遍是个好习惯
```

## 二、看日志：journalctl + /var/log

出问题的时候，日志就是你唯一的目击证人。Ubuntu 的日志分两类：

**系统日志**用 `journalctl` 查（systemd 统一收集）：

```bash
journalctl -u nginx              # 看某个服务的全部日志
journalctl -u nginx -f           # 实时追踪（相当于 tail -f）
journalctl -u nginx --since "1 hour ago"   # 最近一小时
journalctl -p err -b             # 本次开机以来 error 级别以上的日志
journalctl -b                    # 本次开机的全部日志
```

**应用日志**在 `/var/log/` 目录下，各服务自己写：

```bash
ls /var/log/
# syslog          系统综合日志
# auth.log        登录认证日志（谁在爆破你的 SSH 全在这）
# nginx/          Nginx 的访问和错误日志
```

两个高频实战场景：

```bash
# 网站打不开：看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 怀疑有人尝试登录：看认证日志里的失败记录
sudo grep "Failed password" /var/log/auth.log | tail -20
```

## 三、查资源：磁盘、内存、CPU

服务器很多「灵异故障」最后查出来都是磁盘满了或者内存爆了。三个命令定期看：

```bash
df -h        # 磁盘：重点看 Use% 列，超过 85% 就该清理了
free -h      # 内存：看 available 列还剩多少可用
top          # 实时 CPU / 内存占用（按 q 退出）
```

磁盘快满时，用 `du` 找出是谁占的：

```bash
# 一层层下钻，找到大户目录
sudo du -h --max-depth=1 / | sort -hr | head -20
sudo du -sh /var/log/* | sort -hr | head
```

日志是磁盘占用大户的常客。Ubuntu 自带 logrotate 会定期切割压缩日志，一般不用手动干预，但自己部署的程序要注意日志会无限增长。

## 四、定时任务：cron

需要「每天凌晨备份」「每小时同步一次」这种周期性的活，交给 cron：

```bash
crontab -e     # 编辑当前用户的定时任务（首次会让你选编辑器，选 nano）
```

cron 的时间格式是五段：`分 时 日 月 星期`。几个例子：

```bash
# 每天凌晨 3:30 执行备份脚本
30 3 * * * /opt/scripts/backup-local.sh

# 每小时整点同步一次数据
0 * * * * /home/cyril/sync.sh

# 每周日凌晨 2 点更新系统补丁
0 2 * * 0 sudo apt update && sudo apt upgrade -y

# 每天凌晨 4 点清理 30 天前的旧日志
0 4 * * * find /var/log/myapp -name "*.log" -mtime +30 -delete
```

几个实用规则：

- **命令用绝对路径**（`/usr/bin/python3` 而不是 `python3`），cron 的环境变量很少，PATH 和你终端里不一样——这是新手最常见的坑，脚本手动跑没问题、cron 里就不执行，九成是路径问题。
- **输出重定向到日志文件**，不然任务执行了什么、报没报错都不知道：

```bash
30 3 * * * /opt/scripts/backup-local.sh >> /var/log/backup.log 2>&1
```

- `crontab -l` 查看当前任务列表。

## 一个日常巡检小脚本

把上面学的串起来，写个简单的健康检查脚本，每天自动跑：

```bash
#!/bin/bash
# /home/cyril/healthcheck.sh —— 服务器每日体检
echo "===== $(date) ====="
echo "--- 磁盘 ---"
df -h / | tail -1
echo "--- 内存 ---"
free -h | grep Mem
echo "--- 负载 ---"
uptime
echo "--- 失败的服务 ---"
systemctl --failed --no-legend
echo "--- 昨日 SSH 失败登录次数 ---"
sudo grep -c "Failed password" /var/log/auth.log 2>/dev/null || echo 0
```

挂上 cron，每天早上 8 点把体检结果追加到日志：

```bash
0 8 * * * /home/cyril/healthcheck.sh >> /home/cyril/health.log 2>&1
```

隔几天 `cat ~/health.log` 扫一眼，服务器健不健康一目了然。

## 系列总结

六篇走完，回顾一下你现在已经掌握的完整技能链：

| 阶段 | 核心内容 |
| :--- | :--- |
| ① 认识 | Ubuntu / LTS / Server 版的选择逻辑 |
| ② 安装 | 镜像校验、启动盘、安装器每一步 |
| ③ 命令 | 30 个高频命令覆盖日常操作 |
| ④ 远程 | SSH 密钥登录、传文件 |
| ⑤ 实战 | Nginx 部署网站、防火墙放行 |
| ⑥ 运维 | systemctl、journalctl、资源检查、cron |

到这里，「装系统 → 远程管理 → 部署服务 → 日常维护」的闭环就完整了。往后你想用这台服务器做什么——挂博客、跑 Docker、搭网盘、部署机器人——都是在这些基本功之上的延伸。

遇到具体问题再来翻我的博客，安全加固、备份、反向代理这些进阶主题都有专门的文章。玩 Linux 没有捷径，就是多敲、多坏、多修。祝折腾愉快。
