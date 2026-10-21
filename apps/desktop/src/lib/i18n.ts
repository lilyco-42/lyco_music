/**
 * 多语言（PARITY 7.4）
 *
 * 现状与边界（说实话，别让下一个人以为是全量的）：
 *   - 已接入：**界面框架** —— 侧栏导航、顶栏、设置页的分区标题与语言选择器；
 *   - 未接入：各页面内部的具体文案（列表表头、空状态提示、报错等），仍是中文。
 *   这不是偷懒，是分批做：几百条文案一次性铺开，改动面太大、回归风险高，
 *   先把框架和「切了能看见变化」的部分做出来，再逐页补。
 *
 * 四种语言的做法不一样，成本差很多：
 *   - zh-CN 是源语言，字典手写；
 *   - **zh-TW 由 zh-CN 逐字转换**（复用内核的 toTraditional，和「歌词转繁体」同一张表）。
 *     人工再写一份繁体字典，两边必然逐渐不一致；转换表反而是唯一真相。
 *   - en-US / ko-KR 手写，只覆盖框架文案。
 *
 * 查不到 key 时回退到 zh-CN，再回退到 key 本身 —— 界面上永远不会出现空白，
 * 最差也是显示一个 key，一眼能看出漏了哪条。
 */
import { computed } from 'vue'
import { toTraditional } from '@lxmn/core'
import { prefs } from './prefs'

export type Locale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ko-KR'

export const LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: 'zh-CN', label: '简体中文', native: '简体中文' },
  { id: 'zh-TW', label: '繁體中文', native: '繁體中文' },
  { id: 'en-US', label: 'English', native: 'English' },
  { id: 'ko-KR', label: '한국어', native: '한국어' },
]

type Dict = Record<string, string>

