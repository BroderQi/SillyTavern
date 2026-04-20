# DayDream UI/UX Implementation Plan

## 目标

把 `白日梦DayDream世界引擎V2.0.5.txt` 从“纯文本提示词玩法”升级为 SillyTavern 内的互动叙事 UI 扩展。

目标体验不是替换大模型，而是把 SillyTavern 作为模型、上下文、角色卡、聊天存档底座；DayDream 扩展负责游戏化 UI、状态管理、剧本选择、选项按钮、结局结算和结构化提示词注入。

## 核心判断

顶部栏、主叙事区、底部导航、动作栏这些布局骨架可以固定。

具体状态字段不应该写死。不同剧本应显示不同指标：

- 宫斗/权谋：威望、宠爱、筹码、风险、回合
- 末日/求生：生命、体力、物资、风险、倒计时
- 悬疑/破案：精力、线索、嫌疑、风险、时间
- 商战/经营：现金流、声望、人脉、风险、回合
- 恋爱/情感：心绪、好感、边界、误会、回合
- 治愈/成长：心力、信任、目标、关系、回合

所以实现策略是：固定 UI 框架，可配置 UI Profile。

## 推荐接入方式

优先做成 SillyTavern 前端扩展，不改核心生成链路。

扩展目录建议：

```text
public/scripts/extensions/third-party/daydream/
  manifest.json
  index.js
  settings.html
  style.css
  data/
    stories.json
    ui-profiles.json
  prompts/
    engine-core.md
    turn-injection.md
    state-update.md
    ending.md
```

SillyTavern 已有可用接口：

- `setExtensionPrompt()`：动态注入当前引擎规则、当前剧本、当前状态
- `chat_metadata`：保存每个聊天独立的 DayDream 状态
- `saveMetadata()` / `saveMetadataDebounced()`：持久化状态
- `eventSource`：监听聊天切换、生成开始、生成结束
- `generateRaw()` / `generateQuietPrompt()`：可用于静默状态归纳或 JSON 状态更新

## 产品结构

### 1. 顶部状态栏

固定位置，可配置字段。

默认字段：

```json
[
  { "key": "turn_count", "label": "回合", "icon": "clock" },
  { "key": "risk_level", "label": "风险", "icon": "triangle" },
  { "key": "trust_level", "label": "信任", "icon": "heart" },
  { "key": "social_status", "label": "地位", "icon": "scale" }
]
```

每个剧本可以通过 `ui_profile.top_stats` 覆盖。

### 2. 中间主叙事区

包含：

- 背景图层
- 人物立绘层
- 当前事件卡片
- 剧情文本
- 状态变化摘要
- 4 个行动选项按钮

MVP 阶段可以先只做卡片化文本，不接图片生成。

### 3. 弹窗

必须支持：

- 创建角色
- 选择进入方式：随机故事 / 预设故事 / 自定义故事
- 预设故事筛选
- 当前故事重置确认
- 结局结算

### 4. 底部导航

固定导航容器，可配置标签。

默认：

```text
剧情 / 人脉 / 手机 / 属性 / 事件 / 资产 / 设置
```

不同剧本覆盖示例：

```json
{
  "tabs": [
    { "key": "story", "label": "剧情", "icon": "book" },
    { "key": "relations", "label": "人脉", "icon": "users" },
    { "key": "messages", "label": "书信", "icon": "envelope" },
    { "key": "stats", "label": "属性", "icon": "user" },
    { "key": "events", "label": "事件", "icon": "flag" },
    { "key": "inventory", "label": "府库", "icon": "box" },
    { "key": "settings", "label": "设置", "icon": "gear" }
  ]
}
```

### 5. 底部动作栏

保留自定义输入，但弱化为“动作栏”。

原则：

- 选项按钮负责快玩
- 自定义输入负责自由度
- 不完全取消文本输入
- 自定义动作仍必须经过世界规则校验

## 数据结构

### DayDreamState

状态保存在 `chat_metadata.daydream`。

建议结构：

