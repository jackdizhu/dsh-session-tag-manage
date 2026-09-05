/**
 * 技能目录（`<available_skills>`）载荷级过滤
 *
 * 背景：技能目录以 `<system-reminder><available_skills>` 形式注入在 **`messages`** 中，
 * 由框架在本轮 LLM 调用前生成。首选方案是注册 shadow（`modelInvocable:false`）让框架自行剔除，
 * 但注册表是分层的：**"最近的层同名条目直接胜出"**——插件 ctx 无 scope，shadow 落在**全局层**，
 * 而 web 场景的技能常注册在**更近的 agent 作用域层**，会直接压过全局 shadow，
 * 导致 shadow 已注册（hidden 有记录）但目录仍含全部技能。
 *
 * 故补充一道**载荷级过滤**：在 `llm/stream` 拦截点、真实调用发出前，直接从 `options.messages`
 * 的目录块中删除被隐藏技能的条目。此路径与注册表分层无关，作为兜底保证"隐藏一定生效"。
 *
 * ⚠️ 不可变性（实测）：`options.messages` 是**被密封的数组**（splice 抛
 * "Cannot delete property '2' of [object Array]"），其中的消息对象与文本块又是**被冻结的**
 * （严格模式下 `block.text = x` 会抛 TypeError）。因此只能**整体重建** messages 并
 * 替换 `options.messages`，不能原地修改。
 *
 * @module dsh-skills-auto-enable/catalog
 */

/** 目录条目行：`- \`skill-name\`: 描述` */
const ENTRY_RE = /^- `([^`]+)`:/

/**
 * 从 `options.messages` 的 `<available_skills>` 目录中删除被隐藏技能的条目。
 *
 * 采用不可变更新：重建消息与文本块，并整体替换 `options.messages`。
 * 若目录内已无条目，则丢弃该文本块；若整条消息已无内容块，则丢��该消息。
 *
 * @param options - `llm/stream` 的 GenerateOptions（原地替换其 `messages` 引用）
 * @param hidden - 本会话当前应隐藏的技能名
 * @returns 实际移除的条目数；因对象不可变而无法替换时返回 0
 */
export function filterSkillCatalog(options: unknown, hidden: string[]): number {
  const src = (options ?? {}) as { messages?: unknown }
  const messages = src.messages
  if (!Array.isArray(messages) || hidden.length === 0) return 0
  const names = new Set(hidden)
  let removed = 0

  const out: unknown[] = []
  for (const raw of messages as unknown[]) {
    const msg = raw as { content?: unknown }
    const content = msg?.content
    if (!Array.isArray(content)) {
      out.push(raw)
      continue
    }

    let changed = false
    const nextContent: unknown[] = []
    for (const rawBlock of content as unknown[]) {
      // ⚠️ 不要限定 block.type === 'text'：实测目录块的 type 并非 'text'，
      // 一旦限定会导致整个过滤静默失效（removed 恒为 0）。只按内容特征识别。
      const text = (rawBlock as { text?: unknown })?.text
      if (typeof text !== 'string' || !text.includes('<available_skills>')) {
        nextContent.push(rawBlock)
        continue
      }

      const kept: string[] = []
      let dropped = 0
      for (const line of text.split('\n')) {
        const m = ENTRY_RE.exec(line)
        if (m && names.has(m[1])) {
          dropped++
          continue
        }
        kept.push(line)
      }
      if (dropped === 0) {
        nextContent.push(rawBlock)
        continue
      }
      removed += dropped
      changed = true
      // 目录已空 → 丢弃整个文本块
      if (kept.filter((l) => ENTRY_RE.test(l)).length === 0) continue
      nextContent.push({ ...(rawBlock as object), text: kept.join('\n') })
    }

    if (!changed) {
      out.push(raw)
      continue
    }
    // 消息已无内容块 → 丢弃整条消息
    if (nextContent.length === 0) continue
    out.push({ ...(raw as object), content: nextContent })
  }

  if (removed === 0) return 0
  try {
    src.messages = out
  } catch {
    // options 本身不可写：放弃过滤（shadow 若生效仍会过滤），绝不影响会话
    return 0
  }
  return removed
}
