/**
 * 共享的订阅客户端单例
 *
 * membership.ts 与 sync.ts 都需要读同一个订阅令牌（同步复用会员身份），
 * 如果各自 new 一个 SubscriptionClient，虽然 storage key 相同、数据一致，
 * 但两个实例的 cache 互不可见，恢复时机不同就会读到空令牌。
 * 更糟的是让 sync.ts 去 import membership.ts 会形成循环依赖
 * （membership → sync → membership），ESM 下取到 undefined 是常见坑。
 * 所以把它单独放一层。
 */
import { SubscriptionClient } from '@lxmn/core'

/**
 * allowRemoteScripts 在这里开。
 *
 * 订阅里的脚本音源（长青、星海、星澜…）是社区作者每天维护的取流实现，
 * 平台一改版它们往往比我们的内置实现先恢复。不开这个开关，
 * 订阅里那 8 个脚本就全被跳过，用户遇到 VIP 曲目时没有第二层兜底。
 *
 * 为什么这里可以开：脚本只从**我们自己的域名**（lain42.top/sources/）下发，
 * 且订阅文档里带了 sha256，客户端会先校验再执行；执行时跑在受限沙箱里，
 * 拿不到本地文件、碰不到 DOM。风险面比「让用户随便贴一个脚本 URL」小得多。
 */
export const subscription = new SubscriptionClient({ allowRemoteScripts: true })
