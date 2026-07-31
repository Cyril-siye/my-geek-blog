---
title: 'GitHub Actions 翻车实录：secrets 为什么不能用在 job 级 if 里'
description: '工作流写好 push 上去，直接被判 Invalid workflow file。原因是 secrets 上下文不允许出现在 job 级 if 中——记录排查、修复与本地预防方案。'
pubDate: '2026-08-07'
heroImage: '../../assets/blog-placeholder-5.jpg'
tags: ['博客玩法', 'GitHub Actions', '排错']
---

上一篇文章里我刚夸下海口，说新文章推送的自动化工作流「开箱即用」。结果 push 上去不到一分钟，Actions 页面连 job 列表都没出来，直接一行红字：

```
Invalid workflow file: .github/workflows/new-post-notify.yml#L1
(Line: 23, Col: 9): Unrecognized named-value: 'secrets'.
Located at position 1 within expression: secrets.TG_BOT_TOKEN != '' && secrets.TG_CHAT_ID != ''
```

整个工作流文件被判无效，里面两个 job 一个都没跑。这篇记录翻车原因、修复方法，以及以后怎么在本地就把这类错误拦住。

## 我写错了什么

当时的写法意图很朴素：「没配置 secrets 就跳过这个 job」：

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    if: ${{ secrets.TG_BOT_TOKEN != '' && secrets.TG_CHAT_ID != '' }}  # ❌ 非法
    steps:
      ...
```

问题就出在 `if` 里的 `secrets`。GitHub 明确规定：**`jobs.<job_id>.if` 只允许引用这几个上下文**：

| 上下文 | 内容 |
| :--- | :--- |
| `github` | 事件、仓库、提交等元信息 |
| `needs` | 前置 job 的输出与结果 |
| `strategy` / `matrix` | 矩阵构建参数 |
| `vars` | 仓库/组织级变量（非密文） |
| `inputs` | 手动触发 / 可复用工作流的输入 |

`secrets`、`env`、`steps` 全都**不在名单里**。引用即整个文件无效——不是警告，是连一个 job 都不会执行的硬失败。

## 为什么 GitHub 要这样设计

想明白之后就觉得这限制很合理。job 级 `if` 的求值时机是**调度阶段**——GitHub 在决定「要不要给这个 job 分配 runner」之前就要算出它的值。此时：

- runner 还没分配，`steps` 自然无从谈起；
- `env` 是 job 启动后才逐级注入的，调度时还不存在；
- 而 `secrets` 的解密和注入只发生在 **job 内部**。如果在调度阶段就允许表达式触碰 secrets，密文就不得不提前进入调度层的求值上下文，这扩大了它的暴露面。

一句话：**job 级 `if` 在「门外」求值，secrets 在「门内」才发放。**

## 修复：把判断挪到 step 级

step 级 `if` 的求值时机晚得多（job 已在 runner 上运行），支持的上下文也宽得多，包括 `env`。标准修法是「secrets → job 级 env 映射 → step 级 if 判空」：

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    env:
      TG_BOT_TOKEN: ${{ secrets.TG_BOT_TOKEN }}    # secrets 在 job 内映射给 env
      TG_CHAT_ID: ${{ secrets.TG_CHAT_ID }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: 找出本次新增的文章
        id: posts
        run: |
          git diff --name-only --diff-filter=A HEAD~1 HEAD -- 'src/content/blog/*.md' \
            | sed 's|^src/content/blog/||' > /tmp/new_posts.txt
          echo "count=$(wc -l < /tmp/new_posts.txt)" >> "$GITHUB_OUTPUT"

      - name: 推送新文章到 Telegram
        # 有新增文章 且 两个 secrets 均非空 才执行
        if: steps.posts.outputs.count != '0' && env.TG_BOT_TOKEN != '' && env.TG_CHAT_ID != ''
        run: |
          # ...curl 调 Telegram Bot API...
```

> 💡 注意 `if` 里引用 `env` 和 `steps` 时**不需要** `${{ }}` 包裹——`if` 条件本身就会被当作表达式求值（写了也不报错，属于风格问题）。

这样未配置 secrets 时，前面的轻量 step 照常跑完，只有推送 step 显示为灰色的 Skipped，语义和原来的「跳过 job」一致，还顺带更精确了。

## 另外两个备选方案

**方案一：用 `vars` 做显式开关。** `vars` 是 job 级 `if` 的合法上下文，在仓库 Settings → Variables 里建一个 `TG_NOTIFY_ENABLED = true`：

```yaml
jobs:
  notify:
    if: vars.TG_NOTIFY_ENABLED == 'true'   # ✅ 合法
```

好处是开关和密钥分离，临时想停推送不用删 secrets；坏处是要多维护一个变量。

**方案二：bash 里判空。** 不写 `if`，让脚本自己兜底：

```bash
if [ -z "$TG_BOT_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
  echo "::notice::未配置 Telegram secrets，跳过推送"
  exit 0
fi
```

最不依赖平台特性，但 job 页面看不出「跳过」语义，适合逻辑复杂的场景。

## 本地预防：actionlint

这类语法/上下文错误完全可以在 push 之前拦下来，工具是 [actionlint](https://github.com/rhysd/actionlint)——GitHub Actions 的静态检查器：

```bash
# 安装（任选其一）
brew install actionlint
go install github.com/rhysd/actionlint/cmd/actionlint@latest

# 检查当前仓库所有工作流
actionlint
```

它不仅能查 YAML 和表达式语法，还能识别「job 级 `if` 用了非法上下文」这类语义错误，甚至能发现 shell 脚本里的常见坑。把它挂进 pre-commit hook 或 CI 的 lint 阶段，工作流翻车率直接腰斩。

## 小结

| 求值位置 | 可用上下文 | 典型用途 |
| :--- | :--- | :--- |
| `jobs.<id>.if`（调度前） | `github` `needs` `strategy` `matrix` `vars` `inputs` | 按分支/变量决定 job 跑不跑 |
| `steps.<id>.if`（runner 上） | 上述全部 + `env` `steps` `secrets`（经 env 映射） | 按上一步结果/密钥存在性决定 step 跑不跑 |

这次翻车和上一篇 giscus 排错是同一个 pattern：**「你以为等价、其实不等价」的地方最容易出问题**——我以为 secrets 在哪都能用，实际上它只在 job「门内」发放。规则文档读一遍，不如报错信息读一遍；但报错信息读一遍，不如 actionlint 在本地就喊一嗓子。
