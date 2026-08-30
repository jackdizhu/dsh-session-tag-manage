<!-- 模块归属：packages/dsh-skills-auto-enable（宿主端插件） -->

## ADDED Requirements

### Requirement: 增量记录会话中存在的 SKILL 完整清单

宿主插件 SHALL 将当前会话上下文中存在的全部 SKILL 维护进配置文件 `skills` 数组，每条仅含 `{ name, keyword, overview }` 三个字段；新增或移除技能时 SHALL 同步追加一条 `skillsLog` 增量流水（`{ at, op:'add'|'remove', name, keyword, overview }`），且 SHALL 为增量更新（只变更差异，不整段重写语义）。

#### Scenario: 会话发起写入基线清单

- **GIVEN** 会话首次 `agent/pre-step`，全量技能为 `[lark-calendar, lark-doc, code-search]`
- **WHEN** 插件完成可见性计算
- **THEN** 配置文件 `skills` 含三条记录，每条带 `name`/`keyword`/`overview`（`keyword` 为命中关键字或空串）
- **AND** `disabledSkills` 命中的技能在 `skillsLog` 中产生 `op:'remove'` 流水

#### Scenario: 关键字加载追加前缀技能

- **GIVEN** 用户消息含"feishu"且 `lark-` 前缀技能此前不在 `skills`
- **WHEN** 关键字命中
- **THEN** `skills` 增量加入 `lark-*` 记录（`keyword:"feishu"`），`skillsLog` 追加 `op:'add'` 流水

### Requirement: 记录执行过程中实际调用的 SKILL

宿主插件 SHALL 观测 `agent.session.events` 中的 `tool/call`（`data.name==='skill'`，`data.args.name` 为技能名）与 `skill-invocation` 用户消息，将实际被调用的技能累计进配置文件 `usage` 映射，含 `{ count, lastUsedAt }`。

#### Scenario: 技能被模型调用后 usage 累加

- **GIVEN** 会话进行中 `usage` 尚无 `lark-calendar` 记录
- **WHEN** `agent.session.events` 出现 `tool/call(name=skill, args.name="lark-calendar")`
- **THEN** `usage["lark-calendar"]` 变为 `{ count:1, lastUsedAt:<当前时间> }`
- **AND** 后续再次调用使 `count` 递增、`lastUsedAt` 更新

### Requirement: 配置原子落盘

宿主插件 SHALL 在会话结束（或去抖周期）将 `skills`/`skillsLog`/`usage` 写入 `dsh-skills-auto-enable-config.json`；写入 SHALL 采用"先写临时文件再 `fs.rename` 原子替换"方式，避免多会话并发写导致文件损坏或互相覆盖。

#### Scenario: 会话结束原子落盘

- **GIVEN** 单宿主进程内多会话在内存累计各自 `skills`/`usage`
- **WHEN** 某会话结束触发落盘
- **THEN** 配置文件以 tmp+rename 原子替换，落盘期间不出现半写文件，其它会话累计不被清空

### Requirement: 模块归属

配置记录代码 SHALL 位于 `packages/dsh-skills-auto-enable/`（宿主端插件 `dsh-skills-auto-enable`），配置文件 `dsh-skills-auto-enable-config.json` 置于该包根目录。

#### Scenario: 配置文件落点正确

- **WHEN** 查看插件包目录
- **THEN** 存在 `dsh-skills-auto-enable-config.json`（首次运行按需创建默认结构），且 `src/records.ts` 负责读写
