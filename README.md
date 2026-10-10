# @kkutysllb/dsh-git-panel

> **独立 git 工作区面板**——server 只读 git 快照 RPC（`/dsh-git-panel/api/snapshot` 与 open-plan 回退）+ client 页面内浮动面板（分支/工作区/计划视图），注册进侧边栏 Tab 体系。v1.0.1 新增 GitHub 管理（gh CLI 软依赖：PR/Issue 列表、一键创建 PR、Squash 合并、新建 Issue）。原 KCoder 桌面端宿主 git-panel 的插件化整体替代。

自 KCoder 内置包独立发布的 dsh 插件（v1.0.0 起独立版本线）。

## 安装 / Install

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
# npm registry (recommended: version detection with manual updates)
dsh plugin --profile web add @kkutysllb/dsh-git-panel

# GitHub 直装 / install straight from GitHub
dsh plugin --profile web add github:kkutysllb/dsh-git-panel

# 或从 dsh-plugins 真源仓 / or from the dsh-plugins monorepo
dsh plugin --profile web add github:kkutysllb/dsh-plugins#dsh-git-panel
```

装好后重启 web profile 即生效：出现「git 工作区」开关按钮（非 git 工作区
置灰），页面内注册独立浮动面板——变更/工作位置/分支、提交或推送、比较分支
外链、GitHub 管理（PR/Issue）、任务计划（递归扫任意层级的 plans/、.plans/ 与
plan.md）；多窗口各自跟随自己的会话工作区。
按钮锚点链（v1.1.0 起）：会话页落**会话头右上角席位**
`conversation.session.header.corner`（行内 28px，与邻居 icon 按钮齐平；KCoder
桌面壳把会话页头覆盖进自绘标题栏同一条带，席位正好在原生「编辑器选择 / SSH」
按钮左侧，互不遮挡）；hero/设置页没有会话头时回落到宿主自绘标题栏带
`#__dsh_desktop_titlebar`。gh 管理能力需本机装有 [gh CLI](https://cli.github.com) 并
`gh auth login`（缺席仅降级 GitHub 区块，其余功能不受影响）。

