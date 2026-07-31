---
title: 'Giscus 评论失败排查全记录：从 Unable to create discussion 到自动化预建'
description: '评论能登录、能加载却发不出去。通过读 giscus 源码定位到创建讨论用的是 App 安装令牌而非用户令牌，重装 App 修复，并用 GitHub Actions 实现评论讨论自动预建。'
pubDate: '2026-08-06'
heroImage: '../../assets/blog-placeholder-3.jpg'
tags: ['博客玩法', 'Giscus', '排错']
---

给博客接入 giscus 评论后，遇到一个诡异的故障：评论框能加载、GitHub 能登录，但点「评论」就弹 **Unable to create discussion**。排查过程踩了好几个坑，也顺手把防御方案做成了自动化。完整记录如下。

## 误导性线索：GET 404 不是故障

打开浏览器 DevTools，最先看到的是一个刺眼的 404：

```
GET https://giscus.app/api/discussions?repo=...&term=blog/hello-world/... → 404
{"error":"Discussion not found"}
```

很容易误以为这就是失败原因。但读 giscus 源码（`pages/api/discussions/index.ts`）后确认：**这是正常逻辑**——giscus 加载时先查询该页面有没有已存在的讨论，没有就返回 404，等你发第一条评论时再创建。这个 404 每个正常工作的 giscus 站点都会出现。

> 💡 教训：排查时先分清「现象」和「故障」，别被正常流程里的红色状态码带偏方向。

## 关键突破：读源码，弄清创建讨论用的是谁的令牌

真正的故障请求是 `POST /api/discussions` 返回 400。看服务端源码里的 `post()` 函数：

```typescript
// giscus/pages/api/discussions/index.ts（精简）
const userToken = req.headers.authorization?.split('Bearer ')[1];
if (!(await check(userToken))) {
  res.status(403).json({ error: 'Invalid or missing access token.' });
  return;
}
// 注意：创建讨论用的不是用户令牌，而是 App 安装令牌
token = await getAppAccessToken(repo);
const response = await createDiscussion(token, params);
const id = response?.data?.createDiscussion?.discussion?.id;
if (!id) {
  res.status(400).json({ error: 'Unable to create discussion with request body.' });
}
```

两个关键推论：

1. 返回 400 而不是 403，说明 App **已安装**、安装令牌也拿到了，但机器人执行 `createDiscussion` 被 GitHub 拒绝；
2. **用你的用户 token 手动创建讨论成功，不能证明 giscus 能创建**——两者走的是完全不同的令牌。

## 逐项排除：把「三个条件」变成可验证的事实

giscus 官方要求三个条件：仓库公开、App 已安装、Discussions 已开启。用公开 API 逐一验证，不依赖「我以为」：

```bash
# 仓库可见性与 Discussions 开关
curl -s "https://api.github.com/repos/OWNER/REPO" | grep -E '"(private|has_discussions)"'

# 分类 ID 是否有效（giscus 自己的接口）
curl -s "https://giscus.app/api/discussions/categories?repo=OWNER/REPO"
```

接着又排除了「分类是 Announcement 格式（仅维护者可发帖）」的假设：用一个**非维护者**账号的用户 token 直接调 GitHub GraphQL `createDiscussion`，成功了——说明分类是开放格式。

至此只剩一个解释：**App 安装令牌处于权限不完整的状态**（GitHub 报 `Resource not accessible by integration`，被 giscus 包装成 400）。

## 修复：重装 App 刷新安装令牌

1. `https://github.com/settings/installations` → 找到 giscus → **Uninstall**；
2. `https://github.com/apps/giscus` → **Install** → 勾选目标仓库；
3. 授权页确认权限包含 **Discussions: Read and write** 后再点安装。

验证修复不用等真实访客——直接复现 giscus 的创建调用：

```bash
curl -X POST "https://giscus.app/api/discussions" \
  -H "Authorization: Bearer <你的 giscus 登录 token>" \
  -H "Content-Type: application/json" \
  -d '{"repo":"OWNER/REPO","input":{"repositoryId":"...","categoryId":"...","title":"blog/your-post/","body":"本文评论区"}}'
```

