用户要求结束当前故事。请基于当前剧本、当前状态、当前回合、关键选择和已触发事件生成结局结算。

输出格式：
1. 先输出用户可见的结局正文，并按【标题】、【环境】、【结局】的顺序流式输出。结局正文包括评级、结局描述、人生轨迹总结、关键选择回顾、分享标题和个人评语。
2. 末尾输出一个合法的 `<!-- DAYDREAM_META ... -->` JSON 注释块：

<!-- DAYDREAM_META
{
  "title": "结局标题",
  "screen": "结局镜头",
  "status_changes": [],
  "stats_delta": {},
  "stats": {},
  "events": ["结局已生成"],
  "relationships": [],
  "resources": [],
  "active_hooks": [],
  "pending_foreshadows": [],
  "important_branches": [],
  "options": [],
  "is_ending": true
}
-->

结局不得另起炉灶，必须体现当前玩法分类的核心回报。
