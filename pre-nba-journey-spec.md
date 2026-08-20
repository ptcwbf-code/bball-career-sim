# Pre-NBA Journey System — Implementation Spec

> 扩展创建向导，把"从出生到选秀"做成一个完整的早期生涯模拟。选国籍 → 走完童年/少年/选秀前联赛 3 层选择 → 遇到人生事件 → 参加联合试训/球队试训 → 进入选秀。每一步影响属性、选秀顺位、和生涯叙事。

---

## 1. 总体架构

### 1.1 创建向导新流程（6 步）

| 步骤 | 名称 | 内容 |
|------|------|------|
| 1 | **Origin** | 名字、位置、年龄（19-23）、国籍（已有 `NATIONALITIES`） |
| 2 | **Journey** | 3 层成长路径 + 每层 1 个随机人生事件（本 spec 核心） |
| 3 | **Build** | 身高/体重（现有逻辑不变） |
| 4 | **Skills** | 加点（点池受路径修正影响，现有逻辑 + 路径偏移） |
| 5 | **Combine** | 联合试训 + 球队试训（新步骤，影响 combineSwing） |
| 6 | **Draft** | 选秀之夜（现有逻辑，但 combineSwing 受前 5 步影响） |

### 1.2 数据流

```
国籍 → 决定可用的路径选项（第 2 步）
  ↓
3 层路径选择 → 产生 youth_effects（属性修正）+ path_label + exposure（选秀曝光度）
  ↓
路径随机事件 → 可能追加属性修正 / 预埋关系 / 改变 exposure
  ↓
加点时 → calculatePointPool 的 base_points 叠加 youth_effects 偏移
  ↓
联合试训 → 根据属性 roll 试训表现 → 修正 combineSwing
  ↓
球队试训 → 玩家选择去哪些队试训 → 影响选秀目标队 + 小幅 combineSwing
  ↓
选秀 → combineSwing = 基础 ± 曝光度偏移 ± 试训修正
```

### 1.3 存储

路径选择结果存进 `S.create` 前端状态，创建完成后：
- 属性修正直接 apply 到 `createPlayerWithPoints`
- 路径标签写入 `career_progress`（`event_type: 'origin'`）
- 随机事件的效果写入对应表（relationships / career_progress / attributes）
- 无需新数据库表

---

## 2. 第 2 步 Journey：3 层路径选择

### 2.1 国家分组

根据 `NATIONALITIES` 的 16 个国家，分成 4 个路线组：

| 路线组 | 国家 | 特征 |
|--------|------|------|
| **USA** | USA, Canada | AAU/高中体系、NCAA 是默认路径 |
| **China** | China | 体校/CBA 青年队、海外镀金是差异化路径 |
| **Europe** | France, Spain, Serbia, Greece, Germany, Lithuania, Slovenia, Italy | 俱乐部青训体系、青年联赛 + 一队借调 |
| **Global** | Australia, Argentina, Brazil, Japan, Nigeria | 混合路径，类似欧洲但有独特选项 |

每个路线组定义一套 3 层选项。国籍不在上述列表的 fallback 到 `Global`。

### 2.2 第一层：童年（Childhood，约 6-12 岁）

**主题：你在哪里接触篮球、你的基础训练是什么样的**

#### USA 路线

| ID | 标签 | 图标 | 描述 | effects | 备注 |
|----|------|------|------|---------|------|
| `aau` | AAU Circuit | 🏟️ | 10 岁起参加全美 AAU 巡回赛，和全国最好的同龄人竞争 | `catch_shoot_3pt: 2, off_ball: 2, bbiq: 1` | 高起点，exposure +1 |
| `street` | Streetball | 🏀 | 在街头球场长大，没有教练，全靠本能和创造力 | `finishing: 3, first_step: 2, ball_security: -2, bbiq: -1` | raw talent，potential +2 |
| `hs_team` | High School Team | 🏫 | 在高中校队接受正规训练，按部就班 | `composure: 2, work_ethic: 1` | 标准路径，无特殊偏移 |

#### China 路线