```json
{
  "enabled": true,
  "version": "0.1.0",
  "story_id": null,
  "story_title": "",
  "route": "general_story",
  "story_class": "",
  "ui_profile_id": "",
  "character": {
    "name": "",
    "gender": "",
    "custom": {}
  },
  "stats": {
    "turn_count": 0,
    "risk_level": 0,
    "trust_level": 0,
    "social_status": 0
  },
  "relationships": [],
  "resources": [],
  "triggered_events": [],
  "current_stage": "opening",
  "stage_progress": 0,
  "main_objective": "",
  "core_conflict": "",
  "pending_foreshadows": [],
  "active_hooks": [],
  "activated_emotions": [],
  "important_branches": [],
  "near_ending": false,
  "last_options": []
}
```

### StoryDefinition

把 txt 里的 100 个预设故事拆成 `stories.json`。

```json
{
  "id": 1,
  "title": "皇帝后宫模拟器",
  "spacetime": "架空古代深宫",
  "theme": "后宫权谋与生存博弈",
  "protagonist_setup": "初入宫廷、资源有限、身份未稳的新人",
  "system_type": "无",
  "custom_constraints": [
    "不能越级调动禁军",
    "名声影响所有人际判断",
    "公开失礼会造成长期代价"
  ],
  "meta_theme": "权力博弈",
  "story_class": "权谋博弈",
  "style": "细腻沉浸",
  "route": "power_game",
  "opening": "开场：第一次请安前，掌事姑姑临时换掉了你的衣饰",
  "ui_profile": {
    "top_stats": [
      { "key": "age", "label": "年龄", "icon": "calendar" },
      { "key": "energy", "label": "体力", "icon": "heart" },
      { "key": "favor", "label": "宠爱", "icon": "crown" },
      { "key": "prestige", "label": "威望", "icon": "scale" },
      { "key": "turn_count", "label": "回合", "icon": "clock" }
    ],
    "tabs": ["剧情", "人脉", "书信", "属性", "事件", "府库", "设置"]
  }
}
```

## 提示词注入策略

不要每回合注入完整 `白日梦DayDream世界引擎V2.0.5.txt`。

每次生成只注入：

1. 精简核心规则：`engine-core.md`
2. 当前故事定义：选中的一条 `StoryDefinition`
3. 当前状态：`DayDreamState`
4. 本回合输出格式约束
5. 如用户输入“结束”，注入结局结算规则

建议注入位置：

- 核心规则：`BEFORE_PROMPT`
- 当前状态：`IN_CHAT`，深度 0 到 2
- 临时回合指令：`IN_PROMPT`

## 状态更新策略

### MVP

从模型输出中解析：

- `【状态变化】`
- `【行动选项】`
- `【结局】`

提取后更新 `chat_metadata.daydream`。

### 稳定版

生成结束后，用 `generateRaw()` 进行静默状态更新：

输入：

- 上一轮 `DayDreamState`
- 用户行动
- 助手回复

输出：

- 新的 `DayDreamState` JSON

需要 JSON schema 校验。字段缺失时保留旧值，防止模型误删状态。

### 伏笔管理

`pending_foreshadows` 每回合维护：

- 新增伏笔：记录 `created_turn`
- 触发伏笔：移出 pending，写入事件/线索/关系变化
- 超过 4 回合未触发：当回合注入提醒，让模型换一种方式重新提示

## UI Profile 继承机制

优先级：

```text
story.ui_profile > ui-profiles.json 中 story_class 默认配置 > 通用默认配置
```

这样大部分故事不用单独配 UI，只要按 `story_class` 自动继承。

## 事件流程

### 初始化

1. 扩展加载
2. 注入设置面板和 DayDream 面板
3. 读取 `chat_metadata.daydream`
4. 如果没有状态，显示创建角色/选择故事弹窗
5. 如果有状态，恢复 UI

### 用户选择故事

1. 选择随机/预设/自定义
2. 如果是预设故事，前端按 `stories.json` 做分类筛选
3. 写入 `chat_metadata.daydream.story_id`
4. 初始化状态字段
5. 注入开场提示

### 每回合生成前

1. 根据状态拼接注入 prompt
2. `setExtensionPrompt()` 写入扩展提示词
3. 用户动作发送给模型

### 每回合生成后

1. 解析助手回复
2. 更新剧情文本区
3. 更新状态栏
4. 更新行动选项按钮
5. 更新人脉/事件/资产等子页面
6. 保存 `chat_metadata.daydream`

## 分期计划

### Phase 0：数据整理

目标：把 txt 拆成可维护资产。

任务：

- 提取精简核心规则到 `engine-core.md`
- 将 100 个预设故事转成 `stories.json`
- 建立 `ui-profiles.json`
- 移除启动指令中的外部联系方式

