export * from './platform'
export * from './registry'
export * from './types'
export * from './sign'
export * from './lyric'
export * from './util/bytes'
export * from './util/duration'
export * from './util/url'
export * from './crypto'
export * from './portable-platform'
export * from './http/fetch'
export * from './storage/web'
export * from './license'
export * from './sync'
export * from './library'
export * from './sources'
export * from './fallback'
export * from './dislike'

export const CORE_VERSION = '0.2.25'

/**
 * 应用对外版本号。与根 package.json 同源 —— 发版时两处一起改，
 * tests/version-consistency.test.ts 会把所有声明点逐一比对，漏改就红。
 */
export const APP_VERSION = CORE_VERSION