| ID | 标签 | 图标 | 描述 | effects | 备注 |
|----|------|------|------|---------|------|
| `sports_school` | 体校 | 🇨🇳 | 从小进入省市体校，接受半军事化篮球训练 | `stamina: 3, strength: 2, composure: -2` | 物理强，心理压力大 |
| `school_ball` | 校园篮球 | 🏫 | 在普通学校打球，兼顾学业和运动 | `bbiq: 1, composure: 2` | 均衡，exposure -1 |
| `private` | 私立训练营 | 💰 | 家庭出钱送进顶级篮球训练营（如东莞篮球学校） | `catch_shoot_3pt: 2, mid_range: 2` | 起始 wealth -1（家庭投入） |

#### Europe 路线

| ID | 标签 | 图标 | 描述 | effects | 备注 |
|----|------|------|------|---------|------|
| `club_academy` | Club Academy | 🏟️ | 加入职业俱乐部青训（如巴萨、皇马、奥林匹亚科斯） | `bbiq: 3, composure: 2, passing_accuracy: 1` | 体系化，exposure +1 |
| `dual_track` | School + Club | 🏫 | 白天上学、下午训练，两不耽误 | `bbiq: 1, leadership: 2` | 均衡 |

#### Global 路线（Australia / Argentina / Brazil / Japan / Nigeria）

| ID | 标签 | 图标 | 描述 | effects | 备注 |
|----|------|------|------|---------|------|
| `street` | Streetball | 🏀 | 在街头找到篮球，全靠天赋和拼劲 | `finishing: 3, first_step: 2, ball_security: -2` | raw talent，potential +3 |
| `youth_club` | Youth Club | 🏟️ | 当地俱乐部的青少年队 | `bbiq: 2, composure: 1` | 标准路径 |
| `school` | School Ball | 🏫 | 学校组织的篮球队 | `composure: 2, work_ethic: 1` | 均衡 |

### 2.3 第二层：少年（Teenage，约 13-17 岁）

**主题：你在什么级别的比赛中成长、你的竞技经历是什么**

#### USA 路线

| ID | 标签 | 图标 | 描述 | effects | 前置/联动 |
|----|------|------|------|---------|-----------|
| `hs_star` | High School Star | ⭐ | 全美高中排名靠前，各大名校争相招募 | `off_ball: 1, composure: 2` | exposure +2 |
| `multi_sport` | Multi-Sport Athlete | 🏈 | 篮球之外还打橄榄球/田径，身体素质全面发展 | `vertical_jump: 2, speed: 2, stamina: 2, catch_shoot_3pt: -1` | 专项 skill 稍弱 |
| `focused` | Basketball Only | 🎯 | 全身心投入篮球，放弃其他运动 | `catch_shoot_3pt: 2, pnr_vision: 1, finishing: 1` | 纯篮球发展 |

#### China 路线

| ID | 标签 | 图标 | 描述 | effects | 前置/联动 |
|----|------|------|------|---------|-----------|
| `cba_youth` | CBA 青年队 | 🏀 | 进入 CBA 俱乐部青年队，和成年球员一起训练 | `bbiq: 3, composure: 2, mid_range: 1` | exposure +1 |
| `stay_school` | 继续校园篮球 | 🏫 | 留在学校体系，打全国中学生联赛 | `composure: 1, work_ethic: 2` | 标准 |
| `overseas_early` | 少年留洋 | ✈️ | 15 岁被送到澳洲/欧洲训练，离开舒适区 | `composure: -1, bbiq: 2, mid_range: 2` | exposure +1，morale -5（初到异国） |

#### Europe 路线

| ID | 标签 | 图标 | 描述 | effects | 前置/联动 |
|----|------|------|------|---------|-----------|
| `youth_league` | Youth League Starter | ⭐ | 青年联赛主力，全国关注 | `scoring: 1, composure: 2` | exposure +1 |
| `train_with_first` | Train with Senior Team | 🏟️ | 虽然打青年联赛，但平时跟一队训练 | `bbiq: 3, composure: 1` | 和成年球员对抗 |
| `loan` | Loan to Lower Division | 🔄 | 被俱乐部借去低级别联赛打主力 | `leadership: 2, finishing: 2` | 独立成长 |

#### Global 路线