验收：

- 能按 `spacetime/theme/protagonist_setup/system_type/story_class` 统计故事数量
- 每个故事都有明确结构化字段

### Phase 1：扩展 MVP

目标：能在 SillyTavern 内启用 DayDream 面板。

任务：

- 创建 third-party 扩展目录
- 添加 `manifest.json`
- 添加设置面板
- 添加全屏/半屏 DayDream 主 UI
- 实现启用/禁用开关
- 实现 `chat_metadata.daydream` 初始化和保存

验收：

- 开启扩展后能看到 DayDream UI
- 切换聊天后状态不串档
- 不修改 `public/script.js`

### Phase 2：剧本选择和 UI Profile

目标：抛弃纯文本故事选择。

任务：

- 实现随机故事
- 实现预设故事分类筛选
- 实现自定义故事入口
- 根据故事加载顶部状态栏和底部导航

验收：

- 用户选择 2 后不会展示 100 个故事平铺列表
- 分类数量来自 `stories.json` 实时统计
- 不同 story_class 显示不同 UI 字段

### Phase 3：生成注入和选项按钮

目标：模型输出和 UI 打通。

任务：

- 用 `setExtensionPrompt()` 注入核心规则、当前故事、当前状态
- 解析【行动选项】
- 渲染 4 个选项按钮
- 点击按钮自动填入或发送行动
- 保留自定义动作栏

验收：

- 每回合按钮来自模型输出
- 自定义输入仍可用
- 模型不会每回合收到完整 25k 字提示词

### Phase 4：状态更新

目标：让“不失忆”从提示词要求变成工程能力。

任务：

- MVP 正则解析【状态变化】
- 更新顶部状态和子页面
- 实现 `pending_foreshadows` 生命周期
- 增加静默 JSON 状态更新实验

验收：

- 回合数稳定递增
- 风险/资源/关系能跨回合保留
- 伏笔不会无声丢失

### Phase 5：结局结算

目标：实现可收束故事。

任务：

- 监听用户输入“结束”
- 增加 UI 结局按钮
- 注入结局规则
- 渲染结局弹窗
- 生成分享卡片样式

验收：

- 结局基于当前状态和关键选择
- 不另起炉灶
- 有标题、评级、轨迹、关键选择、个人评语

### Phase 6：视觉升级

目标：接近图片示例里的移动端互动游戏体验。

任务：

- 背景图层
- 人物立绘槽位
- 事件卡片动画
- 移动端适配
- 深色/浅色主题
- 可选图片生成接入

验收：

- 375px 宽度下不溢出
- 顶部状态栏和底部导航稳定
- 文本不遮挡按钮
- 背景和卡片层级清楚

## 风险和规避

### 上下文过长

风险：完整 txt 每回合注入会污染上下文。

规避：只注入精简规则、当前故事、当前状态。

### UI 和模型状态不一致

风险：模型说资源减少，UI 没更新。

规避：用结构化状态更新；无法解析时保留旧状态并提示需要复核。

### 剧本 UI 千篇一律

风险：所有故事都显示年龄、体力、才华、道德，导致违和。

规避：UI Profile 按 story_class 继承，剧本可覆盖。

### 过度封闭自由输入

风险：做成按钮游戏后丢掉 DayDream 的自由度。

规避：保留自定义动作栏，按钮只是快捷入口。

### 修改核心导致难以维护

风险：直接改 `public/script.js` 后难以跟随上游更新。

规避：优先走 third-party 扩展。

## 最小可行版本定义

MVP 完成时应具备：

- DayDream 扩展可启用/禁用
- 创建角色弹窗
- 随机/预设/自定义故事入口
- 顶部状态栏
- 主剧情卡片
- 4 个行动选项按钮
- 自定义动作栏
- 底部导航
- 状态保存在 `chat_metadata.daydream`
- 通过 `setExtensionPrompt()` 注入当前故事和状态

## 建议下一步

先不要做图片生成和复杂动画。

第一步应该完成：

1. 建扩展骨架
2. 转换 `stories.json`
3. 实现 UI Profile
4. 实现基础面板和状态保存
5. 实现提示词注入

做到这一步，DayDream 就已经从“提示词”变成“可玩的 SillyTavern 叙事引擎扩展”了。
