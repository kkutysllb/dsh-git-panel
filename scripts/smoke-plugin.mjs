#!/usr/bin/env node
/**
 * 插件形态冒烟（node scripts/smoke-plugin.mjs）——npm publish 前由
 * prepack 自动执行，任何 FAIL 中断发布。
 *
 * 校验面：package.json 契约（name/version/main/dsh.bundle.patch/
 * exports["./client"]）、产物在位（entry/client/[]/）、模块
 * id 注册（__ModuleLoader__.load({id})）、cordis.patch.yml 的 name
 * 指向、旧名/旧锚点零残留。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = '@dsh-external/dsh-git-panel'
const HAS_CLIENT = true
const INTACT = []
const KEEP_LEGACY = [] // 跨层持久化协议锚点（豁免旧名残留检查）

const src = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null)

const checks = []
const ok = (name, pass, detail = '') => checks.push([name, pass, detail])

// 1) package.json 契约
const pkgRaw = src('package.json')
ok('package.json 存在', pkgRaw !== null)
const pkg = pkgRaw ? JSON.parse(pkgRaw) : {}
ok('name == ' + PKG_NAME, pkg.name === PKG_NAME, String(pkg.name))
ok('version 合法', /^\d+\.\d+\.\d+$/.test(String(pkg.version)), String(pkg.version))
ok('main 入口声明', pkg.main === 'entry.js', String(pkg.main))
ok('dsh.bundle.patch 声明', pkg.dsh?.bundle?.patch === './cordis.patch.yml')

// 2) 产物在位
ok('entry.js 存在', src('entry.js') !== null)
if (HAS_CLIENT) {
  ok('client.js 存在', src('client.js') !== null)
  ok('exports["./client"] 声明', Boolean(pkg.exports?.['./client']))
}
for (const f of INTACT) ok('intact: ' + f, existsSync(join(ROOT, f)))

// 3) 模块 id 注册
const entry = src('entry.js') ?? ''
ok('entry inject 导出', /export\s+const\s+inject/.test(entry))
const client = HAS_CLIENT ? (src('client.js') ?? '') : ''
if (HAS_CLIENT) {
  ok('ModuleLoader.load 注册', client.includes('window.__ModuleLoader__.load('))
  ok('模块 id == 包名', client.includes("id: '" + PKG_NAME + "'") || client.includes('id: "' + PKG_NAME + '"'))
}

// 4) cordis.patch.yml name 指向
const patch = src('cordis.patch.yml') ?? ''
ok('patch name 指向新包名', patch.includes("name: '" + PKG_NAME + "'") || patch.includes('name: "' + PKG_NAME + '"'))
ok('YAML 无裸 @ 值（patch 行，@ 为 anchor 保留字须引号）', !/:\s+@/.test(patch))

// 5) 旧名/旧锚点零残留（scripts/release 不属于交付面，豁免）
const legacy = ['@kcoder/git-panel', '@kcoder/stats-panel', '@kcoder/terminal',
  '@kcoder/language-bundle', '@kcoder/skills-bundle', 'kc-git-panel', 'kc-stats-panel', 'kc-terminal']
  .filter((n) => !KEEP_LEGACY.includes(n))
const files = ['package.json', 'entry.js', 'cordis.patch.yml', 'README.md']
if (HAS_CLIENT) files.push('client.js')
let residue = []
for (const f of files) {
  const s = src(f)
  if (s === null) continue
  for (const n of legacy) if (s.includes(n)) residue.push(f + ' → ' + n)
}
ok('旧名/旧锚点零残留', residue.length === 0, residue.join('; '))

// 6) 输出
let fail = 0
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[smoke] ' + (checks.length - fail) + '/' + checks.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
