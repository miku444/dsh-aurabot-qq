# 这个 fork 里改了什么

本仓库是 [`aureth-labs/dsh-aurabot-qq`](https://github.com/aureth-labs/dsh-aurabot-qq)
的 fork，在此基础上**内置了本地补丁**，这样装一次就带着改动，不必每次升级后重打。

改动只涉及 3 个文件：`src/chat/hub.js`、`src/features/memory.js`、`src/features/qzone-social.js`。

## 1. 群聊里认得出主人（ownerperm）

原版判断「这一轮说话的人是不是全是主人」用的是**全部说话人**。她忙着回上一段时，群里别人顺嘴说的话
会和主人的消息攒进同一批，于是整条判断被否掉——点歌、群管、读文件、画图这些只给主人的功能一律
弹「只有主人能…」。

改成按「**在跟她说话的人**」算：@ 她 / 引用她 / 叫到名字 / 刚说完被追问的人都算；叫她那一条之后
还在说的人也算；这一批没人叫她（她自己插话）时仍按全部说话人保守判断——群友不会因为主人同一轮
叫过她就借到权。另外新增更严的 `turnSendersAllOwnerStrict`（本轮说话的人**全是**主人），给
「操作这台电脑」这类高危工具用，并给群聊提示词里的主人发言加「【你的主人】」标记。

> 上游 1.2.1 加了 `directRequester`（群里直接叫她的人），与这里的 `permSenders` 是两套独立字段，
> 已做过三方合并：共存、互不干扰。

## 2. B站工具按会话档位限制（bili-scope）

`chat` 档挡住全部 B 站工具、`social` 档挡住写操作（点赞/评论/私信/发动态/关注）。这是为了不让
群里陌生人借她自己的 B 站账号做事。顺带让 `tools.restrict()` 遇到不认识的工具名时逐个剔除后重试
（整次失败会让所有写工具都漏挡）。

## 3. 后台会话不带无关工具（tooltrim）

profile 里全局插入的插件（`ctx-slim` / `note-keeper` / `beauticode` / `dsh-tool-web`）不认 agent
preset，会把工具定义塞进每一次请求。后台系统回合（宠物行为、碎碎念、写日记）只输出一段文字或
JSON，却每轮固定白背约 3.4k tokens。

改成 `level === 'chat'` 的 system 会话 deny 掉 18 个全局工具。实测工具 28 → 3 个，
**4,841 → 451 tokens/轮**。`ext-livin`（直播）真在用工作区工具，按会话名放行。

## 4. 空间互动只碰最近 24 小时（qzone-24h）

「回复自己说说下的评论」原版是 3 天窗口，改成 24 小时。好友动态那条过滤原版就是 24 小时。

## 5. 记忆提炼截断抢救（memory salvage）

提炼记忆时模型吐的 JSON 一旦被截断，原版会整批丢弃——一整天的聊天白提炼。加了
`balancedSlices` / `salvageArray`：按括号平衡切分，把已写完整的条目捡回来（写到一半的最后一条
也能救）；提炼预算 1500 → 2600；失败日志补上总字数和结尾。

## 怎么跟着上游更新

```bash
git remote add upstream https://github.com/aureth-labs/dsh-aurabot-qq.git   # 只需一次
git fetch upstream
git merge upstream/main        # 冲突只会在上面 3 个文件里
git push origin local
```

装的时候把 profile 的 `package.json` 指到本 fork 的提交：

```json
"dsh-aurabot-qq": "github:miku444/dsh-aurabot-qq#<commit>"
```

## 注意

- 上游没有 `v1.2.1` 这个 tag，只有 `v1.2.0` 和 `v1.3.0-beta.*`；1.2.1 要用 commit 定位。
- **别顺手升 1.3.0-beta**：相对 1.2.0 是 709 个 commit，`hub.js` +1939 −255、
  `cordis.patch.yml` +130，这 5 个补丁要全部重写。