After install, restart the web profile: a "git workspace" toggle appears in
the host titlebar (desktop shells) or in the native conversation header's
corner seat (dimmed outside a git workspace) and an independent floating
panel registers in-page — changes/worktrees/branches, commit & push,
compare link, GitHub management (PR/Issue), task plans; each window follows
its own session workspace. The GitHub section needs the
[gh CLI](https://cli.github.com) installed and `gh auth login`; without it
only that section degrades.

每个版本的变更说明（新增 / 变更 / 修复）见 [`release/`](release/)；
`package.json` 的 `version` 是插件管理检测新版本的信号，更新由用户手动触发。

Per-version changes (added / changed / fixed) live under
[`release/`](release/); the `package.json` version drives update detection.

## dsh 0.2.x 适配（v1.1.0 起）

原生 dsh 壳（`dsh web` / 原生桌面）与桌面壳（KCoder/QiLin）的锚点不同，
0.2.x 又改了会话选择与右栏布局的契约，本插件对应四条：

| 面 | 旧假设（v1.0.x） | v1.1.0 |
|---|---|---|
| 开关按钮锚点 | 只认 `#__dsh_desktop_titlebar`（仅桌面壳有）→ 原生壳按钮永不出现；且该位形是固定 `right:108px` 绝对定位，在 KCoder 桌面壳里会压住标题栏带内的原生按钮（本地编辑器选择 / SSH） | 锚点链，**corner 优先**：`[data-slot="conversation.session.header.corner"]`（兜底 `[data-conversation-header-corner]`）→ 无会话头时回落标题栏带；位形随锚点（`.gt-corner` 行内 28px / 绝对定位） |
| 当前会话 / cwd | `sessions.list.getSnapshot().current`（0.1.6-alpha.2 起已移除）→ 面板恒「等待工作区」 | 三级来源：列表 `current`（老宿主遗留）→ 会话行 `[data-row-key^="session:"][aria-selected="true"]` → `localStorage['dsh.sessions.current']` |
| 原生右侧栏共存 | 面板是贴右缘浮层，会整个压住原生右栏（原 `detailsCol` 内缩写法在 0.2.x 改名后失效，且内缩切内容） | **互斥让位**：任一右栏（原生 `ctx.sidebarRight` / KCoder better-sidebar）展开 → git 面板收起，其收起 → 履约恢复；git 开启 → 开着的右栏收起，手动关 git 开回。服务缺席时退化为**几何互避**（按右栏轨道实测宽度把浮层左移） |
| 内容区让位 | `centerCol`/`detailsCol` 双列内缩 | 只缩中心列（原生右栏改由互斥让位处理） |

manifest 另按新代约定声明 `dsh.manifestVersion: 1`、`engines.dsh` 与两条
`peerDependencies`（`@deepseek-ai/dsh`、`@deepseek-ai/dsh-host-webserver`，
范围 `>=0.1.6-alpha.2 <1.0.0`），供 plugin-manager 安装前检查与 app-boot
启动准入评估。**上界必须 <1.0.0**：窄上界（如 <0.2.0）会让整个 bundle 在
0.2.x 被静默跳过。

## QiLin（麒麟）双通道适配（v1.0.2 起）

manifest 同时声明 `qilin` 与 `dsh` 两个通道的 `bundle.patch` / `client`：
QiLin（dsh 0.1.6-alpha.2 合并后）的插件管理器只认原生键
`qilin.bundle.patch`（缺失会报「没有声明组合包」），DSH 宿主仍读
`dsh.*`；两通道指向同一份 `cordis.patch.yml` 与 client 交付物，
行为完全一致。

## 麒麟（QiLin）引擎安装

```bash
# npm registry（推荐：版本可被插件管理检测，用户手动更新）
qilin plugin --profile qilin add @kkutysllb/dsh-git-panel

# GitHub 直装 / install straight from GitHub
qilin plugin --profile qilin add github:kkutysllb/dsh-git-panel
```

装完在 QiLin 设置 → 插件里可见、可启停；Git 面板需要系统 git
（gh 可选）。

### 注意事项（QiLin）

- **必须经 `qilin plugin add` 装进 profile**：包会落到 profile 私有的
  `~/.qilin/profiles/<name>/node_modules`——裸包名原生解析的第一跳。
  **不要**手工把包目录放进共享的 `~/.qilin/profiles/node_modules`：
  dsh alpha.2 合并后的 runtime+enforce 解析把该目录划为安装保留区，
  放那里的 bundle 层包激活时直接 `failed to import`。
- **引擎版本**：运行需要带 dsh 兼容层的 QiLin 3.0.0+；插件**管理**
  （设置页展示/启停）要求 3.0.2+（alpha.2 合并后只认
  `qilin.bundle.patch` 原生键）。
- **运行时解析**：dsh alpha.2 起依赖解析默认运行时模式（PR #4471），
  插件运行期导入由 profile 安装图经进程内 generation 解析；本仓
  host 侧零 npm 运行时依赖，天然兼容。

## 形态

- 纯产物直提包：`entry.js`（cordis 层挂载）+ `client.js`（`window.__ModuleLoader__.load({id})` 注册，经 `/plugins` combo 路由拼接执行） + `cordis.patch.yml`（bundle 层声明）。
- client 面：是；无原生构建、无 server 依赖安装（如含 server 半则在 entry.js 内实现）。

## GitHub 管理（v1.0.1）

面板新增 GitHub 区块（懒加载，不参与轮询；标题展示 owner/repo）：

- 开放 PR / Issue 清单：数量徽标，行点击经 `open-url`（http/https 白名单）系统浏览器打开；
- 一键创建 PR：flyout 填标题/描述；当前分支未推送或落后上游时 server 先 `push -u`；
- PR Squash 合并：行内二次确认（草稿 PR 不出合并动作）；
- 新建 Issue：flyout 填标题/描述；
- 新增 RPC：`gh-list` / `gh-create-pr` / `gh-merge-pr`（merge|squash|rebase，缺省 squash）/ `gh-create-issue` / `open-url`；
- gh CLI 未安装或未登录时区块降级为安装/登录提示，git 面板本体不受影响。

## 开发

- 本仓为开发真源；改动后跑 `node scripts/sync-to-dsh-plugins.mjs` 同步 dsh-plugins 镜像并提交推送。
- `pnpm smoke`（prepack 自动）做契约形态校验（25 项，含锚点链/会话来源/manifest 兼容面）；
  `node tests/run-tests.mjs` 跑 entry 半单测；`node scripts/create-github-releases.mjs` 同步 release/ 到 GitHub Releases。
- **client 面改动必须真过一遍宿主**：smoke 只锁形态。验收路径 = 起一个真 profile
  （`dsh plugin --profile <tmp> add <本仓>`）+ 真浏览器加载页面，断言按钮锚点、
  面板 cwd 与实际 RPC 载荷（0.2.x 起会话头 corner 只在会话页渲染，需先建会话）。

## 许可

MIT © dsh-external