const ZH_CN: Dict = {
  'app.name': 'Lyco Music',

  'nav.recommend': '推荐',
  'nav.featured': '精选',
  'nav.podcast': '播客',
  'nav.roam': '漫游',
  'nav.discover': '发现',
  'nav.follow': '关注',
  'nav.membership': '音乐会员',
  'nav.sync': '云同步',
  'nav.friends': '好友',
  'nav.settings': '设置',
  'nav.account': '我的账户',
  'nav.trial': '试听列表',
  'nav.like': '我喜欢的音乐',
  'nav.recent': '最近播放',
  'nav.download': '下载管理',
  'nav.import': '导入本地音乐',
  'nav.more': '更多',

  'search.title': '搜索「{q}」',
  'search.total': '共 {n} 首',
  'search.playAll': '播放全部',
  'search.loading': '搜索中…',
  'search.empty': '没有找到相关歌曲',
  'search.all': '全部',
  'my.title': '我的音乐',
  'my.new': '新建歌单',
  'my.trial': '试听列表',
  'my.fav': '我喜欢的音乐',
  'my.recent': '最近播放',
  'my.playlists': '我的歌单',

  'page.discover': '发现音乐',
  'page.downloads': '下载管理',
  'page.import': '导入本地音乐',
  'page.friends': '好友',
  'page.sync': '云同步',
  'page.membership': '音乐会员',
  'page.account': '我的账户',
  'player.tab.lyric': '歌词',
  'player.tab.comment': '评论',
  'player.tab.wiki': '百科',
  'player.tab.similar': '相似推荐',

  'dl.pauseAll': '全部暂停',
  'dl.resumeAll': '全部继续',
  'dl.clearDone': '清空已完成',
  'dl.dir': '保存到',
  'dl.change': '更改',
  'dl.open': '打开',
  'dl.naming': '命名',
  'dl.subdir': '按歌单分目录',
  'dl.skipExisting': '同名跳过',
  'dl.embedLyric': '嵌入歌词',
  'dl.embedCover': '嵌入封面',
  'dl.sidecarLrc': '另存 .lrc',
  'dl.lyricEncoding': '歌词编码',
  'dl.concurrency': '同时下载',
  'imp.dirs': '找到的网易云目录',
  'imp.chooseOther': '选择其他目录…',
  'imp.none': '没有自动找到网易云的下载目录。',
  'imp.result': '扫描结果',
  'imp.tooMany': '目录里的文件太多，只扫描了前一部分。建议把目录选得更具体一些。',

  'sync.server': '同步服务器',
  'sync.oneClick': '用会员订阅一键开通',
  'sync.connect': '连接',
  'sync.token': '同步令牌',
  'sync.lastSync': '上次同步',
  'sync.disable': '关闭同步',
  'sync.devices': '已认证设备',
  'sync.revoked': '已撤销',
  'sync.host': '把这台电脑变成同步服务器',
  'sync.port': '端口',
  'mem.valid': '会员有效',
  'mem.expired': '会员已过期',
  'mem.none': '尚未激活会员',
  'acct.login': '用 lain42.top 账号登录',
  'acct.vip': '音乐会员有效',

  'fr.needVip': '好友功能需要音乐会员',
  'fr.needVipDesc': '开通后用好友码加好友，同步歌单、看在线状态',
  'fr.goActivate': '去开通',
  'fr.loadFail': '好友列表加载失败',
  'fr.reload': '重新加载',
  'fr.retry': '重试',
  'fr.code': '好友码',
  'fr.copy': '复制',
  'fr.rename': '改昵称',
  'fr.save': '保存',
  'fr.feed': '好友动态',
  'fr.add': '添加好友',

  'home.ch.daily': '每日推荐',
  'home.ch.dailyDesc': '根据你的口味生成',
  'home.ch.roam': '私人漫游',
  'home.ch.roamDesc': '无限漫游',
  'home.ch.radar': '私人雷达',
  'home.ch.radarDesc': '为你精选',
  'home.ch.hiphop': '嘻哈/说唱日推',
  'home.ch.mood': '心情氛围歌单',
  'home.ch.moodDesc': '此刻的心情',
  'home.ch.western': '欧美流行日推',
  'home.ch.folk': '民谣日推',
  'home.ch.updated': '每日更新',

  'sidebar.group.discover': '发现音乐',
  'sidebar.group.service': '账户与服务',
  'sidebar.group.mine': '我的音乐',
  'sidebar.playlists': '本机歌单',
  'sidebar.newPlaylist': '新建歌单',
  'sidebar.empty': '还没有创建歌单',

  'topbar.search': '搜索歌曲、歌手',
  'topbar.login': '登录 / 注册',
  'topbar.vip': 'VIP',

  'common.refresh': '刷新',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.close': '关闭',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.on': '开',
  'common.off': '关',

  'settings.title': '设置',
  'settings.appearance': '外观',
  'settings.language': '界面语言',
  'settings.languageNote': '英文 / 韩文目前只覆盖界面框架，页面内的具体文案仍是中文，会逐步补齐。',
}

