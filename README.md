# AtomGitAccountLens

[![CI](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/ci.yml/badge.svg)](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/ci.yml)
[![Deploy](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/deploy.yml/badge.svg)](https://github.com/EthanCheung-gh/AtomGitAccountLens/actions/workflows/deploy.yml)

**GitCode / AtomGit 账号全景透镜**：输入你的访问令牌（PAT），在浏览器本地对你的仓库、语言、提交与活跃度做全面可视化分析。纯前端静态站，无后端，数据不出本机。

在线体验：`https://ethancheung-gh.github.io/AtomGitAccountLens/`

## 功能

- **总览**：账号资料、仓库/Star/Fork/Watchers/活跃仓库聚合、`top_languages`、年度提交规模
- **仓库画像**：语言构成（仓库数加权 ⇄ Star 加权双口径切换）、仓库创作时间线、新鲜度分布（30 天/半年/一年/休眠）、Top 被星仓库、个人/组织命名空间分布、仓库清单勾选排除（勾选即时重算全站口径）
- **活跃度**：年度贡献热力图（按日提交）、7×24 工作习惯热力图（周 × 时段）、事件类型分布、年度累积提交曲线、推送粒度分布（每次 push 带几个提交）、活跃仓库月度堆叠、最活跃仓库 Top 10
- **年度报告**：自然年选择器，生成可整页截图分享的年度总结（提交数、活跃天数、最长连续与最长空窗、推送习惯、语言构成等）
- **深度抓取（可选）**：逐仓库**全时段**翻页抓取提交（每页 100 条直至短页，单仓库上限 5000 条；走限流队列、可中断、增量续抓、可一键重置全量重抓）。产出提交级分析：全时段月度提交时间线、按年提交量、周内分布、提交时段、提交工作习惯 7×24 热力图、Conventional Commits 类型分布、每仓库提交 Top 10、最近提交样本；支持「仅本人提交」过滤（按提交作者登录名，作者未知的计入本人），含加入的社区/组织仓库时也能干净分析

工程特性：

- 串行限流队列（默认 300 次/分，低于平台 400 次/分配额），429/5xx 指数退避重试，全程可中断
- 分析结果快照存于 localStorage：刷新秒开，手动「重新抓取」更新
- 缺 `read_user` 等权限时显示权限引导而非报错白屏
- Vitest 单测覆盖限流、聚合口径与存储等核心纯逻辑，GitHub Actions CI

## 隐私与令牌

- 令牌仅保存在页面内存中；勾选「在本设备记住」才会写入本浏览器 localStorage（明文，公共设备勿勾选）
- 所有请求直连 `api.gitcode.com/api/v5` 官方接口（`Authorization: Bearer`），不经过任何第三方服务器
- 分析结果快照仅保存在你的浏览器，清除浏览器数据即彻底删除

令牌创建入口：<https://gitcode.com/setting/token-classic>（建议勾选 `read_user` 等读取权限）

## 统计口径（重要）

GitCode 开放 API 与 GitHub 存在差异，本项目坚持「不虚构数据」：

1. **语言占比为加权口径**：`/repos/{owner}/{repo}/languages` 返回的是仓库内各语言**百分比**（非字节/行数）。账号级语言占比提供两个口径：**仓库数加权**（各仓库百分比之和 ÷ 总权重）与 **Star 加权**（百分比 × max(1, 仓库 Star 数)），可切换；括号内「N 仓」表示以该语言为主语言的仓库数（主语言优先取仓库 `language` 字段，缺失时取语言表最高项）。
2. **不展示代码行数**：API 不提供行数数据，规模指标以仓库数、提交数为代理。
3. **提交数来自事件流**：`/users/{login}/events?year=`（需 `read_user` 权限），热力图/时段/趋势/年报与总览的年度提交数同源。
4. **Followers 仅计数**：`/user` 返回的计数字段（followers 列表端点在 GitCode 域不可用）。
5. **仓库排除**：仓库画像页勾选排除后，总览/活跃度/年度报告全部同步按排除后口径计算。

## GitCode 与 AtomGit

GitCode（gitcode.com）与 AtomGit（atomgit.com）已完成平台融合，账户与 API 后端同源，`api.atomgit.com/api/v5` 同样可用。本项目固定使用 `api.gitcode.com`，你的账号在两个域名下均可登录使用本站。

## 技术栈

React 18 + TypeScript + Vite + ECharts，pnpm 管理依赖。

## 本地开发

```bash
pnpm install
pnpm dev       # 开发服务器
pnpm build     # 类型检查 + 生产构建
pnpm test      # 单元测试
pnpm preview   # 预览构建产物
```

推送到 `main` 后 GitHub Actions 自动构建并发布到 GitHub Pages（`.github/workflows/deploy.yml`）。

## 许可

暂未声明开源许可（个人作品集项目）。
