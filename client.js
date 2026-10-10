/**
 * @kkutysllb/dsh-git-panel — client 半（shell 页面内独立浮动面板）。
 *
 * 交付形态：dsh client-modules 按 package.json 的 dsh.client 声明把本
 * 文件作为 `exports["./client"]` bundle 读入，经 /plugins combo 路由以
 * 普通 script 拼接执行——因此这里没有 import/export，走
 * window.__ModuleLoader__.load({id, factory}) 注册协议（inject: []，
 * 立即 apply；betterSidebar/sessions 等全部 ctx.get 软探测）。
 *
 * 结构平移自退役宿主（desktop/main/git-panel.ts 的 PAGE_JS +
 * desktop/renderer/src/views/git.ts），差异：
 * - 面板从 WebContentsView 换成页面内 fixed DOM（z-index 顶格，与
 *   titlebar/panel-menu 同约定；无需 view 时代的菜单让位协议）；
 * - 数据从 IPC 推送换成轮询 RPC（开 15s / 收 60s，开合与刷新立即拉）；
 * - cwd 由 client 按当前会话现场读取（sessions 快照），随会话切换跟随；
 * - 计划点击预览三层软依赖：betterSidebar editor tab →（缺席）
 *   server open-plan 系统默认应用；
 * - 互斥让位双向（旧宿主 sidebar-cluster 协议平移，页面内直连）：
 *   反向：better-sidebar 面板展开沿自动收起 git 卡片（点计划预览时
 *   主动让位兼容“面板已展开无沿”路径），侧边栏收起沿履约恢复；仅
 *   让位收起才自动恢复，用户手动开关不参与义务。正向：git 卡片开启
 *   时侧边栏开着则收起避让（点簇末枚开关按钮，display:none 不影响
 *   click 派发，React 合成事件照常），git 手动关闭时履约开回；反向
 *   让位收起即解除正向义务，防交叉残留。
 * - 开关按钮 id __dsh_kc_git_btn / 位置 right:108px（旧宿主按钮
 *   __dsh_desktop_git_btn 已随宿主退役同步摘除，本按钮接替原位）；
 * - v1.0.1 GitHub 区块（gh CLI 软依赖）：PR/Issue 开放清单（懒加载
 *   gh-list，不参与轮询；行点击经 open-url 系统浏览器打开）、创建 PR
 *   （flyout 标题/描述；未推送分支由 server 自动 push -u）、Squash
 *   合并（行内二次确认）、新建 Issue；gh 缺席/未登录降级为安装提示。
 *
 * @module @kkutysllb/dsh-git-panel/client
 */