const EN_US: Dict = {
  'app.name': 'Lyco Music',

  'nav.recommend': 'For You',
  'nav.featured': 'Featured',
  'nav.podcast': 'Podcasts',
  'nav.roam': 'Roam',
  'nav.discover': 'Discover',
  'nav.follow': 'Following',
  'nav.membership': 'Membership',
  'nav.sync': 'Cloud Sync',
  'nav.friends': 'Friends',
  'nav.settings': 'Settings',
  'nav.account': 'My Account',
  'nav.trial': 'Play Queue',
  'nav.like': 'Liked Songs',
  'nav.recent': 'Recently Played',
  'nav.download': 'Downloads',
  'nav.import': 'Import Local Music',
  'nav.more': 'More',

  'search.title': 'Search "{q}"',
  'search.total': '{n} tracks',
  'search.playAll': 'Play All',
  'search.loading': 'Searching…',
  'search.empty': 'No matching songs',
  'search.all': 'All',
  'my.title': 'My Music',
  'my.new': 'New Playlist',
  'my.trial': 'Play Queue',
  'my.fav': 'Liked Songs',
  'my.recent': 'Recently Played',
  'my.playlists': 'My Playlists',

  'page.discover': 'Discover',
  'page.downloads': 'Downloads',
  'page.import': 'Import Local Music',
  'page.friends': 'Friends',
  'page.sync': 'Cloud Sync',
  'page.membership': 'Membership',
  'page.account': 'My Account',
  'player.tab.lyric': 'Lyrics',
  'player.tab.comment': 'Comments',
  'player.tab.wiki': 'Wiki',
  'player.tab.similar': 'Similar',

  'dl.pauseAll': 'Pause All',
  'dl.resumeAll': 'Resume All',
  'dl.clearDone': 'Clear Completed',
  'dl.dir': 'Save to',
  'dl.change': 'Change',
  'dl.open': 'Open',
  'dl.naming': 'Naming',
  'dl.subdir': 'Subfolder per playlist',
  'dl.skipExisting': 'Skip existing',
  'dl.embedLyric': 'Embed lyrics',
  'dl.embedCover': 'Embed cover',
  'dl.sidecarLrc': 'Save .lrc',
  'dl.lyricEncoding': 'Lyric encoding',
  'dl.concurrency': 'Concurrent',
  'imp.dirs': 'NetEase folders found',
  'imp.chooseOther': 'Choose another folder…',
  'imp.none': 'No NetEase download folder found automatically.',
  'imp.result': 'Scan result',
  'imp.tooMany': 'Too many files; only the first part was scanned. Pick a narrower folder.',

  'sync.server': 'Sync server',
  'sync.oneClick': 'Enable with membership',
  'sync.connect': 'Connect',
  'sync.token': 'Sync token',
  'sync.lastSync': 'Last sync',
  'sync.disable': 'Disable sync',
  'sync.devices': 'Trusted devices',
  'sync.revoked': 'Revoked',
  'sync.host': 'Turn this computer into a sync server',
  'sync.port': 'Port',
  'mem.valid': 'Membership active',
  'mem.expired': 'Membership expired',
  'mem.none': 'Membership not activated',
  'acct.login': 'Sign in with lain42.top account',
  'acct.vip': 'Membership active',

  'fr.needVip': 'Friends require a membership',
  'fr.needVipDesc': 'Add friends with a friend code, share playlists and see who is online',
  'fr.goActivate': 'Get membership',
  'fr.loadFail': 'Failed to load friends',
  'fr.reload': 'Reload',
  'fr.retry': 'Retry',
  'fr.code': 'Friend code',
  'fr.copy': 'Copy',
  'fr.rename': 'Rename',
  'fr.save': 'Save',
  'fr.feed': 'Friend activity',
  'fr.add': 'Add friend',

  'home.ch.daily': 'Daily Mix',
  'home.ch.dailyDesc': 'Made for your taste',
  'home.ch.roam': 'Private Roam',
  'home.ch.roamDesc': 'Endless roam',
  'home.ch.radar': 'Private Radar',
  'home.ch.radarDesc': 'Picked for you',
  'home.ch.hiphop': 'Hip-Hop Daily',
  'home.ch.mood': 'Mood Playlists',
  'home.ch.moodDesc': 'For this moment',
  'home.ch.western': 'Western Pop Daily',
  'home.ch.folk': 'Folk Daily',
  'home.ch.updated': 'Updated daily',

  'sidebar.group.discover': 'Discover',
  'sidebar.group.service': 'Account & Services',
  'sidebar.group.mine': 'My Music',
  'sidebar.playlists': 'Local Playlists',
  'sidebar.newPlaylist': 'New playlist',
  'sidebar.empty': 'No playlists yet',

  'topbar.search': 'Search songs, artists',
  'topbar.login': 'Sign in / Sign up',
  'topbar.vip': 'VIP',

  'common.refresh': 'Refresh',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.on': 'On',
  'common.off': 'Off',

  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.language': 'Language',
  'settings.languageNote': 'English and Korean currently cover the app shell only; page content is still Chinese and will be translated gradually.',
}