| ID | 标签 | 图标 | 描述 | effects | 前置/联动 |
|----|------|------|------|---------|-----------|
| `national_junior` | National Junior Team | 🌍 | 入选国家队青年队，打 FIBA 青年赛事 | `bbiq: 2, composure: 2` | exposure +2（见 §4 青年队事件） |
| `local_league` | Local League | 🏀 | 在本国联赛打上球 | `finishing: 2, strength: 1` | exposure +0 |
| `move_abroad` | Move Abroad | ✈️ | 去澳洲/欧洲/美国寻找机会 | `composure: -1, bbiq: 2, work_ethic: 2` | exposure +1 |

### 2.4 第三层：选秀前联赛（Pre-Draft League，约 17-19 岁）

**主题：你在哪里打出名堂、NBA 球探能不能看到你**

#### USA 路线

| ID | 标签 | 图标 | 描述 | effects | exposure |
|----|------|------|------|---------|----------|
| `ncaa_d1` | NCAA Division I | 🎓 | 大学篮球最高舞台，全国直播 | `bbiq: 1, composure: 1` | **高** (+3) |
| `ncaa_lower` | NCAA D2/D3 | 🏫 | 低级别大学篮球，关注度低 | `work_ethic: 2, composure: 2` | **低** (-3) |
| `gleague` | G-League Ignite | 🔥 | 跳过大学直接打职业，面对成年球员 | `finishing: 2, first_step: 1` | **中** (+0) |

#### China 路线

| ID | 标签 | 图标 | 描述 | effects | exposure |
|----|------|------|------|---------|----------|
| `cba` | CBA 一队 | 🏀 | 国内联赛顶级，CBA 全明星级表现 | `mid_range: 2, composure: 2` | **低** (-2)，国内 clout +8 |
| `nbl` | NBL (Australia) | 🇦🇺 | 去澳洲 NBL 镀金，NBA 球探关注澳洲联赛 | `bbiq: 2, composure: 1` | **中** (+1) |
| `ncaa_us` | NCAA (USA) | 🎓 | 直接去美国打大学篮球 | `catch_shoot_3pt: 1, bbiq: 1` | **高** (+3)，初始 morale -8 |
| `draft_direct` | 直接参选 | 🎟️ | 极罕见，只有顶级天才才会跳过所有中间步骤 | 无额外修正 | **中** (-1)，story hook |

#### Europe 路线

| ID | 标签 | 图标 | 描述 | effects | exposure |
|----|------|------|------|---------|----------|
| `domestic_first` | Domestic League First Team | 🏟️ | 本国联赛一队常规轮换 | `composure: 2, bbiq: 1` | **低** (-1) |
| `euroleague` | EuroLeague | 🌟 | 欧洲最高水平俱乐部赛事 | `bbiq: 2, composure: 2, pnr_vision: 1` | **高** (+3) |
| `ncaa_us` | NCAA (USA) | 🎓 | 去美国打大学篮球 | `catch_shoot_3pt: 1, bbiq: 1` | **高** (+3)，初始 morale -6 |

#### Global 路线

| ID | 标签 | 图标 | 描述 | effects | exposure |
|----|------|------|------|---------|----------|
| `local_pro` | Local Professional League | 🏀 | 在本国职业联赛打球 | `composure: 2, mid_range: 1` | **低** (-2) |
| `nbl` | NBL (Australia) | 🇦🇺 | 澳洲 NBL，被 NBA 球探注意 | `bbiq: 2` | **中** (+1) |
| `ncaa_us` | NCAA (USA) | 🎓 | 去美国打大学篮球 | `catch_shoot_3pt: 1` | **高** (+3) |

---

## 3. 路径修正效果（怎么叠加到游戏里）

### 3.1 属性修正

3 层选择的 `effects` 对象直接叠加。每条 ±1~3，总量控制在 **±12 以内**（3 层 × 最大 ±4/层）。

在 `createPlayerWithPoints` 里，`BACKGROUNDS` 的 effects 处理完之后，再叠一层 `youthEffects`：

```js
// 已有: bgFx = BACKGROUNDS[bg].effects
// 新增:
for (const [k, v] of Object.entries(youthEffects)) {
  if (k === 'potential') potential = clamp(potential + v, 18, 99);
  else if (k === 'wealth_offset') { /* 起始财富调整 */ }
  else attrs[k] = clamp((attrs[k] ?? 50) + v, 18, 94);
}
```