返回 `{"id":"D_kw..."}` 即创建链路已通。

> ⚠️ **安全提醒**：排查期间我贴出去过两个 `ghu_` 令牌。OAuth 令牌等同密码，**绝对不要贴进 Issue、聊天或日志**。已暴露的令牌在 giscus 评论区退出登录即失效。

## 加固：预建讨论 + GitHub Actions 自动化

修好后还有个体验问题：每篇文章的**首条**评论都要现场创建讨论，这个环节依赖 giscus 服务的可用性。更稳的做法是**提前把讨论建好**，让评论永远只是「追加」操作。

手动版（每发一篇文章跑一次）：

```bash
curl -X POST "https://giscus.app/api/discussions" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d "{\"repo\":\"OWNER/REPO\",\"input\":{\"repositoryId\":\"...\",\"categoryId\":\"...\",\"title\":\"blog/SLUG/\",\"body\":\"本文评论区，欢迎留言交流。\"}}"
```

但手动的事迟早会忘，于是做成 GitHub Actions：push 新文章时自动预建。亮点是**用 Actions 内置的 `GITHUB_TOKEN`，不需要配置任何 secrets**：

```yaml
precreate-giscus:
  runs-on: ubuntu-latest
  permissions:
    discussions: write   # 关键：授予 GITHUB_TOKEN 写讨论的权限
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 2   # 需要上一个提交做 diff，浅克隆会拿不到
    - name: 为新增文章预建评论讨论
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        git diff --name-only --diff-filter=A HEAD~1 HEAD -- 'src/content/blog/*.md' 'src/content/blog/*.mdx' \
          | sed 's|^src/content/blog/||; s|\.mdx\?$||' > /tmp/new_posts.txt
        while read -r slug; do
          [ -z "$slug" ] && continue
          title="blog/${slug}/"
          # 查重：已存在则跳过
          search=$(jq -n --arg term "repo:${{ github.repository }} in:title ${title}" \
            '{query:"query($t:String!){ search(query:$t, type:DISCUSSION, first:1){ discussionCount } }", variables:{t:$term}}')
          count=$(curl -s -X POST "https://api.github.com/graphql" \
            -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/json" \
            -d "$search" | jq -r '.data.search.discussionCount // 0')
          [ "$count" -gt 0 ] && { echo "已存在，跳过: $title"; continue; }
          # 创建（mutation 省略，与手动版相同）
        done < /tmp/new_posts.txt
```

两个实测出来的细节，网上文档都没写清：

- 搜索查重时 `type:discussion` / `type:discussions` 限定词**都会让结果变 0**，正确写法是不加类型限定、只写 `repo:X in:title 标题`，靠 `type: DISCUSSION` 这个 GraphQL 枚举控制搜索范围；
- `createDiscussion` 的 `repositoryId` 和 `categoryId` 是 GraphQL Node ID（`R_kg...` / `DIC_...`），不是数字 ID，可以从 `https://giscus.app/api/discussions/categories?repo=...` 一次拿全。

## 排错方法论小结

| 步骤 | 动作 | 排除的可能性 |
| :--- | :--- | :--- |
| 1 | 读源码确认 404 是正常查询 | 「页面配置错了」 |
| 2 | 公开 API 验证三条件 | 仓库私有 / Discussions 未开 / 分类 ID 失效 |
| 3 | 非维护者账号手动创建成功 | 分类是 Announcement 格式 |
| 4 | 读源码发现创建用 App 令牌 | 「用户 token 能建 = giscus 能建」的误判 |
| 5 | 重装 App 后复现调用返回 200 | 确认根因是安装令牌权限状态异常 |

这次排错最大的心得：**当「官方 checklist 全部打勾」但功能仍然失败时，答案往往藏在「你以为等价、其实不等价」的地方**——这里是两种令牌的差别。读一遍源码，胜过在设置页面里反复瞎试。
