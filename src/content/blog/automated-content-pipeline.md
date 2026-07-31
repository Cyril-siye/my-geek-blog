---
title: '自动化内容管道：Obsidian 一键发布 + 新文章自动推送 Telegram'
description: '用 Obsidian Git 插件实现笔记即写即发，Cloudflare Pages 自动构建，GitHub Actions 把新文章推送到 Telegram Channel。'
pubDate: '2026-08-05'
tags: ['博客玩法', '自动化', 'GitHub Actions']
heroImage: '../../assets/blog-placeholder-2.jpg'
---

写博客最劝退的环节往往不是写，而是发：写完还要手动 commit、push、等部署，再去频道里吆喝一声。这套摩擦足够让很多草稿永远躺在本地。本文记录我把整条链路打通后的完整方案：在 Obsidian 里写完笔记，剩下的事情——提交、构建、通知——全部自动发生。

## 整体管道一览

整条管道由四段组成，每一段只做一件事：

```bash
Obsidian 写作
    │  (Obsidian Git 插件定时 auto commit & push)
    ▼
GitHub 仓库 main 分支
    │  (push 事件同时触发两条线)
    ├──────────────► Cloudflare Pages 拉取代码、npm run build、分发到 Edge
    └──────────────► GitHub Actions 检测新增文章，调用 Telegram Bot API 推送
```

关键在于"单一事实来源"：文章只存在于 `src/content/blog/` 目录，Git 仓库是唯一枢纽。Obsidian 不直接碰部署，Telegram 推送也不依赖写作端是否在线，各环节通过 git push 解耦，任何一环挂掉都不影响其他环节。

## Obsidian 端配置

### 把博客目录变成 Obsidian 库

这个 Astro 博客的文章存放在 `src/content/blog/` 下。最简单的做法是直接用 Obsidian 打开整个博客仓库作为库（Vault），这样既能写文章，也能顺手改配置。如果你不想让代码文件干扰笔记体验，也可以把 `src/content/blog/` 单独作为一个库打开，只是改代码时要换个编辑器。

### 安装并配置 Obsidian Git 插件

1. 在 Obsidian 设置中关闭"安全模式"，进入「社区插件 → 浏览」，搜索 **Obsidian Git** 并安装启用。
2. 打开插件设置，找到 **Git Backup settings**：
   - `Vault backup interval (minutes)`：建议设 5–10 分钟，插件会按此间隔自动 commit 并 push。
   - `Auto push interval (minutes)`：如果想分离提交与推送节奏可单独设置，留空则跟随 backup 间隔。
   - `Commit message`：可以用模板变量，如 `vault backup: {{date}}`。
3. 前提是这台机器的 git 已经配置好对 GitHub 的认证（SSH key 或 credential helper），插件本质上就是替你执行 `git add -A && git commit && git push`。

配置完成后，写作即备份：到点插件自动提交，推送到 main 分支，云端流程随即接管。

### frontmatter 必须遵守博客 schema

Obsidian 只管写，但 Astro 构建时会用 zod 校验 frontmatter。本仓库的 schema 定义在 `src/content.config.ts`，四个必填/常用字段如下：

```mdx
---
title: '文章标题'
description: '一句话摘要'
pubDate: '2026-08-05'
heroImage: '../../assets/blog-placeholder-2.jpg'
---
```

几个要点：

- `title`、`description` 为必填字符串；`pubDate` 会被 `z.coerce.date()` 转成 Date；`heroImage` 走的是 Astro 的 `image()` 校验，路径必须真实存在。
- 建议养成用单引号包裹值的习惯，与本仓库现有文章保持一致，也避免标题里带冒号时 YAML 解析翻车。
- 可以在 Obsidian 的「模板」核心插件里做一个文章模板，把这段 frontmatter 固化进去，新建笔记时一键插入。

> 提示：`updatedDate` 在 schema 中是可选字段，修改旧文时可补上，不填也不影响构建。

## Cloudflare Pages 自动构建

这一环几乎零配置：

1. 登录 Cloudflare Dashboard，进入 **Workers & Pages → Create → Pages → Connect to Git**，授权并选中博客仓库。
2. 构建设置中，**Framework preset** 选择 **Astro**，Cloudflare 会自动填入构建命令 `npm run build` 和输出目录 `dist`，无需手改。
3. 保存后，每次 main 分支有新 push，Pages 都会自动拉取、构建、分发到全球 Edge 节点。构建历史里能看到每次部署对应的 commit，出问题可以一键回滚到任意历史版本。

验证方法：push 一篇测试文章，几分钟后访问 `https://<你的域名>/blog/<slug>/`，能看到即说明此链路通畅。

## 新文章 Telegram 推送

这是本文的重点，也是最容易踩坑的一环。本仓库已内置 `.github/workflows/new-post-notify.yml`，下面按它的真实实现逐段讲解。

### 触发条件：push main 且文章目录变动

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'src/content/blog/**'
```

`paths` 过滤器保证只有文章目录发生变动的 push 才会触发，改代码、改样式不会惊动通知流程。

另一个细节是 job 级别的条件：

```yaml
if: ${{ secrets.TG_BOT_TOKEN != '' && secrets.TG_CHAT_ID != '' }}
```

两个 secrets 任何一个没配置，整个 job 直接跳过，不会报错，也不影响仓库其他流程——这对 fork 出去的场景很友好。

### 用 git diff 找出新增文章

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 2

- name: 找出本次新增的文章
  id: posts
  run: |
    git diff --name-only --diff-filter=A HEAD~1 HEAD -- 'src/content/blog/*.md' 'src/content/blog/*.mdx' \
      | sed 's|^src/content/blog/||; s|\.mdx\?$||' > /tmp/new_posts.txt
    echo "count=$(wc -l < /tmp/new_posts.txt)" >> "$GITHUB_OUTPUT"
```