### 3.2 点池偏移

精英路径（exposure 高）的球员 `base_points` +5~10，野路子（exposure 低）的 `potential` +3~6。在 `calculatePointPool` 里加一个 `pathBonus` 参数：

```js
function calculatePointPool(position, height, weight, luckBonus = null, pathBonus = 0) {
  const base = profile.base_points + pathBonus;
  // ... 其余不变
}
```

`pathBonus` 由 exposure 累计决定：高曝光 +8，中 +0，低 +0 但 potential 修正 +4。

### 3.3 选秀曝光度 → combineSwing

`simulateDraft` 里的 `combineSwing` 原来是 `randInt(-8, 8)`。改成：

```js
const exposureBias = youthExposure; // 从 S.create 或 player 参数传入
const combineSwing = randInt(-8, 8) + exposureBias;
```

exposure 值的映射：

| 第三层选择 | exposure |
|-----------|----------|
| NCAA D1 / EuroLeague / NCAA(USA) | +3 |
| G-League / NBL / CBA 青年队 | +1 |
| CBA / 本国联赛 / NCAA D2-D3 | -2 |
| 直接参选（中国） | -1 |

---

## 4. 国家队青年队事件（FIBA Youth Tournaments）

### 4.1 触发条件

在 Journey 第 2 层选择后、第 3 层选择前，如果满足以下条件之一，触发"国家队征召"事件：
- 第 2 层选了 `national_junior`
- 国籍非 USA 且第 2 层的属性足够高（overall 估算 > 55）

### 4.2 赛事数据

```js
const FIBA_YOUTH = {
  u17: { label: 'FIBA U17 World Cup', icon: '🌍', age_req: 17,
    teams: ['USA', 'Spain', 'France', 'Serbia', 'Lithuania', 'Argentina', 'Australia', 'China',
            'Turkey', 'Canada', 'Egypt', 'Mali', 'Japan', 'Philippines', 'Germany', 'Italy'],
    desc: 'The biggest stage for youth basketball. NBA scouts are watching every game.' },
  u19: { label: 'FIBA U19 World Cup', icon: '🌍', age_req: 19,
    teams: ['USA', 'Spain', 'France', 'Serbia', 'Lithuania', 'Argentina', 'Australia', 'China',
            'Turkey', 'Canada', 'Nigeria', 'Japan', 'Germany', 'Italy', 'Greece', 'Brazil'],
    desc: 'The final showcase before the draft. A breakout here can change everything.' },
};
```

### 4.3 模拟逻辑

不需要逐场模拟。用一个简单的 **"赛事表现 roll"**：

```js
function simulateFibaYouth(playerAttrs, tournament, nationality) {
  const overall = estimateOverall(playerAttrs); // 简化版 calculateOverallRating
  const teamStrength = FIBA_TEAM_STRENGTH[nationality] || 60;

  // 你的表现 = 你的能力 × 随机波动
  const perfRoll = overall * randRange(0.7, 1.4);

  // 球队成绩 = 队伍实力 × 随机波动
  const teamRoll = teamStrength * randRange(0.6, 1.3);

  // 奖牌判定
  let medal = null;
  if (teamRoll > 85 && perfRoll > 60) medal = 'gold';
  else if (teamRoll > 75 && perfRoll > 55) medal = 'silver';
  else if (teamRoll > 70 && perfRoll > 50) medal = 'bronze';

  // 你的数据线（用来写叙事）
  const ppg = Math.round(clamp(overall * 0.35 + gauss(0, 4), 4, 30));
  const rpg = Math.round(clamp(overall * 0.12 + gauss(0, 2), 1, 12));
  const apg = Math.round(clamp(overall * 0.10 + gauss(0, 2), 0, 10));

  return { medal, ppg, rpg, apg, teamFinish: medal ? medal : 'quarterfinals' };
}
```

### 4.4 奖励

