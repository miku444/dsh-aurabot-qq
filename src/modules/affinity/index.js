// 内置模块：亲疏（affinity）。
// 她心里对每个人有个淡淡的亲疏分：常来往、被温柔对待会慢慢亲近，被冷落会疏远。
// 全程本地规则，不跑模型、不额外耗 token；只在聊天进出时顺手记几笔，偶尔注入一句关系提示。

import { defineTool, str } from '../../tools/tools.js'
import { createAffinity, bandOf } from '../../features/affinity.js'

export default {
  id: 'affinity',
  name: '亲疏',
  version: '1.0.0',
  description: '她对每个人的亲近程度：常来往会熟起来，被冷落会疏远；只影响分寸，不设硬门槛',
  config: {
    enabled: { label: '开启', type: 'boolean', default: true },
  },
  setup(api) {
    const affinity = createAffinity({ getConfig: api.config, dataDir: api.dataDir, log: api.log })

    // 有人对她说了一轮：喂给亲疏记一笔。群里不是直接对她说的只算小额。
    api.on('activity', (a) => {
      if (a.kind !== 'in' || !a.text || !a.userId) return
      if (String(a.chatId).startsWith('system:')) return
      if (!api.config().affinity?.enabled) return
      const direct = a.direct || String(a.chatId).startsWith('private:')
      const owner = String(a.userId) === String(api.config().ownerQQ)
      affinity.feed({ uid: a.userId, text: a.text, direct, owner })
    })

    // 上下文里偶尔注入一句她和你现在的亲疏（只在私聊：关系是「她和你」的，群里人多不贴人）
    api.context(({ chat }) => {
      const cfg = api.config()
      if (!(cfg.affinity && cfg.affinity.enabled !== false)) return ''
      if (!chat || chat.kind !== 'private') return ''
      const uid = chat.userId
      if (!uid) return ''
      return affinity.contextLine(uid)
    })

    // 主人可以查 / 改某个人的亲疏（只在主人私聊时给工具）
    api.tool(({ chat }) => {
      const cfg = api.config()
      if (!(cfg.affinity && cfg.affinity.enabled !== false)) return []
      if (chat.kind !== 'private' || String(chat.userId) !== String(cfg.ownerQQ)) return []
      const tools = []
      // 只给主人私聊时看（权限靠 chat.access 或简单判断主人）
      tools.push(defineTool({
        name: 'affinity_score',
        description: '查她对某个人的亲疏分（0~100，越高越亲近），以及对方有没有凶过她。',
        properties: { qq: str('QQ 号') },
        required: ['qq'],
        execute: async ({ qq }) => {
          if (!qq) return { ok: false, message: '给我一个 QQ 号' }
          const v = affinity.score(qq)
          const s = affinity.load()
          const p = s.people[String(qq)]
          return { ok: true, message: `亲疏 ${v}（${bandOf(v).label}）· 见过 ${p?.meets || 0} 次 · 凶过 ${p?.beMean || 0} 回` }
        },
      }))
      tools.push(defineTool({
        name: 'affinity_set',
        description: '主人手动设置某人的亲疏分（0~100）。',
        properties: { qq: str('QQ 号'), value: str('0~100 的分数') },
        required: ['qq', 'value'],
        execute: async ({ qq, value }) => {
          const n = Number(value)
          if (!qq || !Number.isFinite(n)) return { ok: false, message: 'QQ 号和分数都要给我' }
          const s = affinity.load()
          const key = String(qq)
          s.people[key] = { ...(s.people[key] || {}), score: Math.max(0, Math.min(100, Math.round(n))), lastAt: Date.now() }
          affinity.save(s)
          return { ok: true, message: `把 ${qq} 的亲疏设为 ${n}` }
        },
      }))
      return tools
    })

    return affinity
  },
}