// 内置模块：亲疏（affinity）。
// 她心里对每个人有个淡淡的亲疏分：常来往、被温柔对待会慢慢亲近，被冷落会疏远。
// 全程本地规则，不跑模型、不额外耗 token：聊天进出时顺手改几笔，上下文里偶尔注入一句关系提示。
// 只影响语气和分寸，不设硬门槛、不做庞大等级表——成本优先。

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FILE_NAME = 'affinity.json'

// 七档亲疏，注入到上下文时用
const BANDS = [
  { min: 80, label: '很亲近', hint: '你们已经很熟，可以随性一点、有话直说，她会多惦记你' },
  { min: 60, label: '比较熟', hint: '你俩相处挺自然的，她对你更放松一些' },
  { min: 40, label: '点头之交', hint: '跟你还不算太熟，她说话会客气一点、带点分寸' },
  { min: 20, label: '有点生疏', hint: '你俩不怎么来往，她对你有点淡淡的' },
  { min: -Infinity, label: '很疏远', hint: '你俩几乎没来往，她会不太想接话' },
]

// 本地关键词打分：很便宜，够用就行。正负都只取一次，避免一句话叠太多。
const WARM = ['可爱', '喜欢你', '爱你', '想你', '乖', '抱抱', '贴贴', '摸摸', '谢谢', '辛苦', '晚安', '早安', '好棒', '厉害', '真棒', '漂亮', '好看', '夸', '心疼']
const COLD = ['讨厌', '滚', '烦', '闭嘴', '笨', '蠢', '傻', '无聊', '走开', '别理', '不理', '恶心', '垃圾', '废物']

export function bandOf(v) {
  const n = Number(v) || 0
  for (const b of BANDS) if (n >= b.min) return b
  return BANDS[BANDS.length - 1]
}

function buildDefault() {
  return {
    // 每个 QQ 号一条：{ score, lastAt, meets }
    people: {},
    // 首因记忆：见过几次、有没有被凶过（轻量）
    meta: { savedAt: Date.now() },
  }
}

export function createAffinity({ getConfig, dataDir, log }) {
  const file = () => dataDir(FILE_NAME)

  const load = () => {
    try {
      if (!existsSync(file())) return buildDefault()
      const j = JSON.parse(readFileSync(file(), 'utf8'))
      if (j && typeof j === 'object' && j.people) return { ...buildDefault(), ...j }
      return buildDefault()
    } catch (error) {
      try { log?.warn?.('亲疏读取失败，重置：', error?.message) } catch (e) {}
      return buildDefault()
    }
  }
  const save = (s) => {
    try { writeFileSync(file(), JSON.stringify(s)) } catch (error) { try { log?.warn?.('亲疏保存失败：', error?.message) } catch (e) {} }
  }

  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))

  /** 拿一个人的亲疏分，没见过的默认 45（陌生但温和）。 */
  const score = (uid) => {
    const s = load()
    return clamp(s.people[String(uid)]?.score ?? 45)
  }

  /** 每轮聊完喂一句：uid、他说的原话、是不是@/私聊直接对她说的、是不是主人。 */
  function feed({ uid, text, direct = false, owner = false, silent = false }) {
    if (!uid) return
    if (silent) return // 静默沉淀轮不算人情往来
    const s = load()
    const key = String(uid)
    const now = Date.now()
    const isOwner = owner
    // 初始分：主人最高；老朋友按「主动搭话名单 > 私聊白名单 > 陌生人」递减，不用从 45 生分起步
    if (!s.people[key]) {
      let start = 45
      if (isOwner) start = 72
      else {
        const cfg = getConfig()
        const spk = (cfg.speakUp?.allow || []).map(String)
        const priv = (cfg.allow?.private || []).map(String)
        if (spk.includes(key)) start = 68 // 常来往、会主动找她聊
        else if (priv.includes(key)) start = 58 // 以前就加过的好友
      }
      s.people[key] = { score: start, lastAt: 0, meets: 0, beMean: 0 }
    }
    const p = s.people[key]
    // 上限增速，越亲近越难涨（跟七维同一套思路）
    const cur = clamp(p.score)
    let d = 0

    // 日常来往：直接对她说的话加得多，群里闲聊加得少；主人再加成
    d += direct ? 1.5 : 0.3
    if (owner) d += 1.0

    // 关键词：一句只取一档，正负都算；被凶比被夸记得牢
    const t = String(text || '')
    if (WARM.some((w) => t.includes(w))) d += 3.0
    else if (COLD.some((w) => t.includes(w))) d -= 6.0

    // 分开超过 3 天没见，再见面打个小折（新鲜感，但也别扣太多）
    if (p.lastAt && now - p.lastAt > 3 * 24 * 3600_000 && p.lastAt < now) {
      d *= 0.5
    }

    p.score = clamp(cur + d * (cur >= 60 ? 0.5 : 1)) // 60 以上涨得慢
    p.lastAt = now
    p.meets = (p.meets || 0) + 1
    if (COLD.some((w) => t.includes(w))) p.beMean = (p.beMean || 0) + 1

    // 存的时候顺手续个命：最多留 200 人（防止无限膨胀）
    const entries = Object.entries(s.people)
    if (entries.length >= 200) {
      const sorted = entries.sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
      for (const [k] of sorted.slice(100)) delete s.people[k]
    }
    s.people[key] = p
    save(s)
    return clamp(p.score)
  }

  /** 给上下文的注入：私聊时总有一句（第一次见面也要说清「不熟」），但中间地带最短。 */
  function contextLine(uid, nick = '对方') {
    if (!uid) return ''
    const v = score(uid)
    const band = bandOf(v)
    const s = load()
    const p = s.people[String(uid)]
    const meets = p?.meets || 0
    const mean = p?.beMean || 0
    let extra = ''
    if (meets === 0) extra = '你们还不认识'
    else if (meets <= 2 && mean === 0) extra = `你们才见${meets}面`
    else if (mean >= 2) extra = `她被你凶过${mean}回，还记着`
    if (band.label === '点头之交' && !extra) return '' // 中不溜又没故事，不说
    const tail = extra ? `，${extra}` : ''
    return `（你和她：${band.label}${tail}。${band.hint}。不用说破关系。）`
  }

  return { score, feed, load, bandOf, contextLine, file, save }
}