| 结果 | exposure | clout | fan_base | narrative |
|------|----------|-------|----------|-----------|
| 金牌 + 你场均 20+ | +3 | +8 | +12 | "你带领 [国家] 赢得 U19 金牌，NBA 球探把你列入首轮候选。" |
| 金牌 + 你表现一般 | +2 | +5 | +8 | "[国家] 赢得金牌，你是团队一员。" |
| 银牌/铜牌 + 你出色 | +2 | +5 | +6 | "你在 U19 打出了亮眼表现，虽然没拿金牌但球探记住了你的名字。" |
| 淘汰 + 你出色 | +1 | +3 | +3 | "[国家] 止步八强，但你场均 22 分的表现令人印象深刻。" |
| 淘汰 + 你平庸 | 0 | +1 | +1 | "U19 之旅结束了。你没有太多表现机会。" |
| 未入选/未参加 | 0 | 0 | 0 | 不触发事件 |

### 4.5 叙事事件卡片

赛事结束后弹出一张事件卡，包含：
- 赛事名称 + 国旗
- 你的数据线（PPG/RPG/APG）
- 球队成绩 + 你的奖牌（如有）
- 一句话叙事（根据 perfRoll 从预设文案池中选取）
- 一个小选择（可选）：
  - "赛后接受采访，你说了什么？" → 影响 clout/fan_base（复用 MEDIA_SCENARIOS 结构）

---

## 5. 联合试训 & 球队试训（Step 5: Combine）

### 5.1 联合试训（NBA Draft Combine）

选秀前自动触发，不需要玩家选择，但玩家可以看到试训结果。

**模拟内容（纯数值 roll，不逐项模拟）：**

```js
function simulateCombine(attrs) {
  // 体测：基于 athleticism 属性
  const agility = clamp(attrs.lateral_quickness * 0.4 + attrs.speed * 0.4 + attrs.core_stability * 0.2, 20, 99);
  const sprint = clamp(attrs.speed * 0.6 + attrs.first_step * 0.4, 20, 99);
  const vert = clamp(attrs.vertical_jump * 0.8 + attrs.strength * 0.2, 20, 99);
  const bench = clamp(attrs.strength * 0.7 + attrs.core_stability * 0.3, 20, 99);

  // 投篮测试：基于 shooting 属性
  const spot_up = clamp(attrs.catch_shoot_3pt * 0.7 + attrs.mid_range * 0.3, 20, 99);
  const off_dribble = clamp(attrs.pull_up_3pt * 0.5 + attrs.mid_range * 0.5, 20, 99);

  // 对抗赛表现：综合 + 随机
  const scrimmage = clamp(calculateOverallRating(attrs) + gauss(0, 8), 25, 95);

  // 综合评分 → 对 combineSwing 的影响
  const combineScore = (agility + sprint + vert + spot_up + scrimmage) / 5;
  const swing = Math.round((combineScore - 60) / 8); // 大约 -4 到 +5

  return {
    measurements: { agility, sprint, vert, bench },
    shooting: { spot_up, off_dribble },
    scrimmage,
    combine_score: round1(combineScore),
    combine_swing: swing,
  };
}
```

**展示：** 试训结果卡片，显示各项得分 + 高亮亮眼项（>75 绿色）和短板（<40 红色）。叙事："你在联合试训中 [表现出色/中规中矩/令人失望]。"

### 5.2 球队试训（Team Workouts）

联合试训之后，给玩家一个选择：**从 6 支随机球队中选 2-3 支去试训**。

**逻辑：**
- 6 支候选队 = 选秀前 14 支（lottery）中随机抽 6 支
- 玩家选 2-3 支去试训
- 每支试训的效果：
  - 如果你的 overall + combine 表现 > 该队的选秀需求 → 该队对你兴趣 +1（存在 `S.create.workout_teams` 里，传给 `simulateDraft`）
  - 试训叙事："你在 [球队名] 的试训中 [表现抢眼/表现一般/搞砸了]"
- **选秀时**：如果被选中的球队在 `workout_teams` 里，该队选你的概率小幅上升

**展示：** 6 张球队卡片（显示队名、当前 OVR、选秀顺位预测、他们的需求位置），玩家点选 2-3 张。选完后每张卡片翻转显示试训结果叙事。

### 5.3 对选秀的影响

`simulateDraft` 改为：