window.__ModuleLoader__.load({
  id: '@kkutysllb/dsh-git-panel',
  factory: () => {
    const exports = {}

    exports.inject = []

    exports.apply = function apply(ctx) {
      if (window.__dshKcGitWired) return
      window.__dshKcGitWired = true

      const BTN_ID = '__dsh_kc_git_btn'
      const PANEL_ID = '__dsh_kc_git_panel'
      const STYLE_ID = '__dsh_kc_git_style'
      const FLY_ID = '__dsh_kc_git_fly'
      const API = '/dsh-git-panel/api'
      /** 开面板轮询（旧宿主 POLL_MS 同款）。 */
      const POLL_OPEN_MS = 15000
      /** 收起态降频轮询（徽章保活即可）。 */
      const POLL_CLOSED_MS = 60000
      /** 面板几何（旧宿主 PANEL_W/TOP/MARGIN/MAX_H 同款）。 */
      const PANEL_W = 360
      const PANEL_TOP = 60
      const PANEL_MARGIN = 12
      const PANEL_MAX_H = 620
      const PANEL_MIN_H = 200
      /** 内容区让位宽度（面板宽 + 双倍 margin）。 */
      const PAD_W = 384
      /** 标题栏按钮宿主（theme-watcher 注入；仅 KCoder/QiLin 桌面壳有）。 */
      const TITLEBAR_ID = '__dsh_desktop_titlebar'
      /** 原生壳按钮回退锚：会话头右上角席位（slot 工具化 DOM）。 */
      const CORNER_SLOT = 'conversation.session.header.corner'
      /** 侧栏会话行的 DOM order key 前缀（ui-workspace Rows.tsx 稳定事实）。 */
      const SESSION_ROW_PREFIX = 'session:'
      /** 会话选择持久键（ui-workspace selection store 的 persist 名）。 */
      const SESSION_STORE_KEY = 'dsh.sessions.current'
      /** 原生右栏列结构锚（ui-layout AppFrame 第三列轨道）。 */
      const RIGHTBAR_COL_SEL = '[data-rightbar-col]'

      // 空快照（挂载后第一次拉取前）
      const EMPTY = {
        workspace: null, isRepo: false,
        staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, plans: [],
        error: null,
      }

      let snapshot = EMPTY
      let open = false
      let timer = null
      /** 工作位置切换（worktree 路径覆盖；null = 跟随会话 cwd）。 */
      let cwdOverride = null
      let changesOpen = false
      let commitOpen = false
      /** flyout 模式：null | 'location' | 'branch' | 'create' | 'gh-pr' | 'gh-issue'。 */
      let flyMode = null
      let branchCache = null
      let busyAction = false
      let hintMsg = ''
      /** GitHub 区块（懒加载，不参与轮询）：prOpen/issueOpen 展开态；
       *  ghCache = null | {state:'loading'|'ok'|'err', data?, error?}；
       *  lastGhRoot 记缓存归属仓库（worktree 切换即失效重拉）。 */
      let prOpen = false
      let issueOpen = false
      let ghCache = null
      let lastGhRoot

      const SVG = {
        branch: '<svg viewBox="0 0 16 16" fill="none"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" fill="currentColor"/></svg>',
        folder: '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 3.5c0-.6.4-1 1-1h3l1.4 1.6h6c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1v-8.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        x: '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        refresh: '<svg viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        close: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        plan: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2.2h10c.6 0 1 .4 1 1v9.6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        chevron: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        check: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        plus: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        laptop: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 3.8h10v6.4H3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.8 12.5h12.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        commit: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 8h4.3M10.2 8h4.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        github: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 0 0-2.06 12.67c.33.06.45-.14.45-.32v-1.13c-1.8.39-2.19-.87-2.19-.87-.3-.76-.72-.96-.72-.96-.6-.4.04-.4.04-.4.66.05 1.01.68 1.01.68.59 1 1.55.72 1.93.55.06-.43.23-.72.42-.89-1.44-.16-2.96-.72-2.96-3.2 0-.71.25-1.29.67-1.74-.07-.17-.29-.83.06-1.72 0 0 .55-.17 1.8.66a6.2 6.2 0 0 1 3.28 0c1.24-.83 1.79-.66 1.79-.66.36.89.13 1.55.07 1.72.42.45.66 1.03.66 1.74 0 2.49-1.52 3.04-2.97 3.2.24.2.44.6.44 1.22v1.8c0 .18.12.39.46.32A6.5 6.5 0 0 0 8 1.5Z"/></svg>',
        external: '<svg viewBox="0 0 16 16" fill="none"><path d="M6.5 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9.5M9 3h4v4M13 3L7.5 8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        changes: '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M8 5.5v5M5.5 8h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        pr: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>',
        issue: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>',
      }

      /* ---- 样式：面板（git.ts PAGE_CSS 平移 + fixed 外壳）+ 标题栏按钮/徽章 ---- */
      const CSS = [
        '#' + PANEL_ID + '{position:fixed;right:' + PANEL_MARGIN + 'px;top:' + PANEL_TOP + 'px;width:min(' + PANEL_W + 'px,calc(100vw - 24px));height:clamp(' + PANEL_MIN_H + 'px,calc(100vh - ' + (PANEL_TOP + PANEL_MARGIN) + 'px),' + PANEL_MAX_H + 'px);z-index:2147483647;display:flex;flex-direction:column;font:400 12px/1.55 -apple-system,"PingFang SC","Segoe UI",sans-serif}',
        '#' + PANEL_ID + ' .gt-card{flex:1;min-height:0;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--gt-border);background:var(--gt-bg);box-shadow:0 14px 44px rgba(9,16,29,.22),0 2px 8px rgba(9,16,29,.10);overflow:hidden;color:var(--gt-fg);--gt-bg:#FFFFFF;--gt-header:#F9FAFB;--gt-fg:#1A1D21;--gt-border:rgba(0,0,0,.10);--gt-muted:rgba(26,29,33,.55);--gt-chip:rgba(128,128,128,.14);--gt-hover:rgba(128,128,128,.12);--gt-accent:#2F6FED;--gt-add:#1A7F37;--gt-del:#CF222E;--gt-mono:ui-monospace,Menlo,Monaco,monospace}',
        // 应用内主题轨道（唯一轨道；上游契约：以 body[data-ds-dark-theme]
        // 为准——不用 prefers-color-scheme，避免「应用内浅色+系统深色」
        // 三态组合下面板与应用壳不一致）
        'body[data-ds-dark-theme] #' + PANEL_ID + ' .gt-card{--gt-bg:#1B1B1C;--gt-header:#222325;--gt-fg:#E8EAED;--gt-border:#2C2C2E;--gt-muted:rgba(232,234,237,.55);--gt-chip:rgba(128,128,128,.18);--gt-hover:rgba(128,128,128,.16);--gt-accent:#7C9BFF;--gt-add:#3FB950;--gt-del:#F85149;box-shadow:0 14px 44px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4)}',
        '#' + PANEL_ID + ' .gt-header{flex:none;height:34px;display:flex;align-items:center;gap:6px;padding:0 8px 0 12px;background:var(--gt-header);border-bottom:1px solid var(--gt-border);user-select:none}',
        '#' + PANEL_ID + ' .gt-ws{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:1;font:600 12px/1 var(--gt-mono)}',
        '#' + PANEL_ID + ' .gt-wname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#' + PANEL_ID + ' .gt-ws svg{width:13px;height:13px;flex:none;color:var(--gt-accent)}',
        '#' + PANEL_ID + ' .gt-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;cursor:pointer;color:var(--gt-muted);flex:none}',
        '#' + PANEL_ID + ' .gt-btn:hover{background:var(--gt-hover);color:var(--gt-fg)}',
        '#' + PANEL_ID + ' .gt-btn svg{width:14px;height:14px}',
        '#' + PANEL_ID + ' .gt-status{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:8px 12px;border-bottom:1px solid var(--gt-border)}',
        '#' + PANEL_ID + ' .gt-lines{font:650 12px/1.2 var(--gt-mono);font-variant-numeric:tabular-nums;margin-right:2px}',
        '#' + PANEL_ID + ' .gt-lines .a{color:var(--gt-add)}',
        '#' + PANEL_ID + ' .gt-lines .d{color:var(--gt-del);margin-left:4px}',
        '#' + PANEL_ID + ' .gt-pill{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:6px;background:var(--gt-chip)}',
        '#' + PANEL_ID + ' .gt-pill b{font:650 11px/1.2 var(--gt-mono);font-variant-numeric:tabular-nums}',
        '#' + PANEL_ID + ' .gt-pill span{font-size:10px;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-body{flex:1;min-height:0;overflow-y:auto;padding:10px 12px 16px}',
        '#' + PANEL_ID + ' .gt-caps{margin:4px 0 6px;font-size:10px;color:var(--gt-muted);letter-spacing:.5px;user-select:none}',
        '#' + PANEL_ID + ' .gt-caps::after{content:\'\';display:inline-block;width:60px;height:1px;background:linear-gradient(to right,var(--gt-border),transparent);vertical-align:middle;margin-left:6px}',
        '#' + PANEL_ID + ' .gt-plan{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border-radius:7px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-plan:hover{background:var(--gt-hover)}',
        '#' + PANEL_ID + ' .gt-plan svg{width:13px;height:13px;flex:none;color:var(--gt-accent);display:block}',
        '#' + PANEL_ID + ' .gt-plan .t{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + PANEL_ID + ' .gt-plan .w{flex:none;font-size:10px;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-hint{margin-top:8px;font-size:10px;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;color:var(--gt-muted);font-size:12px;text-align:center;padding:0 20px}',
        // 标题栏按钮（旧宿主同款视觉与位置；旧按钮已随宿主退役接替原位）。
        // 关键：bar 是 -webkit-app-region:drag 拖拽区（theme-watcher），
        // 按钮必须显式 no-drag，否则点击被窗口拖拽吞掉（DOM 无 click）。
        // 位形 1（宿主自绘标题栏：KCoder/QiLin 桌面壳主进程注入的
        // #__dsh_desktop_titlebar）：绝对定位接替退役宿主原位。
        '#' + BTN_ID + ':not(.gt-corner){all:unset;box-sizing:border-box;position:absolute;right:108px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;pointer-events:auto;transition:background .15s ease}',
        // 位形 2（原生 dsh 壳的会话头 corner 席位）：随会话头行内排布，
        // 28px 与邻居 icon 按钮齐平；头行整体是窗口拖拽区 → no-drag 同款。
        '#' + BTN_ID + '.gt-corner{all:unset;box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-left:6px;border-radius:7px;cursor:pointer;color:currentColor;opacity:.75;-webkit-app-region:no-drag;pointer-events:auto;transition:background .15s ease,opacity .15s ease}',
        '#' + BTN_ID + ':hover{background:rgba(128,128,128,.16);color:rgba(26,29,33,.9)}',
        '#' + BTN_ID + '[data-on="1"]{background:rgba(47,111,237,.14);color:#2F6FED}',
        'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.6)}',
        'body[data-ds-dark-theme] #' + BTN_ID + ':hover{background:rgba(128,128,128,.22);color:rgba(232,234,237,.9)}',
        'body[data-ds-dark-theme] #' + BTN_ID + '[data-on="1"]{background:rgba(124,155,255,.18);color:#7C9BFF}',
        '#' + BTN_ID + ' svg{width:15px;height:15px;flex:none}',
        // 非 git 仓库置灰（旧宿主 .dim 同款；panel-menu 菜单项禁用态同源）
        '#' + BTN_ID + '.dim{opacity:.4;cursor:default}',
        '#' + BTN_ID + '.dim:hover{background:transparent;color:rgba(26,29,33,.65)}',
        // 双色胶囊与代码 diff 约定一致：+N 绿底、−N 红底（面板 gt-lines 同款色族）
        '#' + BTN_ID + ' .bdg{position:absolute;top:-3px;right:-10px;display:inline-flex;height:14px;border-radius:7px;overflow:hidden;white-space:nowrap;color:#FFF;font:600 9px/14px -apple-system,"PingFang SC",sans-serif;text-align:center}',
        '#' + BTN_ID + ' .bdg .a{padding:0 4px;background:#1A7F37}',
        '#' + BTN_ID + ' .bdg .d{padding:0 4px;background:#CF222E}',
        'body[data-ds-dark-theme] #' + BTN_ID + ' .bdg .a{background:#238636}',
        'body[data-ds-dark-theme] #' + BTN_ID + ' .bdg .d{background:#DA3633}',
        // corner 位形贴着会话头右缘，徽章内收一点防裁切
        '#' + BTN_ID + '.gt-corner .bdg{top:-4px;right:-4px}',
        '#' + BTN_ID + '.gt-corner:hover{opacity:1}',
        '#' + BTN_ID + '.gt-corner.dim{opacity:.4}',
        // ---- 环境信息行（Codex 风格行布局） ----
        '#' + PANEL_ID + ' .gt-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border-radius:7px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-row:hover{background:var(--gt-hover)}',
        '#' + PANEL_ID + ' .gt-row .ic{display:inline-flex;width:14px;height:14px;flex:none;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-row .ic svg{width:14px;height:14px;display:block}',
        '#' + PANEL_ID + ' .gt-row .lb{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + PANEL_ID + ' .gt-row .chev{display:inline-flex;width:12px;height:12px;flex:none;color:var(--gt-muted);transition:transform .15s ease}',
        '#' + PANEL_ID + ' .gt-row .chev svg{width:12px;height:12px;display:block}',
        '#' + PANEL_ID + ' .gt-row[data-open="1"] .chev{transform:rotate(180deg)}',
        '#' + PANEL_ID + ' .gt-row .cnt{flex:none;font:650 10px/1.4 var(--gt-mono);color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-row.dim{opacity:.45;cursor:default}',
        '#' + PANEL_ID + ' .gt-row.dim:hover{background:transparent}',
        // 变更文件列表
        '#' + PANEL_ID + ' .gt-files{margin:0 0 6px 15px;border-left:1px solid var(--gt-border);padding:2px 0 2px 6px}',
        '#' + PANEL_ID + ' .gt-file{all:unset;box-sizing:border-box;display:flex;gap:6px;align-items:center;width:100%;padding:3px 6px;border-radius:6px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-file:hover{background:var(--gt-hover)}',
        '#' + PANEL_ID + ' .gt-file .st{flex:none;width:14px;text-align:center;font:650 10px/1.6 var(--gt-mono)}',
        '#' + PANEL_ID + ' .gt-file .st.a,#' + PANEL_ID + ' .gt-file .st.u{color:var(--gt-add)}',
        '#' + PANEL_ID + ' .gt-file .st.d{color:var(--gt-del)}',
        '#' + PANEL_ID + ' .gt-file .st.m{color:#BF8700}',
        'body[data-ds-dark-theme] #' + PANEL_ID + ' .gt-file .st.m{color:#D29922}',
        '#' + PANEL_ID + ' .gt-file .fp{flex:1;min-width:0;font:400 11px/1.6 var(--gt-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + PANEL_ID + ' .gt-file .ln{flex:none;font:600 10px/1.6 var(--gt-mono);color:var(--gt-muted)}',
        // GitHub 区块行内件：#num 徽标 / 状态 chip / 悬停动作（合并/确认）
        '#' + PANEL_ID + ' .gt-file .num{flex:none;font:650 10px/1.6 var(--gt-mono);color:var(--gt-add)}',
        '#' + PANEL_ID + ' .gt-file .tag{flex:none;font-size:9px;line-height:1;padding:2px 4px;border-radius:4px;background:var(--gt-chip);color:var(--gt-muted);white-space:nowrap}',
        '#' + PANEL_ID + ' .gt-file .act{flex:none;font-size:10px;line-height:1;color:var(--gt-muted);cursor:pointer;padding:2px 4px;border-radius:4px;user-select:none;white-space:nowrap}',
        '#' + PANEL_ID + ' .gt-file .act:hover{background:var(--gt-hover);color:var(--gt-fg)}',
        '#' + PANEL_ID + ' .gt-file .act.danger{color:#e5534b}',
        '#' + PANEL_ID + ' .gt-file.off{opacity:.45}',
        // 提交盒
        '#' + PANEL_ID + ' .gt-cbox{margin:2px 8px 8px 23px;display:flex;flex-direction:column;gap:6px}',
        '#' + PANEL_ID + ' .gt-msg{resize:vertical;min-height:44px;max-height:120px;border-radius:8px;border:1px solid var(--gt-border);background:transparent;color:var(--gt-fg);font:400 12px/1.5 -apple-system,"PingFang SC","Segoe UI",sans-serif;padding:6px 8px;outline:none}',
        '#' + PANEL_ID + ' .gt-cbtns{display:flex;gap:6px;align-items:center}',
        '#' + PANEL_ID + ' .gt-abtn,#' + FLY_ID + ' .gt-abtn{all:unset;box-sizing:border-box;height:24px;padding:0 10px;border-radius:6px;background:var(--gt-accent);color:#FFF;font-size:11px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-abtn:disabled,#' + FLY_ID + ' .gt-abtn:disabled{opacity:.4;cursor:default}',
        '#' + PANEL_ID + ' .gt-abtn.sec,#' + FLY_ID + ' .gt-abtn.sec{background:var(--gt-chip);color:var(--gt-fg)}',
        '#' + PANEL_ID + ' .gt-hintline{font-size:10px;color:var(--gt-muted);min-height:12px}',
        // ---- flyout（工作位置 / 分支选择器） ----
        '#' + FLY_ID + '{position:fixed;z-index:2147483647;width:264px;max-height:420px;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--gt-border);background:var(--gt-bg);color:var(--gt-fg);box-shadow:0 14px 44px rgba(9,16,29,.22),0 2px 8px rgba(9,16,29,.10);overflow:hidden;--gt-bg:#FFFFFF;--gt-fg:#1A1D21;--gt-border:rgba(0,0,0,.10);--gt-muted:rgba(26,29,33,.55);--gt-chip:rgba(128,128,128,.14);--gt-hover:rgba(128,128,128,.12);--gt-accent:#2F6FED;--gt-mono:ui-monospace,Menlo,Monaco,monospace}',
        'body[data-ds-dark-theme] #' + FLY_ID + '{--gt-bg:#1B1B1C;--gt-fg:#E8EAED;--gt-border:#2C2C2E;--gt-muted:rgba(232,234,237,.55);--gt-chip:rgba(128,128,128,.18);--gt-hover:rgba(128,128,128,.16);--gt-accent:#7C9BFF;box-shadow:0 14px 44px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4)}',
        '#' + FLY_ID + ' .fly-cap{padding:10px 12px 4px;font-size:10px;color:var(--gt-muted);letter-spacing:.5px;user-select:none}',
        '#' + FLY_ID + ' .fly-search{all:unset;box-sizing:border-box;margin:6px 10px;display:flex;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--gt-border);color:var(--gt-fg);font-size:12px}',
        '#' + FLY_ID + ' .fly-msg{all:unset;box-sizing:border-box;margin:0 10px 6px;display:block;height:64px;padding:6px 8px;border-radius:7px;border:1px solid var(--gt-border);color:var(--gt-fg);font:400 12px/1.5 -apple-system,"PingFang SC","Segoe UI",sans-serif;resize:none;outline:none}',
        '#' + FLY_ID + ' .fly-list{flex:1;min-height:0;overflow-y:auto;padding:2px 6px 6px}',
        '#' + FLY_ID + ' .fly-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border-radius:7px;cursor:pointer;font-size:12px}',
        '#' + FLY_ID + ' .fly-row:hover{background:var(--gt-hover)}',
        '#' + FLY_ID + ' .fly-row span:first-child{display:inline-flex;width:14px;height:14px;flex:none;color:var(--gt-muted)}',
        '#' + FLY_ID + ' .fly-row span:first-child svg{width:14px;height:14px;display:block}',
        '#' + FLY_ID + ' .fly-row .lb{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + FLY_ID + ' .fly-row .ck{display:inline-flex;width:14px;height:14px;flex:none;color:var(--gt-fg)}',
        '#' + FLY_ID + ' .fly-row .ck svg{width:14px;height:14px;display:block}',
        '#' + FLY_ID + ' .fly-div{height:1px;background:var(--gt-border);margin:6px 10px}',
        '#' + FLY_ID + ' .fly-none{padding:8px 12px;font-size:11px;color:var(--gt-muted)}',
        '#' + FLY_ID + ' .fly-zone{display:inline-flex;align-items:center;gap:4px;flex:none}',
        '#' + FLY_ID + ' .fly-del{cursor:pointer;user-select:none;font-size:11px;line-height:1;color:var(--gt-muted);padding:3px 5px;border-radius:5px;opacity:0;transition:opacity .12s}',
        '#' + FLY_ID + ' .fly-del svg{width:12px;height:12px;display:block}',
        '#' + FLY_ID + ' .fly-del:hover{color:var(--gt-fg);background:var(--gt-hover)}',
        '#' + FLY_ID + ' .fly-row:hover .fly-del{opacity:1}',
        '#' + FLY_ID + ' .fly-zone.confirm .fly-del{opacity:1}',
        '#' + FLY_ID + ' .fly-del.danger{color:#e5534b}',
        '#' + FLY_ID + ' .fly-ctag{font-size:11px;color:var(--gt-muted);white-space:nowrap}',
        '#' + FLY_ID + ' .fly-foot{display:flex;justify-content:flex-end;padding:0 10px 10px}',
      ].join('')

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.append(style)

      /* ---- 面板骨架（挂 body 子树：body[data-ds-dark-theme] 主题轨道是
       * 后代选择器，面板必须是其后代才会跟随应用内主题切换；SPA 重渲染
       * 只动 root 容器内部，body 直挂节点不受影响） ---- */
      const el = (tag, cls, text) => {
        const n = document.createElement(tag)
        if (cls) n.className = cls
        if (text) n.textContent = text
        return n
      }

      const panel = el('div')
      panel.id = PANEL_ID
      panel.style.display = 'none'

      const card = el('div', 'gt-card')
      const header = el('div', 'gt-header')
      const wIcon = el('span')
      wIcon.innerHTML = SVG.folder
      const wName = el('span', 'gt-wname')
      const refreshBtn = el('button', 'gt-btn')
      refreshBtn.innerHTML = SVG.refresh
      refreshBtn.title = '重新探测'
      const closeBtn = el('button', 'gt-btn')
      closeBtn.innerHTML = SVG.close
      closeBtn.title = '关闭面板'
      const ws = el('div', 'gt-ws')
      ws.append(wIcon, wName)
      header.append(ws, refreshBtn, closeBtn)

      const status = el('div', 'gt-status')
      const lines = el('span', 'gt-lines')
      const la = el('b', 'a', '+0')
      const ld = el('b', 'd', '\u22120')
      lines.append(la, ld)
      const pill = (label) => {
        const p = el('span', 'gt-pill')
        p.append(el('b', '', '0'), el('span', '', label))
        return p
      }
      const pStaged = pill('已暂存')
      const pChanged = pill('已修改')
      const pUntracked = pill('未跟踪')
      status.append(lines, pStaged, pChanged, pUntracked)

      const body = el('div', 'gt-body')
      // 环境信息区（Codex 风格行布局：变更/工作位置/分支/提交或推送/比较分支）
      const envCaps = el('div', 'gt-caps', '环境信息')
      const mkRow = (icon, label) => {
        const r = el('button', 'gt-row')
        const ic = el('span', 'ic')
        ic.innerHTML = icon
        const lb = el('span', 'lb', label)
        r.append(ic, lb)
        return { r, lb }
      }
      const mkChev = () => { const c = el('span', 'chev'); c.innerHTML = SVG.chevron; return c }
      const chRow = mkRow(SVG.changes, '变更')
      const chCnt = el('span', 'cnt', '0')
      const chChev = mkChev()
      chRow.r.append(chCnt, chChev)
      const filesBox = el('div', 'gt-files')
      filesBox.style.display = 'none'
      const locRow = mkRow(SVG.laptop, '本地')
      locRow.r.append(mkChev())
      const brRow = mkRow(SVG.branch, '—')
      brRow.r.append(mkChev())
      const cpRow = mkRow(SVG.commit, '提交或推送')
      const commitBox = el('div', 'gt-cbox')
      const msgInput = document.createElement('textarea')
      msgInput.className = 'gt-msg'
      msgInput.placeholder = '提交信息'
      const cbtns = el('div', 'gt-cbtns')
      const doCommitBtn = el('button', 'gt-abtn', '提交')
      const doPushBtn = el('button', 'gt-abtn sec', '推送')
      cbtns.append(doCommitBtn, doPushBtn)
      const hintLine = el('div', 'gt-hintline')
      commitBox.append(msgInput, cbtns, hintLine)
      commitBox.style.display = 'none'
      const cmpRow = mkRow(SVG.github, '比较分支')
      const cmpExt = el('span', 'chev')
      cmpExt.innerHTML = SVG.external
      cmpRow.r.append(cmpExt)
      // GitHub 区块（gh CLI 软依赖；标题展示 owner/repo，懒加载不进轮询）
      const ghCaps = el('div', 'gt-caps', 'GitHub')
      const prRow = mkRow(SVG.pr, 'Pull Requests')
      const prCnt = el('span', 'cnt', '—')
      const prChev = mkChev()
      prRow.r.append(prCnt, prChev)
      const prBox = el('div', 'gt-files')
      prBox.style.display = 'none'
      const isRow = mkRow(SVG.issue, 'Issues')
      const isCnt = el('span', 'cnt', '—')
      const isChev = mkChev()
      isRow.r.append(isCnt, isChev)
      const isBox = el('div', 'gt-files')
      isBox.style.display = 'none'
      const ghMsg = el('div', 'gt-hint')
      ghMsg.style.display = 'none'
      // 任务计划（约定位置扫到的 agent 计划文档；点击走软依赖预览链）
      const planCaps = el('div', 'gt-caps', '任务计划')
      const planList = el('div')
      const empty = el('div', 'gt-empty')
      body.append(envCaps, chRow.r, filesBox, locRow.r, brRow.r, cpRow.r, commitBox, cmpRow.r, ghCaps, prRow.r, prBox, isRow.r, isBox, ghMsg, planCaps, planList, empty)

      card.append(header, status, body)
      panel.append(card)
      document.body.append(panel)

      // flyout 容器（工作位置/分支选择器；面板左侧弹出；同面板挂 body 子树）
      const fly = el('div')
      fly.id = FLY_ID
      fly.style.display = 'none'
      document.body.append(fly)

      /* ---- 数据与行为 ---- */
      const api = (method, payload) => fetch(API + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      }).then(r => r.text()).then(t => JSON.parse(t))

      /* ---- 当前会话 / cwd（多窗口各跟随各的工作区） ----
       * 0.2.x 起「当前会话」不在 sessions 列表快照里：SessionListState 只有
       * ids/byId/phase/projectionsBySession（`current` 自 0.1.6-alpha.2 起被
       * 移除，选择归 ui-workspace 的私有 selection store）。故按可靠性三级
       * 取 id，任一级命中即用 byId 读 cwd：
       *   ① 列表快照的 current（≤0.1.5 老宿主遗留）；
       *   ② 侧栏当前会话行 [data-row-key^="session:"][aria-selected="true"]
       *      （ui-workspace Rows.tsx 的稳定 DOM 事实，切会话即时跟随）；
       *   ③ 选择持久值 localStorage['dsh.sessions.current']（selection store
       *      的 persist 名，形如 {sessionId}）。
       * 三级全空（hero/设置页/首次启动）→ null，面板走「等待工作区」空态；
       * 列表瞬时刷新造成的短暂取不到沿用上次解析结果，不闪空态。 */
      const sessionList = () => {
        try { return ctx.get('sessions')?.list?.getSnapshot?.() ?? null } catch { return null }
      }
      const currentSessionId = () => {
        const legacy = sessionList()?.current
        if (typeof legacy === 'string' && legacy !== '') return legacy
        try {
          const row = document.querySelector('[data-row-key^="' + SESSION_ROW_PREFIX + '"][aria-selected="true"]')
          const key = row === null ? null : row.getAttribute('data-row-key')
          if (typeof key === 'string' && key.length > SESSION_ROW_PREFIX.length) {
            return key.slice(SESSION_ROW_PREFIX.length)
          }
        } catch { /* 特殊文档态：静默降级到下一级 */ }
        try {
          const raw = window.localStorage.getItem(SESSION_STORE_KEY)
          if (raw !== null) {
            const saved = JSON.parse(raw)
            if (typeof saved?.sessionId === 'string' && saved.sessionId !== '') return saved.sessionId
          }
        } catch { /* 隐私模式/坏值：当作取不到 */ }
        return null
      }
      /** 上次成功解析的 {id, cwd}：瞬时取不到时粘性回退，不闪空态。 */
      let lastCwd = null
      const currentCwd = () => {
        const snap = sessionList()
        const id = currentSessionId()
        const cwd = id === null ? null : (snap?.byId?.[id]?.cwd ?? null)
        if (typeof cwd === 'string' && cwd !== '') {
          lastCwd = { id, cwd }
          return cwd
        }
        if (lastCwd !== null && (id === null || id === lastCwd.id)) return lastCwd.cwd
        return null
      }

      /** 在途序号：切会话/手动刷新并发时，旧响应不得覆盖新响应。 */
      let refreshSeq = 0
      const refresh = async () => {
        const seq = ++refreshSeq
        const cwd = effectiveCwd()
        if (cwd === null || cwd === '') {
          snapshot = EMPTY
        } else {
          try {
            snapshot = await api('snapshot', { cwd })
          } catch { return /* 网络/重启间隙：保旧快照 */ }
          if (seq !== refreshSeq) return /* 已有更新的请求在途：丢弃本次结果 */
        }
        render(snapshot)
        renderBadge()
        maybeLoadGh()
      }

      const schedule = () => {
        if (timer !== null) clearInterval(timer)
        timer = setInterval(() => { void refresh() }, open ? POLL_OPEN_MS : POLL_CLOSED_MS)
      }

      // 内容区右侧让位（面板开时给正文让出 PAD_W；W=0 清除）
      const setPad = (w) => {
        document.documentElement.style.setProperty('--dsh-git-inset', w > 0 ? w + 'px' : '0px')
        // 只缩中心列：原生右栏不再内缩——它与本浮层改成几何互避（见 panelRight）
        const cols = document.querySelectorAll('[class*="centerCol"]')
        for (const c of cols) {
          if (w > 0) c.style.paddingRight = w + 'px'
          else c.style.removeProperty('padding-right')
        }
      }

      /* ---- 与原生右边栏几何互避（展开左移 / 收起回右缘，非互斥收起） ----
       * 原生右栏是 AppFrame 的第三列轨道 [data-rightbar-col]：展开时它占掉帧右缘
       * 的 rightbarMax，收起时轨道宽 0（data-rightbar-collapsed）。本面板是
       * fixed 浮层，展开时贴右缘会整个压住它（旧版把右栏自身内缩，实测无效且
       * 会切掉其内容）。改按轨道**实测宽度**整体左移：拖拽调宽也跟随；收起即回
       * 右缘。全屏态（data-rightbar-fullscreen，右栏铺满帧）无处可避，维持右缘。
       * 窄窗兜底：至少给面板留 PANEL_W，免被挤出屏。 */
      const nativeRightbarService = () => {
        try {
          const sb = ctx.get('sidebarRight')
          if (sb === null || sb === undefined) return null
          if (typeof sb.isExpanded !== 'function' || typeof sb.toggleExpanded !== 'function') return null
          return sb
        } catch { return null }
      }
      /** 原生右栏（ui-sidebar-right）是否展开：服务优先，DOM 轨道宽度兜底。 */
      const nativeRightbarOpen = () => {
        const sb = nativeRightbarService()
        if (sb !== null) {
          try { return sb.isExpanded() === true } catch { /* 退回 DOM */ }
        }
        const col = document.querySelector(RIGHTBAR_COL_SEL)
        return col !== null && col.getBoundingClientRect().width > 1
      }
      /**
       * 收起/展开原生右栏（正向让位用）。
       * @returns 是否真的动了它（false = 无法控制 → 调用方退回几何互避）
       */
      const setNativeRightbar = (next) => {
        const sb = nativeRightbarService()
        if (sb === null) return false
        try {
          if (sb.isExpanded() !== next) sb.toggleExpanded()
          return true
        } catch { return false }
      }

      const panelRight = () => {
        const col = document.querySelector(RIGHTBAR_COL_SEL)
        if (col === null) return PANEL_MARGIN
        const frame = col.parentElement
        if (frame !== null && frame.hasAttribute('data-rightbar-fullscreen')) return PANEL_MARGIN
        const w = col.getBoundingClientRect().width
        if (!(w > 1)) return PANEL_MARGIN
        const desired = Math.round(w) + PANEL_MARGIN
        const limit = Math.max(PANEL_MARGIN, window.innerWidth - PANEL_W)
        return Math.min(desired, limit)
      }
      let lastRight = -1
      const applyGeometry = () => {
        const right = panelRight()
        if (right === lastRight) return
        lastRight = right
        panel.style.right = right + 'px'
      }

      const setOpen = (next) => {
        open = next
        panel.style.display = open ? '' : 'none'
        if (!open) {
          closeFly()
          commitOpen = false
          commitBox.style.display = 'none'
        }
        renderBadge()
        setPad(open ? PAD_W : 0)
        applyGeometry() // 展开前先按原生右栏实况落位（收起态也不影响）
        schedule()
        if (open) {
          // 正向让位：哪类侧栏开着就收哪类（收起沿会触发 observer，反向义务
          // yielded=false 无动作，无环）。收不动（老宿主无服务/DOM 控件）不留
          // 义务——那种情形交给几何互避兜底。
          if (sideYielded === null) {
            if (betterSidebarOpen() && setSidebarPanel(false)) sideYielded = 'better'
            else if (nativeRightbarOpen() && setNativeRightbar(false)) sideYielded = 'native'
          }
          void refresh()
        } else if (sideYielded !== null) {
          // 履约：手动关闭时把当初让位收起的侧栏开回（反向让位路径在 observer
          // 里已先清 sideYielded，不会误履约）
          const restore = sideYielded
          sideYielded = null
          if (restore === 'better') setSidebarPanel(true)
          else setNativeRightbar(true)
        }
      }

      /* ---- 互斥让位（双向；原生右栏 + better-sidebar 两源） ----
       * 反向：任一侧栏展开 → git 卡片收起；侧栏收起 → 履约恢复（仅「因让位
       *   而收起」才恢复，用户手动开头/关尾不参与义务）。
       * 正向：git 卡片开启 → 开着的侧栏收起避让；git 手动关闭 → 履约开回。
       * 原生右栏优先走 ctx.sidebarRight 服务（isExpanded / toggleExpanded）；
       * 服务缺席或不给控（老宿主）时正向不动它，退化为几何互避（panelRight
       * 按轨道实测宽度把浮层左移），届时两者至少不重叠。
       * 沿判定（翻转才动作）天然去重；host 缺席 = 插件未装视为关。 ---- */
      let yielded = false // 反向义务：git 因侧栏让位而收起（收起沿恢复）
      let sideYielded = null // 正向义务：因 git 开启而被收起的侧栏（'better' | 'native' | null）
      const betterSidebarOpen = () => {
        const host = document.querySelector('[data-dsh-better-sidebar]')
        if (host === null) return false
        return host.querySelector('[class*="panelHidden"]') === null
      }
      // 侧边栏开关（簇末枚恒为右侧面板，语义同 sidebar-cluster panelSrc；
      // 簇本体被代理按钮收纳 display:none，click 派发照常）
      const setSidebarPanel = (open) => {
        const cluster = document.querySelector('[data-dsh-panel-host] [class*="toggleCluster"]')
        const btns = cluster !== null
          ? Array.from(cluster.querySelectorAll('button[class*="toggleButton"]'))
          : []
        const btn = btns.length > 0 ? btns[btns.length - 1] : null
        if (btn !== null) btn.click()
        return btn !== null
      }
      let lastSidebarOpen = null // null = 初始态，不当沿
      /** 任一侧栏占用者是否展开（原生右栏 / better-sidebar）。 */
      const anySideOpen = () => betterSidebarOpen() || nativeRightbarOpen()
      const applySidebarMutual = () => {
        const sbOpen = anySideOpen()
        if (lastSidebarOpen === null) { lastSidebarOpen = sbOpen; return }
        if (sbOpen === lastSidebarOpen) return
        lastSidebarOpen = sbOpen
        if (sbOpen) {
          if (open) {
            sideYielded = null // 正向义务随反向让位解除，防交叉残留
            yielded = true
            setOpen(false)
          }
        } else if (yielded) {
          yielded = false
          setOpen(true)
        }
      }

      /* ---- 设置页联动：进设置页自动收起（仅自动收起带恢复义务），
         返回工作区履约展开。检测锚与 settings-page.ts 同源：
         [class*="_overlay"] > [class*="_panel"][role="dialog"] 是
         SettingsRoot 专属组合（ui-primitives Modal 结构不同不误伤）。
         手动开关不参与义务；关闭路径（Escape/close/返回按钮）都是
         dialog 卸载，同一条沿覆盖。 ---- */
      let settingsYielded = false // 设置页义务：因进设置而收起（退出沿恢复）
      let lastSettingsOpen = null // null = 初始态，不当沿
      const settingsOpen = () =>
        document.querySelector('[class*="_overlay"] > [class*="_panel"][role="dialog"]') !== null
      const applySettingsYield = () => {
        const so = settingsOpen()
        if (lastSettingsOpen === so) return
        lastSettingsOpen = so
        if (so) {
          if (open) { settingsYielded = true; setOpen(false) }
        } else if (settingsYielded) {
          settingsYielded = false
          setOpen(true)
        }
      }
      /* 会话切换跟随：行内选中态（aria-selected）是当前会话的唯一 DOM 事实
       * （ui-workspace Rows.tsx），翻转即立即重拉，不等下一拍轮询。 */
      let lastSessionId = null
      const applySessionFollow = () => {
        const id = currentSessionId()
        if (id === lastSessionId) return
        lastSessionId = id
        void refresh()
      }
      const applyBodyMutations = () => { applySidebarMutual(); applySettingsYield() }
      // 具名 observer：卸载收口需要 disconnect（运行时停用/HMR）。只把
      // aria-selected 当「会话切换」信号；class 抖动（流式渲染高频）不进
      // 跟随判定，避免每条消息都触发一次重拉。
      const bodyMo = new MutationObserver((records) => {
        for (const rec of records) {
          if (rec.type !== 'attributes') continue
          if (rec.attributeName === 'aria-selected') { applySessionFollow(); continue }
          // 原生右栏轨道/全屏态翻转：立即重算浮层落位（不等 500ms 心跳）
          if (rec.attributeName === 'data-rightbar-collapsed' || rec.attributeName === 'data-rightbar-fullscreen') {
            applyGeometry()
          }
        }
        applyBodyMutations()
      })
      bodyMo.observe(document.body, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'aria-selected', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'],
      })

      /* ---- 计划点击预览（0.2.x 三级链） ----
       * ① **原生右栏文档预览**（首选）：ctx.sidebarRight.openResource(address)。
       *    address 用 dsh-resource://file/… 语法（ui-sidebar-documentpreview 的
       *    pattern 收 dsh-resource://file/**）：路径在会话工作区内 → session 域
       *    （与 shell 里点文件引用同一形态）；在区外（如 worktree 覆盖）或取不到
       *    会话 → absolute 域。openResource 会在同一步展开右栏，本面板按互斥让位
       *    （data-rightbar-collapsed 沿）自动收起，预览关掉后履约回开——不再弹
       *    本机默认应用。
       * ② KCoder 老宿主 betterSidebar editor tab（该产品已退役该面板，保留兼容）；
       * ③ server open-plan → 系统默认应用（末端兜底，仅前两级都不可用时走）。 */
      const fileAddressOf = (absPath) => {
        const encode = (seg) => encodeURIComponent(seg).replace(/%3A/gi, ':')
        const normalized = String(absPath).replace(/\\/g, '/')
        const cwd = effectiveCwd()
        const id = currentSessionId()
        const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : ''
        if (id !== null && root !== '' && normalized.startsWith(root + '/')) {
          const rel = normalized.slice(root.length + 1)
          return 'dsh-resource://file/session/' + encode(id) + '/' + rel.split('/').map(encode).join('/')
        }
        const unc = normalized.startsWith('//')
        const body = normalized.replace(/^\/+/, '')
        return 'dsh-resource://file/absolute/' + (unc ? '/' : '') + body.split('/').map(encode).join('/')
      }
      const openInNativeSidebar = (plan) => {
        let sidebar = null
        try { sidebar = ctx.get('sidebarRight') ?? null } catch { return false }
        if (sidebar === null || typeof sidebar.openResource !== 'function') return false
        try {
          sidebar.openResource(fileAddressOf(plan.path))
          return true
        } catch { return false /* 地址无类型认领/右栏不可用 → 落下一级 */ }
      }
      const openPlan = (plan) => {
        if (openInNativeSidebar(plan)) return
        let sidebar = null
        try { sidebar = ctx.get('betterSidebar') ?? null } catch { sidebar = null }
        if (sidebar !== null && typeof sidebar.openTab === 'function') {
          sidebar.openTab({ type: 'editor', title: plan.title, path: plan.path, id: 'editor:' + plan.path })
          // 预览落地面板区：主动让位（面板已展开时无展开沿，沿判定覆盖不到）
          if (betterSidebarOpen()) { yielded = true; setOpen(false) }
          return
        }
        void api('open-plan', { path: plan.path }).catch(() => { /* 回退链末端失败静默 */ })
      }

      /* ---- 环境信息行为（Codex 风格：worktree/分支/提交/推送/比较） ---- */
      const effectiveCwd = () => cwdOverride ?? currentCwd()
      /** 待提交变更总数（staged + changed + untracked）。 */
      const totalChanges = (s) => s.staged + s.changed + s.untracked
      const baseName = (p) => {
        const segs = String(p).split('/').filter(Boolean)
        return segs.length > 0 ? (segs[segs.length - 1] ?? p) : p
      }

      const closeFly = () => { flyMode = null; fly.style.display = 'none'; fly.replaceChildren(); ghHint('') }
      const positionFly = (anchor) => {
        const pr = panel.getBoundingClientRect()
        const ar = anchor.getBoundingClientRect()
        fly.style.right = (window.innerWidth - pr.left + 8) + 'px'
        fly.style.top = Math.max(8, Math.min(ar.top - 8, window.innerHeight - 340)) + 'px'
        fly.style.display = 'flex'
      }
      const flyRow = (icon, label, onClick, checked) => {
        const r = el('button', 'fly-row')
        const ic = el('span')
        ic.innerHTML = icon
        const lb = el('span', 'lb', label)
        r.append(ic, lb)
        if (checked) {
          const ck = el('span', 'ck')
          ck.innerHTML = SVG.check
          r.append(ck)
        }
        r.onclick = (ev) => { ev.stopPropagation(); onClick() }
        return r
      }

      // 工作位置（worktree 清单；选中切换面板目标，只读视图切换）
      const openLocationFly = (anchor) => {
        flyMode = 'location'
        fly.replaceChildren()
        fly.append(el('div', 'fly-cap', '工作位置'))
        const list = el('div', 'fly-list')
        const wts = snapshot.worktrees ?? []
        const active = cwdOverride ?? snapshot.root
        if (wts.length === 0) {
          list.append(flyRow(SVG.laptop, '本地', () => { cwdOverride = null; closeFly(); void refresh() }, true))
        }
        for (const wt of wts) {
          const isMain = snapshot.root !== null && wt.path === snapshot.root
          const label = (isMain ? '本地 · ' : '') + (wt.branch ?? '(detached)') + ' · ' + baseName(wt.path)
          list.append(flyRow(SVG.laptop, label, () => {
            cwdOverride = isMain ? null : wt.path
            closeFly()
            void refresh()
          }, wt.path === active))
        }
        fly.append(list)
        positionFly(anchor)
      }

      // 分支选择器（搜索 + 列表✓ + 创建并检出新分支）
      const openCreateFly = (anchor) => {
        flyMode = 'create'
        fly.replaceChildren()
        fly.append(el('div', 'fly-cap', '创建并检出新分支'))
        const input = document.createElement('input')
        input.className = 'fly-search'
        input.placeholder = '分支名'
        const btn = el('button', 'gt-abtn', '创建并检出')
        const foot = el('div', 'fly-foot')
        foot.append(btn)
        fly.append(input, foot)
        btn.onclick = (ev) => { ev.stopPropagation(); void doCreateBranch(input.value) }
        input.onkeydown = (ev) => { if (ev.key === 'Enter') void doCreateBranch(input.value) }
        positionFly(anchor)
        input.focus()
      }
      const openBranchFly = (anchor) => {
        flyMode = 'branch'
        fly.replaceChildren()
        const search = document.createElement('input')
        search.className = 'fly-search'
        search.placeholder = '搜索 ' + (snapshot.workspace ?? '') + ' 分支'
        const cap = el('div', 'fly-cap', '分支')
        const list = el('div', 'fly-list')
        const div = el('div', 'fly-div')
        const createRow = flyRow(SVG.plus, '创建并检出新分支…', () => { openCreateFly(anchor) })
        fly.append(search, cap, list, div, createRow)
        /** 删除当前 flyout 行内局部状态：idle（×）→ confirm → force。 */
        const mkZone = (b, doDelete) => {
          const zone = el('span', 'fly-zone')
          const setConfirm = (force) => {
            zone.className = 'fly-zone confirm'
            zone.replaceChildren()
            const tag = el('span', 'fly-ctag', force ? '未合并，仍删除？' : '删除分支？')
            const yes = el('span', 'fly-del danger', force ? '强制删除' : '删除')
            yes.onclick = (ev) => { ev.stopPropagation(); void doDelete(b, force, () => setConfirm(true)) }
            const no = el('span', 'fly-del', '取消')
            no.onclick = (ev) => { ev.stopPropagation(); setIdle() }
            zone.append(tag, yes, no)
          }
          const setIdle = () => {
            zone.className = 'fly-zone'
            zone.replaceChildren()
            const del = el('span', 'fly-del')
            del.innerHTML = SVG.x
            del.title = '删除分支'
            del.onclick = (ev) => { ev.stopPropagation(); setConfirm(false) }
            zone.append(del)
          }
          setIdle()
          return zone
        }
        /** delete-branch：成功后刷新分支缓存并重填列表；
         *  未合并（merged 标记）时回调升级为强制确认。 */
        const doDelete = async (b, force, onMerged) => {
          if (busyAction) return
          busyAction = true
          let done = false
          try {
            const res = await api('delete-branch', { cwd: effectiveCwd(), name: b, force: force === true })
            if (res.ok) { done = true; actionHint('已删除 ' + b) }
            else if (res.merged === true && !force) { busyAction = false; onMerged(); return }
            else actionHint(res.error ?? '删除失败')
          } catch { actionHint('网络异常') }
          busyAction = false
          if (done) {
            const cwd = effectiveCwd()
            if (cwd !== null && cwd !== '') {
              try { branchCache = await api('branches', { cwd }) } catch { /* 保留旧缓存 */ }
            }
            if (flyMode === 'branch') fill(search.value.trim())
          }
          void refresh()
        }
        const fill = (filter) => {
          list.replaceChildren()
          const bs = (branchCache?.branches ?? []).filter(b => filter === '' || b.toLowerCase().includes(filter.toLowerCase()))
          if (bs.length === 0) list.append(el('div', 'fly-none', '无匹配分支'))
          for (const b of bs) {
            const isCur = b === branchCache?.current
            const row = flyRow(SVG.branch, b, () => { void doCheckout(b) }, isCur)
            if (!isCur) row.append(mkZone(b, doDelete)) // 当前分支不可删
            list.append(row)
          }
        }
        search.oninput = () => { fill(search.value.trim()) }
        positionFly(anchor)
        search.focus()
        void (async () => {
          const cwd = effectiveCwd()
          if (cwd === null || cwd === '') return
          try { branchCache = await api('branches', { cwd }) } catch { return }
          if (flyMode === 'branch') fill(search.value.trim())
        })()
      }

      const actionHint = (text) => { hintMsg = text; hintLine.textContent = text }
      const doCheckout = async (branch) => {
        if (busyAction) return
        busyAction = true
        try {
          const res = await api('checkout', { cwd: effectiveCwd(), branch })
          if (res.ok) { actionHint(''); closeFly() } else { actionHint(res.error ?? '检出失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doCreateBranch = async (name) => {
        if (busyAction) return
        busyAction = true
        try {
          const res = await api('create-branch', { cwd: effectiveCwd(), name })
          if (res.ok) { actionHint(''); closeFly() } else { actionHint(res.error ?? '创建失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doCommit = async () => {
        if (busyAction) return
        const message = msgInput.value.trim()
        if (message === '') { actionHint('请输入提交信息'); return }
        busyAction = true
        actionHint('提交中…')
        try {
          const res = await api('commit', { cwd: effectiveCwd(), message })
          if (res.ok) {
            msgInput.value = ''
            actionHint('已提交')
            commitOpen = false
            commitBox.style.display = 'none'
          } else { actionHint(res.error ?? '提交失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doPush = async () => {
        if (busyAction) return
        busyAction = true
        actionHint('推送中…')
        try {
          const res = await api('push', { cwd: effectiveCwd() })
          if (res.ok) {
            actionHint('已推送')
            commitOpen = false
            commitBox.style.display = 'none'
          } else { actionHint(res.error ?? '推送失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doCompare = async () => {
        if (busyAction) return
        busyAction = true
        try { await api('open-compare', { cwd: effectiveCwd() }) } catch { /* 静默 */ }
        busyAction = false
      }

      /* ---- GitHub 区块（gh CLI 软依赖；懒加载，不参与轮询） ---- */
      const ghHint = (text) => {
        ghMsg.textContent = text
        ghMsg.style.display = text !== '' && snapshot.isRepo ? '' : 'none'
      }
      const updateGhCounts = () => {
        const st = ghCache?.state ?? null
        const mark = st === 'ok' ? null : st === 'loading' ? '…' : st === 'err' ? '!' : '—'
        prCnt.textContent = mark ?? String(ghCache.data?.prs.length ?? 0)
        isCnt.textContent = mark ?? String(ghCache.data?.issues.length ?? 0)
      }
      const loadGh = async () => {
        const cwd = effectiveCwd()
        if (cwd === null || cwd === '' || !snapshot.isRepo) return
        ghCache = { state: 'loading' }
        renderGh()
        try {
          const res = await api('gh-list', { cwd })
          ghCache = res?.ok === true
            ? { state: 'ok', data: res }
            : { state: 'err', error: res?.error ?? 'gh 调用失败' }
        } catch { ghCache = { state: 'err', error: '网络异常' } }
        renderGh()
      }
      /** root 变化（worktree/会话切换）即失效重拉；开板且是仓库才拉。 */
      const maybeLoadGh = () => {
        if (!open || !snapshot.isRepo) return
        if (snapshot.root !== lastGhRoot) { lastGhRoot = snapshot.root; ghCache = null }
        if (ghCache === null) void loadGh()
      }
      const canCreatePr = () => snapshot.isRepo
        && snapshot.branch !== null && snapshot.defaultBranch !== null
        && snapshot.branch !== snapshot.defaultBranch
      const doMergePr = async (pr) => {
        if (busyAction) return
        busyAction = true
        try {
          const res = await api('gh-merge-pr', { cwd: effectiveCwd(), number: pr.number, method: 'squash' })
          ghHint(res.ok === true ? '已合并 #' + pr.number : (res.error ?? '合并失败'))
        } catch { ghHint('网络异常') }
        busyAction = false
        void loadGh()
        void refresh()
      }
      /** 合并行内二次确认（同分支删除 zone 语义：合并 → 确认/取消）。 */
      const mkMergeZone = (pr) => {
        const zone = el('span')
        const confirm2 = () => {
          zone.replaceChildren()
          const q = el('span', 'tag', 'Squash 合并?')
          const yes = el('span', 'act danger', '确认')
          yes.onclick = (ev) => { ev.stopPropagation(); void doMergePr(pr) }
          const no = el('span', 'act', '取消')
          no.onclick = (ev) => { ev.stopPropagation(); idle() }
          zone.append(q, yes, no)
        }
        const idle = () => {
          zone.replaceChildren()
          const a = el('span', 'act', '合并')
          a.title = 'Squash 合并 #' + pr.number
          a.onclick = (ev) => { ev.stopPropagation(); confirm2() }
          zone.append(a)
        }
        idle()
        return zone
      }
      const buildPrBox = () => {
        prBox.replaceChildren()
        const st = ghCache?.state
        if (st === 'loading') { prBox.append(el('div', 'fly-none', '加载中…')); return }
        if (st === 'err') {
          prBox.append(el('div', 'fly-none', ghCache.error ?? 'gh 调用失败'))
          prBox.append(el('div', 'gt-hint', '需要 gh CLI（安装后 gh auth login）'))
          const retry = el('button', 'gt-file')
          retry.append(el('span', 'st a', '↻'), el('span', 'fp', '重试'))
          retry.onclick = () => { ghCache = null; void loadGh() }
          prBox.append(retry)
          return
        }
        if (st !== 'ok') return
        const prs = ghCache.data?.prs ?? []
        if (prs.length === 0) prBox.append(el('div', 'fly-none', '无开放 PR'))
        for (const pr of prs) {
          const row = el('button', 'gt-file')
          row.title = '#' + pr.number + ' ' + pr.title + (pr.head !== '' ? ' · ' + pr.head : '') + (pr.author !== null ? ' · @' + pr.author : '')
          row.append(el('span', 'num', '#' + pr.number), el('span', 'fp', pr.title === '' ? '(无标题)' : pr.title))
          if (pr.current) row.append(el('span', 'tag', '当前'))
          if (!pr.isDraft) row.append(mkMergeZone(pr))
          else row.append(el('span', 'tag', '草稿'))
          row.onclick = () => { if (pr.url !== null) void api('open-url', { url: pr.url }).catch(() => {}) }
          prBox.append(row)
        }
        // footer：创建 PR（当前分支 ≠ 默认分支才有意义）
        const can = canCreatePr()
        const cr = el('button', 'gt-file' + (can ? '' : ' off'))
        cr.title = can
          ? '当前分支创建 PR → ' + snapshot.defaultBranch
          : '当前分支即默认分支（或 detached），无法创建 PR'
        cr.append(el('span', 'st a', '+'), el('span', 'fp', '创建 PR…（' + (snapshot.branch ?? '?') + ' → ' + (snapshot.defaultBranch ?? '?') + '）'))
        cr.onclick = () => {
          if (!canCreatePr()) { ghHint('当前分支即默认分支，无法创建 PR'); return }
          openGhPrFly(prRow.r)
        }
        prBox.append(cr)
      }
      const buildIssueBox = () => {
        isBox.replaceChildren()
        const st = ghCache?.state
        if (st === 'loading') { isBox.append(el('div', 'fly-none', '加载中…')); return }
        if (st === 'err') {
          isBox.append(el('div', 'fly-none', ghCache.error ?? 'gh 调用失败'))
          return
        }
        if (st !== 'ok') return
        const issues = ghCache.data?.issues ?? []
        if (issues.length === 0) isBox.append(el('div', 'fly-none', '无开放 Issue'))
        for (const it of issues) {
          const row = el('button', 'gt-file')
          row.title = '#' + it.number + ' ' + it.title + (it.author !== null ? ' · @' + it.author : '')
          row.append(el('span', 'num', '#' + it.number), el('span', 'fp', it.title === '' ? '(无标题)' : it.title))
          row.onclick = () => { if (it.url !== null) void api('open-url', { url: it.url }).catch(() => {}) }
          isBox.append(row)
        }
        const cr = el('button', 'gt-file')
        cr.title = '新建 Issue'
        cr.append(el('span', 'st a', '+'), el('span', 'fp', '新建 Issue…'))
        cr.onclick = () => { openGhIssueFly(isRow.r) }
        isBox.append(cr)
      }
      const renderGh = () => {
        ghCaps.textContent = ghCache?.state === 'ok' && ghCache.data?.repo ? ghCache.data.repo : 'GitHub'
        updateGhCounts()
        buildPrBox()
        buildIssueBox()
      }
      const doCreatePr = async (title, desc) => {
        if (busyAction) return
        if (String(title ?? '').trim() === '') { ghHint('请输入 PR 标题'); return }
        busyAction = true
        try {
          const res = await api('gh-create-pr', { cwd: effectiveCwd(), title: String(title).trim(), body: String(desc ?? '').trim() })
          if (res.ok === true) { closeFly(); ghHint('已创建 PR') } else { ghHint(res.error ?? '创建 PR 失败') }
        } catch { ghHint('网络异常') }
        busyAction = false
        void loadGh()
        void refresh()
      }
      const doCreateIssue = async (title, desc) => {
        if (busyAction) return
        if (String(title ?? '').trim() === '') { ghHint('请输入 Issue 标题'); return }
        busyAction = true
        try {
          const res = await api('gh-create-issue', { cwd: effectiveCwd(), title: String(title).trim(), body: String(desc ?? '').trim() })
          if (res.ok === true) { closeFly(); ghHint('已新建 Issue') } else { ghHint(res.error ?? '新建 Issue 失败') }
        } catch { ghHint('网络异常') }
        busyAction = false
        void loadGh()
      }
      const openGhPrFly = (anchor) => {
        flyMode = 'gh-pr'
        fly.replaceChildren()
        fly.append(el('div', 'fly-cap', '创建 PR：' + (snapshot.branch ?? '?') + ' → ' + (snapshot.defaultBranch ?? '?')))
        const title = document.createElement('input')
        title.className = 'fly-search'
        title.placeholder = 'PR 标题'
        const desc = document.createElement('textarea')
        desc.className = 'fly-msg'
        desc.placeholder = '描述（可空）'
        const btn = el('button', 'gt-abtn', '创建 PR')
        const foot = el('div', 'fly-foot')
        foot.append(btn)
        fly.append(title, desc, foot)
        const go = () => { void doCreatePr(title.value, desc.value) }
        btn.onclick = (ev) => { ev.stopPropagation(); go() }
        title.onkeydown = (ev) => { if (ev.key === 'Enter') go() }
        positionFly(anchor)
        title.focus()
      }
      const openGhIssueFly = (anchor) => {
        flyMode = 'gh-issue'
        fly.replaceChildren()
        fly.append(el('div', 'fly-cap', '新建 Issue'))
        const title = document.createElement('input')
        title.className = 'fly-search'
        title.placeholder = 'Issue 标题'
        const desc = document.createElement('textarea')
        desc.className = 'fly-msg'
        desc.placeholder = '描述（可空）'
        const btn = el('button', 'gt-abtn', '创建')
        const foot = el('div', 'fly-foot')
        foot.append(btn)
        fly.append(title, desc, foot)
        const go = () => { void doCreateIssue(title.value, desc.value) }
        btn.onclick = (ev) => { ev.stopPropagation(); go() }
        title.onkeydown = (ev) => { if (ev.key === 'Enter') go() }
        positionFly(anchor)
        title.focus()
      }

      // 变更文件点击 → better-sidebar editor 预览（软依赖；缺席不动作）
      const openFile = (path) => {
        let sidebar = null
        try { sidebar = ctx.get('betterSidebar') ?? null } catch { sidebar = null }
        if (sidebar !== null && typeof sidebar.openTab === 'function') {
          sidebar.openTab({ type: 'editor', title: baseName(path), path, id: 'editor:' + path })
          if (betterSidebarOpen()) { yielded = true; setOpen(false) }
        }
      }

      // 行事件
      chRow.r.onclick = () => { changesOpen = !changesOpen; render(snapshot) }
      locRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (flyMode === 'location') closeFly(); else openLocationFly(locRow.r)
      }
      brRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (flyMode === 'branch' || flyMode === 'create') closeFly(); else openBranchFly(brRow.r)
      }
      cpRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (!(totalChanges(snapshot) > 0 || (snapshot.ahead > 0 && snapshot.hasUpstream))) return
        commitOpen = !commitOpen
        commitBox.style.display = commitOpen ? '' : 'none'
        actionHint('')
      }
      cmpRow.r.onclick = () => { if (!cmpRow.r.classList.contains('dim')) void doCompare() }
      prRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (flyMode === 'gh-pr' || flyMode === 'gh-issue') closeFly()
        prOpen = !prOpen
        if (prOpen) { if (ghCache === null) void loadGh(); else renderGh() }
        render(snapshot)
      }
      isRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (flyMode === 'gh-pr' || flyMode === 'gh-issue') closeFly()
        issueOpen = !issueOpen
        if (issueOpen) { if (ghCache === null) void loadGh(); else renderGh() }
        render(snapshot)
      }
      doCommitBtn.onclick = () => { void doCommit() }
      doPushBtn.onclick = () => { void doPush() }

      // flyout 外点击关闭（行自身点击由 onclick 接管切换）；具名监听供卸载移除
      const onDocMouseDown = (ev) => {
        if (flyMode === null) return
        if (fly.contains(ev.target)) return
        if (ev.target instanceof Element && ev.target.closest('#' + PANEL_ID + ' .gt-row') !== null) return
        closeFly()
      }
      const onDocKeyDown = (ev) => { if (ev.key === 'Escape') closeFly() }
      document.addEventListener('mousedown', onDocMouseDown)
      document.addEventListener('keydown', onDocKeyDown)

      /* ---- 渲染（git.ts render 平移） ---- */
      function render(s) {
        wName.textContent = s.workspace ?? '—'
        la.textContent = '+' + s.added
        ld.textContent = '\u2212' + s.removed
        const setPill = (p, v) => { p.querySelector('b').textContent = String(v) }
        setPill(pStaged, s.staged)
        setPill(pChanged, s.changed)
        setPill(pUntracked, s.untracked)
        // 环境信息行
        chCnt.textContent = String(s.staged + s.changed + s.untracked)
        chRow.r.classList.toggle('dim', !s.isRepo)
        chRow.r.dataset.open = changesOpen && s.isRepo ? '1' : '0'
        locRow.lb.textContent = cwdOverride !== null ? baseName(cwdOverride) : '本地'
        locRow.r.classList.toggle('dim', !s.isRepo)
        brRow.lb.textContent = s.branch ?? (s.isRepo ? '(detached)' : '—')
        brRow.r.classList.toggle('dim', !s.isRepo)
        cpRow.r.classList.toggle('dim', !(s.isRepo && (totalChanges(s) > 0 || (s.ahead > 0 && s.hasUpstream))))
        cpRow.lb.textContent = s.hasUpstream && s.ahead > 0
          ? '提交或推送（' + s.ahead + ' 待推送）'
          : '提交或推送'
        cmpRow.r.classList.toggle('dim', !(s.isRepo && s.remoteUrl !== null && s.defaultBranch !== null && s.branch !== null))
        // GitHub 区块（内容只在 loadGh/展开时重建，轮询 render 不碰，
        // 防止 15s 刷新打断合并确认等行内交互态）
        ghCaps.style.display = s.isRepo ? '' : 'none'
        prRow.r.classList.toggle('dim', !s.isRepo)
        isRow.r.classList.toggle('dim', !s.isRepo)
        prBox.style.display = prOpen && s.isRepo ? '' : 'none'
        isBox.style.display = issueOpen && s.isRepo ? '' : 'none'
        ghMsg.style.display = ghMsg.textContent !== '' && s.isRepo ? '' : 'none'
        updateGhCounts()
        doCommitBtn.disabled = !(totalChanges(s) > 0) || busyAction
        doPushBtn.disabled = !(s.hasUpstream && s.ahead > 0) || busyAction
        hintLine.textContent = hintMsg
        // 变更文件列表（展开态重建）
        filesBox.style.display = changesOpen && s.isRepo ? '' : 'none'
        if (changesOpen && s.isRepo) {
          filesBox.replaceChildren()
          if (s.files.length === 0) filesBox.append(el('div', 'fly-none', '无变更'))
          for (const f of s.files) {
            const fr = el('button', 'gt-file')
            fr.title = f.path
            const code = f.untracked ? 'U' : (f.x !== ' ' && f.x !== '?' ? f.x : (f.y !== ' ' ? f.y : 'M'))
            const cls = f.untracked ? 'u' : (code === 'A' ? 'a' : (code === 'D' ? 'd' : 'm'))
            fr.append(el('span', 'st ' + cls, code), el('span', 'fp', f.path))
            if (f.added !== null) fr.append(el('span', 'ln', '+' + f.added + ' \u2212' + f.removed))
            fr.onclick = () => { openFile(f.path) }
            filesBox.append(fr)
          }
          if (s.filesTruncated) filesBox.append(el('div', 'gt-hint', '变更过多，仅显示前 200 条'))
        }
        planList.replaceChildren()
        const hasPlans = s.plans.length > 0
        for (const p of s.plans) {
          const row = el('button', 'gt-plan')
          row.title = p.path
          const ico = el('span')
          ico.innerHTML = SVG.plan
          row.append(ico, el('span', 't', p.title), el('span', 'w', p.when))
          row.onclick = () => { openPlan(p) }
          planList.append(row)
        }
        empty.replaceChildren()
        if (s.error !== null) {
          empty.append(el('div', '', s.error))
        } else if (s.workspace === null) {
          empty.append(el('div', '', '等待工作区…'))
        } else if (!s.isRepo) {
          empty.append(el('div', '', '「' + s.workspace + '」不是 git 仓库'))
        } else if (!hasPlans) {
          empty.append(el('div', '', '暂无任务计划文档'))
          empty.append(el('div', 'gt-hint', '约定位置（递归任意层级）：plans/ · .plans/ · plan.md'))
        }
        const hasEmpty = empty.childNodes.length > 0
        empty.style.display = hasEmpty ? '' : 'none'
        planCaps.style.display = hasPlans ? '' : 'none'
        planList.style.display = hasPlans ? '' : 'none'
      }

      /* ---- 徽章/按钮态（PAGE_JS __dshGitBadge 平移，本插件自绘） ---- */
      function renderBadge() {
        const btn = document.getElementById(BTN_ID)
        if (btn === null) return
        const s = snapshot
        btn.classList.toggle('dim', s.isRepo !== true)
        btn.dataset.on = open ? '1' : '0'
        const delta = s.isRepo === true ? s.added + s.removed : 0
        let bdg = btn.querySelector('.bdg')
        if (delta > 0) {
          if (bdg === null) {
            bdg = document.createElement('span')
            bdg.className = 'bdg'
            btn.append(bdg)
          }
          bdg.textContent = ''
          const a = document.createElement('span')
          a.className = 'a'
          a.textContent = '+' + s.added
          const d = document.createElement('span')
          d.className = 'd'
          d.textContent = '\u2212' + s.removed
          bdg.append(a, d)
        } else if (bdg !== null) {
          bdg.remove()
        }
      }

      /* ---- 开关按钮锚点链（纯 DOM，不引入上游 slot 依赖） ----
       * 锚点 1（首选）：[data-slot="conversation.session.header.corner"]
       *   ——会话头右上角席位（slot 工具化 DOM，display:contents 包装），
       *   兜底选择器 [data-conversation-header-corner]；行内 28px、与邻居
       *   icon 按钮齐平、no-drag、色随头行 currentColor。
       * 锚点 2（兜底）：#__dsh_desktop_titlebar——KCoder/QiLin 桌面壳主进程
       *   注入（theme-watcher / titlebar.mjs）的自绘标题栏带；hero/设置页无
       *   会话头时按钮回落到带上（固定 right:108px 绝对定位）。
       * v1.0.x 只认锚点 2：原生 dsh 壳没有该元素 → 按钮永不出现（面板不可达）。
       * 会话头仅会话页渲染（hero/设置页无 corner）→ 按钮随路由在两种锚点间
       *   迁移属预期；500ms 巡逻负责落位、迁位与整表重写后的自愈。 ---- */
      const cornerHost = () =>
        document.querySelector('[data-slot="' + CORNER_SLOT + '"]')
        ?? document.querySelector('[data-conversation-header-corner]')
      /* 锚点优先级：会话头 corner 优先，标题栏带仅作兜底。
       * 理由（2026-10-10 真机）：KCoder 桌面壳把会话页头**覆盖进**自绘标题栏
       * 同一条 48px 带（页头 z 2147483647 > 条 z 2147483646），带内右侧已被
       * 原生按钮占位（本地编辑器选择 / 远程 SSH）。标题栏位形是固定
       * right:108px 的绝对定位，会压住它们；corner 是会话头自己的行内末席
       * （页头排布已为右侧原生按钮带留出空间），既不重叠也不吃别家按钮。 */
      const preferredHost = () => {
        const corner = cornerHost()
        if (corner !== null) return { host: corner, corner: true }
        const bar = document.getElementById(TITLEBAR_ID)
        if (bar !== null) return { host: bar, corner: false }
        return null
      }
      const injectBtn = () => {
        const pick = preferredHost()
        if (pick === null) return false
        let btn = document.getElementById(BTN_ID)
        let fresh = false
        if (btn === null) {
          btn = document.createElement('button')
          btn.id = BTN_ID
          btn.title = 'git 工作区'
          btn.innerHTML = SVG.branch
          btn.onclick = () => { yielded = false; settingsYielded = false; setOpen(!open) } // 手动清义务
          pick.host.append(btn)
          fresh = true
        } else if (btn.parentElement !== pick.host) {
          pick.host.append(btn) // 锚点迁移（会话页↔hero/设置页、宿主整表重写）
          fresh = true
        }
        // 位形随锚点：corner 走 .gt-corner（行内 28px），标题栏带绝对定位。
        // 巡逻只在按钮新建/迁位时重绘徽章——500ms 心跳不该重建 DOM。
        if (btn.classList.contains('gt-corner') !== pick.corner) {
          btn.classList.toggle('gt-corner', pick.corner)
          fresh = true
        }
        if (fresh) renderBadge()
        return true
      }
      // 具名常驻自愈轮询：卸载收口需要 clearInterval（运行时停用/HMR）。
      // 兼作几何跟随：原生右栏拖拽调宽只改轨道宽度、无属性事件，靠这一拍实测。
      const keepAlive = setInterval(() => {
        injectBtn()
        if (open) applyGeometry()
        applySidebarMutual() // 沿判定幂等：服务侧翻转（无 DOM 属性事件）也跟得上
      }, 500)

      closeBtn.onclick = () => { yielded = false; settingsYielded = false; setOpen(false) } // 手动清义务
      refreshBtn.onclick = () => { ghCache = null; void refresh() }

      // 开合 API（外部编排入口）
      window.__dshGitPanelOpen = () => { if (!open) { yielded = false; settingsYielded = false; setOpen(true) } }
      window.__dshGitPanelToggle = () => { yielded = false; settingsYielded = false; setOpen(!open) }

      // 启动：收起态 + 降频轮询（徽章保活），首拉立即
      void refresh()
      schedule()

      /* ---- 卸载收口（运行时停用/HMR：轮询/监听/注入 DOM 全量还原，
       * 布局让位清零，Wired 守卫复位以便重挂载） ---- */
      const teardown = () => {
        clearInterval(timer)
        clearInterval(keepAlive)
        bodyMo.disconnect()
        document.removeEventListener('mousedown', onDocMouseDown)
        document.removeEventListener('keydown', onDocKeyDown)
        try { setPad(0) } catch { /* noop */ }
        document.documentElement.style.removeProperty('--dsh-git-inset')
        panel.remove()
        fly.remove()
        style.remove()
        const btn = document.getElementById(BTN_ID)
        if (btn !== null) btn.remove()
        delete window.__dshGitPanelOpen
        delete window.__dshGitPanelToggle
        delete window.__dshKcGitWired
      }
      if (typeof ctx.effect === 'function') {
        // client-modules 工厂 ctx：停用/热替换时随 fiber 调用 disposer。
        ctx.effect(() => teardown, 'dsh-git-panel: client wiring')
      }
    }

    return exports
  },
})
