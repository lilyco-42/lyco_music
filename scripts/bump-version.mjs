#!/usr/bin/env node
/**
 * 一键改版本号。
 *
 * 背景：版本号的声明点有 12 处（7 个 package.json、CORE_VERSION、
 * portable-platform 的兜底字面量、Android 的 versionName/versionCode、
 * iOS 的 MARKETING_VERSION/CURRENT_PROJECT_VERSION）。0.2.25 发版时
 * 漏了 Android/iOS，CI 直接红 —— 这种手工同步迟早还会漏。
 *
 * 用法：
 *   node scripts/bump-version.mjs 0.2.26
 *   node scripts/bump-version.mjs 0.2.26 --commit --tag
 *
 * 改完请跑 `pnpm test`，version-consistency 会验证每个声明点。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repo = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const version = args.find(a => /^\d+\.\d+\.\d+$/.test(a))
const doCommit = args.includes('--commit')
const doTag = args.includes('--tag')

if (!version) {
  console.error('用法: node scripts/bump-version.mjs <major.minor.patch> [--commit] [--tag]')
  process.exit(1)
}

/** 与 tests/version-consistency.test.ts 保持同一公式 */
const code = version.split('.').map(Number).reduce((acc, n, i) => acc + n * [1000000, 1000, 1][i], 0)

const touched = new Set()

/** 用正则替换，且必须真的替换到东西 —— 静默漏改比报错更糟 */
function patch(rel, pattern, replacement) {
  const file = path.join(repo, rel)
  const before = readFileSync(file, 'utf8')
  const after = before.replace(pattern, replacement)
  if (after === before) throw new Error(`${rel} 没有被修改，正则可能不匹配: ${pattern}`)
  writeFileSync(file, after)
  touched.add(rel)
}

/* 1. 各个 package.json：只改顶层 version 字段（第一个匹配） */
for (const rel of [
  'package.json',
  'apps/desktop/package.json',
  'apps/mobile/package.json',
  'packages/core/package.json',
  'packages/tokens/package.json',
  'packages/platform-desktop/package.json',
  'packages/platform-mobile/package.json',
]) {
  const file = path.join(repo, rel)
  const text = readFileSync(file, 'utf8')
  const re = /("version"\s*:\s*")([^"]+)(")/
  if (!re.test(text)) throw new Error(`${rel} 里没有 version 字段`)
  writeFileSync(file, text.replace(re, `$1${version}$3`))
  touched.add(rel)
}

/* 2. 内核暴露的版本常量 + portable-platform 兜底 */
patch('packages/core/src/index.ts', /export const CORE_VERSION = '[^']+'/, `export const CORE_VERSION = '${version}'`)
patch('packages/core/src/portable-platform.ts', /version: options\.version \?\? '[^']+',/, `version: options.version ?? '${version}',`)

/* 3. Android：versionName 兜底 + versionCode 兜底（CI 会用环境变量覆盖） */
patch(
  'apps/mobile/android/app/build.gradle',
  /versionCode\(System\.getenv\("LXMN_VERSION_CODE"\) \? System\.getenv\("LXMN_VERSION_CODE"\)\.toInteger\(\) : \d+\)/,
  `versionCode(System.getenv("LXMN_VERSION_CODE") ? System.getenv("LXMN_VERSION_CODE").toInteger() : ${code})`,
)
patch(
  'apps/mobile/android/app/build.gradle',
  /versionName\(System\.getenv\("LXMN_VERSION_NAME"\) \?: "[^"]+"\)/,
  `versionName(System.getenv("LXMN_VERSION_NAME") ?: "${version}")`,
)

/* 4. iOS：Debug / Release 两套都要改 */
patch(
  'apps/mobile/ios/LycoMusic.xcodeproj/project.pbxproj',
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${version};`,
)
patch(
  'apps/mobile/ios/LycoMusic.xcodeproj/project.pbxproj',
  /CURRENT_PROJECT_VERSION = \d+;/g,
  `CURRENT_PROJECT_VERSION = ${code};`,
)

console.log(`版本号 -> ${version}（build ${code}）`)
for (const rel of touched) console.log('  · ' + rel)

if (doCommit) {
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'inherit' })
  execFileSync('git', ['commit', '-m', `chore(release): ${version}`], { cwd: repo, stdio: 'inherit' })
}
if (doTag) {
  execFileSync('git', ['tag', `v${version}`], { cwd: repo, stdio: 'inherit' })
  console.log(`已打 tag v${version}`)
}