const KO_KR: Dict = {
  'app.name': 'Lyco Music',

  'nav.recommend': '추천',
  'nav.featured': '선곡',
  'nav.podcast': '팟캐스트',
  'nav.roam': '탐색',
  'nav.discover': '발견',
  'nav.follow': '팔로잉',
  'nav.membership': '멤버십',
  'nav.sync': '클라우드 동기화',
  'nav.friends': '친구',
  'nav.settings': '설정',
  'nav.account': '내 계정',
  'nav.trial': '재생 목록',
  'nav.like': '좋아하는 음악',
  'nav.recent': '최근 재생',
  'nav.download': '다운로드 관리',
  'nav.import': '로컬 음악 가져오기',
  'nav.more': '더보기',

  'search.title': '"{q}" 검색',
  'search.total': '총 {n}곡',
  'search.playAll': '전체 재생',
  'search.loading': '검색 중…',
  'search.empty': '검색 결과가 없습니다',
  'search.all': '전체',
  'my.title': '내 음악',
  'my.new': '새 플레이리스트',
  'my.trial': '재생 목록',
  'my.fav': '좋아하는 음악',
  'my.recent': '최근 재생',
  'my.playlists': '내 플레이리스트',

  'page.discover': '음악 발견',
  'page.downloads': '다운로드 관리',
  'page.import': '로컬 음악 가져오기',
  'page.friends': '친구',
  'page.sync': '클라우드 동기화',
  'page.membership': '멤버십',
  'page.account': '내 계정',
  'player.tab.lyric': '가사',
  'player.tab.comment': '댓글',
  'player.tab.wiki': '위키',
  'player.tab.similar': '비슷한 곡',

  'dl.pauseAll': '모두 일시정지',
  'dl.resumeAll': '모두 계속',
  'dl.clearDone': '완료 항목 지우기',
  'dl.dir': '저장 위치',
  'dl.change': '변경',
  'dl.open': '열기',
  'dl.naming': '파일명',
  'dl.subdir': '플레이리스트별 폴더',
  'dl.skipExisting': '동일 파일 건너뛰기',
  'dl.embedLyric': '가사 삽입',
  'dl.embedCover': '커버 삽입',
  'dl.sidecarLrc': '.lrc 저장',
  'dl.lyricEncoding': '가사 인코딩',
  'dl.concurrency': '동시 다운로드',
  'imp.dirs': '찾은 NetEase 폴더',
  'imp.chooseOther': '다른 폴더 선택…',
  'imp.none': 'NetEase 다운로드 폴더를 찾지 못했습니다.',
  'imp.result': '스캔 결과',
  'imp.tooMany': '파일이 너무 많아 일부만 스캔했습니다. 더 구체적인 폴더를 선택하세요.',

  'sync.server': '동기화 서버',
  'sync.oneClick': '멤버십으로 한 번에 연결',
  'sync.connect': '연결',
  'sync.token': '동기화 토큰',
  'sync.lastSync': '마지막 동기화',
  'sync.disable': '동기화 끄기',
  'sync.devices': '인증된 기기',
  'sync.revoked': '해제됨',
  'sync.host': '이 컴퓨터를 동기화 서버로',
  'sync.port': '포트',
  'mem.valid': '멤버십 유효',
  'mem.expired': '멤버십 만료',
  'mem.none': '멤버십이 없습니다',
  'acct.login': 'lain42.top 계정으로 로그인',
  'acct.vip': '멤버십 유효',

  'fr.needVip': '친구 기능은 멤버십이 필요합니다',
  'fr.needVipDesc': '친구 코드로 친구를 추가하고 플레이리스트를 공유하세요',
  'fr.goActivate': '멤버십 가입',
  'fr.loadFail': '친구 목록을 불러오지 못했습니다',
  'fr.reload': '다시 불러오기',
  'fr.retry': '재시도',
  'fr.code': '친구 코드',
  'fr.copy': '복사',
  'fr.rename': '닉네임 변경',
  'fr.save': '저장',
  'fr.feed': '친구 활동',
  'fr.add': '친구 추가',

  'home.ch.daily': '매일 추천',
  'home.ch.dailyDesc': '취향에 맞춘 선곡',
  'home.ch.roam': '개인 탐색',
  'home.ch.roamDesc': '끝없는 탐색',
  'home.ch.radar': '개인 레이더',
  'home.ch.radarDesc': '당신을 위한 선곡',
  'home.ch.hiphop': '힙합 데일리',
  'home.ch.mood': '기분 플레이리스트',
  'home.ch.moodDesc': '지금의 기분',
  'home.ch.western': '서양 팝 데일리',
  'home.ch.folk': '포크 데일리',
  'home.ch.updated': '매일 업데이트',

  'sidebar.group.discover': '음악 발견',
  'sidebar.group.service': '계정 및 서비스',
  'sidebar.group.mine': '내 음악',
  'sidebar.playlists': '내 플레이리스트',
  'sidebar.newPlaylist': '새 플레이리스트',
  'sidebar.empty': '아직 플레이리스트가 없습니다',

  'topbar.search': '곡, 아티스트 검색',
  'topbar.login': '로그인 / 가입',
  'topbar.vip': 'VIP',

  'common.refresh': '새로고침',
  'common.copy': '복사',
  'common.copied': '복사됨',
  'common.close': '닫기',
  'common.cancel': '취소',
  'common.confirm': '확인',
  'common.on': '켜기',
  'common.off': '끄기',

  'settings.title': '설정',
  'settings.appearance': '모양',
  'settings.language': '언어',
  'settings.languageNote': '영어와 한국어는 현재 앱 프레임만 지원하며, 페이지 내부 문구는 아직 중국어입니다.',
}