```js
// 原来: combineSwing = randInt(-8, 8)
// 改为:
const combineSwing = randInt(-8, 8)
  + (createData.exposure || 0)      // 来自 Journey 第 3 层
  + (createData.combine_swing || 0) // 来自联合试训
  + (workoutBonus || 0);            // 来自球队试训（被选中队 +1~2）
```

---

## 6. 路径随机人生事件（每层 1 个）

每个 Journey 层选择后，roll 一个随机事件。事件结构复用现有 `CAREER_EVENTS` 格式。

### 6.1 童年层事件池（每条 weight 相同，随机抽 1 个）

```js
const CHILDHOOD_EVENTS = [
  { id: 'coach_notice', title: 'A Coach Notices You',
    text: 'A local coach saw you play and offered to train you for free. You started learning the game the right way.',
    effects: { work_ethic: [0, 2], bbiq: [0, 1] } },
  { id: 'family_hardship', title: 'Family Hardship',
    text: 'Money was tight. You almost had to quit basketball to help at home.',
    choices: [
      { text: 'Keep playing — basketball is my way out.', effects: { work_ethic: [1, 3], morale: [-3, -1] } },
      { text: 'Help the family first.', effects: { composure: [1, 2], morale: [-1, 0] } },
    ] },
  { id: 'first_injury', title: 'First Real Injury',
    text: 'A bad ankle sprain at 11 kept you out for months. The recovery taught you patience.',
    effects: { durability: [1, 2], composure: [1, 2] } },
  { id: 'idol', title: 'Meeting Your Idol',
    text: 'You met a professional basketball player at a camp. He told you to never stop working.',
    effects: { morale: [3, 6], work_ethic: [0, 2] } },
  { id: 'natural', title: 'Natural Gift',
    text: 'Everyone said you were the most talented kid they\'d ever seen. It went to your head a little.',
    effects: { potential: [2, 4], composure: [-2, 0], morale: [2, 4] } },
];
```

### 6.2 少年层事件池

```js
const TEEN_EVENTS = [
  { id: 'breakout_game', title: 'Breakout Performance',
    text: 'In a national tournament, you scored 35 points in front of scouts. Your name started circulating.',
    effects: { clout: [3, 6], morale: [2, 5] } },
  { id: 'friend_nba', title: 'A Friend Turns Pro',
    text: 'A teammate from your youth days just signed a professional contract. It lit a fire in you.',
    effects: { work_ethic: [1, 3], morale: [1, 3] } },
  { id: 'scout_notice', title: 'Scouts Are Watching',
    text: 'NBA scouts started showing up at your games. The pressure was real.',
    choices: [
      { text: 'Use the pressure as fuel.', effects: { composure: [1, 2], work_ethic: [1, 2] } },
      { text: 'It got in my head a little.', effects: { composure: [-2, 0], potential: [0, 2] } },
    ] },
  { id: 'setback', title: 'A Setback',
    text: 'You were cut from a select team. It was humiliating — but it made you work harder.',
    effects: { work_ethic: [2, 4], composure: [1, 2], morale: [-4, -2] } },
  { id: 'mentor_appears', title: 'An Unexpected Mentor',
    text: 'A retired pro started training at your gym. He took an interest in your game.',
    effects: { bbiq: [1, 3], leadership: [1, 2] },
    // 预埋一个 mentor 关系：创建时写入 relationships 表
    relationship: { type: 'mentor', name: 'Coach Davis', bond: 45 } },
];
```

### 6.3 选秀前层事件池

```js
const PREDRAFT_EVENTS = [
  { id: 'march_madness', title: 'March Madness Heroics',
    text: 'You hit a buzzer-beater in the tournament. The clip went viral worldwide.',
    effects: { clout: [5, 10], fan_base: [5, 10] },
    exposure_bonus: 2 },
  { id: 'injury_scare', title: 'Pre-Draft Injury Scare',
    text: 'A minor injury in your last game scared off some teams. Your draft stock dipped.',
    effects: { morale: [-5, -2] },
    exposure_bonus: -2 },
  { id: 'agent_offer', title: 'Agents Come Calling',
    text: 'Multiple agents are trying to sign you. One promises top-5 pick guarantees.',
    choices: [
      { text: 'Sign with the flashy agent.', effects: { clout: [1, 3] } },
      { text: 'Go with the reliable one.', effects: { composure: [1, 2] } },
    ] },
  { id: 'viral_workout', title: 'Viral Workout Video',
    text: 'A video of your training session got millions of views. Hype is building.',
    effects: { clout: [3, 6], fan_base: [3, 6] },
    exposure_bonus: 1 },
  { id: 'family_pressure', title: 'Family Expectations',
    text: 'Your whole town is watching. The pressure of representing everyone is weighing on you.',
    choices: [
      { text: 'Carry the weight — I play for them.', effects: { leadership: [1, 3], morale: [-2, 0] } },
      { text: 'Block it out — focus on myself.', effects: { composure: [1, 2] } },
    ] },
];
```