两个技巧值得注意：

- `fetch-depth: 2`：checkout 默认是浅克隆（depth 1），取不到 `HEAD~1`，必须显式拉两层才能 diff。
- `--diff-filter=A`：只匹配**新增（Added）**的文件。修改旧文、删除文章都不会触发推送，避免频道被编辑性提交刷屏。

`sed` 那两行把路径剥成 slug：去掉 `src/content/blog/` 前缀和 `.md`/`.mdx` 后缀。新增文章数写入 `$GITHUB_OUTPUT`，供后续步骤判断。

### 解析标题并调用 Bot API

```yaml
- name: 推送新文章到 Telegram
  if: steps.posts.outputs.count != '0'
  env:
    TG_BOT_TOKEN: ${{ secrets.TG_BOT_TOKEN }}
    TG_CHAT_ID: ${{ secrets.TG_CHAT_ID }}
  run: |
    while read -r slug; do
      [ -z "$slug" ] && continue
      file=$(ls "src/content/blog/${slug}.md" "src/content/blog/${slug}.mdx" 2>/dev/null | head -1)
      title=$(grep -m1 "^title:" "$file" | sed "s/^title: *['\"]\?//; s/['\"]\?$//")
      text="📝 新文章发布：${title}%0A🔗 https://dxj.dpdns.org/blog/${slug}/"
      curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TG_CHAT_ID}" \
        -d "text=${text}" \
        -d "disable_web_page_preview=false"
    done < /tmp/new_posts.txt
```

逐行看：

- 由于 slug 可能是 `.md` 也可能是 `.mdx`，先用 `ls` 探测真实存在的文件。
- `grep -m1 "^title:"` 取 frontmatter 里的第一个 title 行，再用 `sed` 剥掉键名和首尾引号——这就是为什么 frontmatter 格式规范很重要。
- 消息文本中 `%0A` 是 URL 编码的换行符，标题一行、链接一行。
- `disable_web_page_preview=false` 保留链接预览卡片，频道里更好看。

一次 push 新增多篇文章时，`while read` 循环会逐篇推送，每篇一条消息。

### 配置两个 Secrets

| Secret | 含义 | 获取方式 |
| --- | --- | --- |
| `TG_BOT_TOKEN` | Bot 的 API Token | 在 Telegram 找 @BotFather，发送 `/newbot`，按提示命名后获得 |
| `TG_CHAT_ID` | 目标 Channel/群组 ID | 见下文 |

获取 `TG_CHAT_ID` 的步骤：

1. 创建一个 Channel（公开频道最简单，用户名即 `@your_channel`，Chat ID 可直接用 `@your_channel`）。
2. 把刚创建的 Bot **加为频道管理员**，至少授予发消息权限——这一步必不可少。
3. 若是私有频道，可以先发一条消息，然后在浏览器访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`，从返回的 JSON 里找到 `chat.id`（通常是以 `-100` 开头的数字）。

最后在 GitHub 仓库的 **Settings → Secrets and variables → Actions → New repository secret** 中，分别添加 `TG_BOT_TOKEN` 和 `TG_CHAT_ID`。

验证：push 一篇新文章后，到仓库 **Actions** 标签页看 `New Post Notify` 是否绿灯；绿灯且频道里出现带预览卡片的消息，说明全链路打通。

## 常见坑

- **frontmatter 缺字段导致构建失败。** Astro 构建时 zod 校验不过会直接中断，`title`、`description`、`pubDate` 缺一即挂；`heroImage` 指向不存在的图片同样会报错。表现是 Cloudflare Pages 构建红叉，而 Obsidian Git 已经 push 成功了——本地写的时候根本无感。对策：用 Obsidian 模板固化 frontmatter，发文前本地跑一次 `npm run build` 兜底。
- **Bot 未加 Channel 管理员，推送返回 403。** Bot API 对无权发言的 chat 会返回 `403 Forbidden: bot is not a member of the channel`。workflow 用的是 `curl -s`，不会把错误码变成 job 失败，所以 Actions 显示绿色但频道里什么都没收到。排查时把 `getUpdates` 或手动 `curl` 一次 `sendMessage` 看返回体即可定位。
- **secrets 未配置时 workflow 自动跳过，且是"静默"跳过。** 因为 job 级的 `if` 条件不成立，Action 记录里这个 job 会显示为 Skipped 而非 Failed。如果你配了半天没消息，先检查 Actions 里 job 是不是灰色的跳过状态——十有八九是 secret 名字打错了（注意大小写必须完全一致）。
- **浅克隆取不到 `HEAD~1`。** 如果照抄本文思路但忘了 `fetch-depth: 2`，`git diff HEAD~1` 会直接报 unknown revision。同理，rebase 或 force push 改变了历史时，`HEAD~1` 的语义也会变，本文方案假设的是正常的线性提交历史。
- **squash merge 合入多篇文章。** squash 会把多次提交压成一个，只要最终 diff 里这些文件是新增的，`--diff-filter=A` 依然能找出来，这点不受影响；但如果你在 squash 之前就曾在 main 上 push 过这些文件，它们就不会再被视为"新增"了。

至此，从写下第一个字到读者在 Telegram 里收到通知，中间不再需要任何人工操作。写作回归写作本身，这才是自动化该有的样子。