const RAW: Record<Locale, Dict> = {
  'zh-CN': ZH_CN,
  'zh-TW': {},
  'en-US': EN_US,
  'ko-KR': KO_KR,
}

/** 繁体中文字典：由简体逐字转换，构建一次后缓存 */
let twCache: Dict | null = null
function traditionalDict(): Dict {
  if (twCache) return twCache
  const out: Dict = {}
  for (const k of Object.keys(ZH_CN)) out[k] = toTraditional(ZH_CN[k]!)
  twCache = out
  return out
}

function dictFor(locale: Locale): Dict {
  if (locale === 'zh-TW') return traditionalDict()
  return RAW[locale] ?? ZH_CN
}

/** 当前语言（响应式，改设置立刻换） */
export const locale = computed<Locale>(() => (prefs.locale as Locale) || 'zh-CN')

/**
 * 取一条文案。
 *
 * 传了 fallback 就用 fallback 兜底（页面里现成的中文），
 * 这样「字典还没收这条」的界面不会退化成显示 key。
 *
 * 第三个参数只给测试用：临时按某个语言取一条，不依赖 prefs。
 */
export function t(key: string, fallback?: string, loc?: Locale): string {
  const dict = dictFor(loc ?? locale.value)
  const hit = dict[key]
  if (hit) return hit
  const zh = ZH_CN[key]
  if (zh) return zh
  return fallback ?? key
}

/**
 * 带占位符的取词：`tf('search.title', { q: '晴天' })`。
 *
 * 单独抽出来是因为不同语言的语序不一样（英文 "Search \"x\""、"x" 검색），
 * 用字符串拼接在中文里通顺、换个语言就散了。保持模板 + 占位符，
 * 每条文案怎么写由各语言自己决定。
 */
export function tf(key: string, params?: Record<string, string | number>, fallback?: string): string {
  let out = t(key, fallback)
  if (!params) return out
  for (const [k, v] of Object.entries(params)) out = out.split('{' + k + '}').join(String(v))
  return out
}

/** 源语言里定义的全部 key —— 用例据此检查各语言有没有漏译 */
export const TRANSLATION_KEYS: readonly string[] = Object.keys(ZH_CN)

/** 组件里用：`const { t, locale } = useI18n()` */
export function useI18n() {
  return { t, tf, locale, locales: LOCALES }
}