---

## 7. 路径叙事存档（career_progress 写入）

创建完成后，按顺序写入以下 career_progress 条目（`event_type: 'origin'`）：

```
S0: Born in Shanghai, China (nationality)
S0: Grew up in the sports school system (childhood path)
S0: Joined CBA youth team at 13 (teen path)
S0: Represented China at FIBA U19 — silver medal, 18.3 PPG (fiba event)
S0: Played for CBA senior team (pre-draft path)
S0: Solid showing at NBA Draft Combine — 67 overall score (combine)
S0: Worked out for Houston, San Antonio, Dallas (workouts)
S0: Drafted 42nd overall by San Antonio Spurs (draft)
```

这给生涯时间线一个完整的"从哪来"叙事，退役回看时一目了然。

---

## 8. 前端 UI 设计

### 8.1 Journey Step（第 2 步）UI

顶部一个**可视化时间线**：

```
🌱 Childhood ──→ 🏀 Teenage ──→ 🎓 Pre-Draft
     [选择中]         待选择         待选择
```

每层：3-4 张选择卡片（每张：图标 + 标签 + 描述 + 属性效果预览 + 曝光度条），选中后高亮，下方出现随机事件卡（有选择的事件显示两个按钮）。事件处理完后时间线推进到下一层。

底部：**实时路径总结**（和 `buildSummaryHTML` 类似），显示路径修正的累计效果 + 曝光度。

### 8.2 Combine Step（第 5 步）UI

- 联合试训结果卡：体测/投篮/对抗赛各项分数，用 `bar-fill` 可视化
- 球队试训选择：6 张球队卡片，点选 2-3 张，选完后翻转显示结果
- 底部：选秀顺位预测范围（根据 combineSwing 累计值）

### 8.3 选秀夜增强

- 显示选秀顺位时，附带一句路径叙事（"从体校走出的少年，如今在 NBA 选秀大会上听到自己的名字"）
- Top 10 球员列表中，你的名字旁标注"你"（已有），加上国家旗帜（`NATIONALITIES`）

---

## 9. 不动的东西

- **数据库表结构**：无需新表，`nationality` 字段已存在，`career_progress` 的 `event_type` 可扩展
- **比赛引擎**：路径修正只影响初始属性，不影响 `simulateGame`
- **AI 球员系统**：路径只影响玩家创建的球员
- **选秀逻辑**：`simulateDraft` 的核心不变，只加 `combineSwing` 的偏移来源
- **现有 background**：保留，和路径系统叠加（背景 = 你的性格/出身，路径 = 你的经历）

---

## 10. 实现优先级

| 阶段 | 内容 | 成本 |
|------|------|------|
| **Phase 1** | Journey 数据结构（USA + China 两条路线，各 3 层 × 3 选项）+ 前端 Step 2 UI | 中 |
| **Phase 2** | 路径随机事件（3 层各 5 个事件池）+ 事件 UI | 低 |
| **Phase 3** | FIBA 青年队事件（U17 + U19 模拟 + 奖牌叙事） | 低 |
| **Phase 4** | 联合试训（数值 roll + 结果卡）+ 球队试训（选择 + 叙事） | 中 |
| **Phase 5** | Europe + Global 路线（更多选项）+ 路径标签进 career_progress | 低 |
| **Phase 6** | 选秀夜叙事增强（路径总结 + 国旗 + 路径文案） | 低 |

**Phase 1-4 是 MVP**，覆盖 USA + China 两条完整路线。Phase 5-6 是锦上添花。
