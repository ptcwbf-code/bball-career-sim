# AGENTS.md — BBall Career Simulator

给 AI Coding Agent 阅读的项目说明。改动代码前请先读这份文件。

## 项目目标

一个 NBA 篮球生涯模拟器：玩家创建球员 → 参加选秀 → 逐场模拟常规赛 → 结算赛季、拿奖、成长 → 休赛期训练 → 进入下一个赛季，如此循环。附带媒体采访、代言、投资等场外玩法。

## 技术方案

- **Frontend**: HTML + CSS + 原生 JavaScript（Tailwind 通过 CDN 引入，Chart.js 通过 CDN 引入）。运行在浏览器。
- **Backend**: Node.js + Express，监听 `localhost:3000`。
- **Database**: SQLite，使用 Node 内置的 `node:sqlite`（`DatabaseSync`）。无 ORM，直接写 SQL。
- **通信**: Frontend 通过 HTTP 请求 Backend 的 JSON API（`/api/*`）。

明确不使用：Python、React/Vue/Next、TypeScript、Docker、ORM，以及任何不必要的框架。

## 项目结构

```
bball-career-sim/
├─ AGENTS.md          ← 本文件
├─ frontend/          ← 浏览器运行的东西
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ backend/           ← 服务器运行的东西
│  ├─ package.json
│  └─ server.js
└─ database/          ← 数据存储相关
   ├─ init.sql        ← 建表 SQL
   └─ app.db          ← 实际数据库文件（运行时生成/复用）
```

三层职责：

- `frontend/`：只负责界面和交互，通过 `fetch('/api/...')` 调后端。
- `backend/`：只负责处理请求、跑游戏逻辑、执行 SQL、返回 JSON。
- `database/`：数据存储。表结构定义在 `init.sql`，实际数据在 `app.db`。

不要把前端、后端、数据库的代码混在同一个目录。

## 如何运行

```bash
cd backend
npm install        # 只需要安装 express 一个依赖
npm start          # 等价于 node server.js
```

然后浏览器打开 <http://localhost:3000>。

## API 一览

所有 API 都在 `/api/*` 下，返回 JSON。请求参数：路径参数放在 URL 里，可选参数用 query string，POST 的 JSON body 用于创建玩家。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/player/create` | 创建球员（body 传名字/位置/身高/体重/加点） |
| GET | `/api/player/:id` | 读取球员（含 overall、球队名） |
| GET | `/api/player/:id/attributes` | 球员属性分组 |
| GET | `/api/player/:id/season-stats` | 本赛季场均数据 |
| PUT | `/api/player/:id/role?role=...` | 改场上角色 |
| PUT | `/api/player/:id/load-management?enabled=...` | 负荷管理开关 |
| GET | `/api/draft/point-pool` | 计算可分配点数 |
| POST | `/api/draft/simulate/:id` | 模拟选秀 |
| GET | `/api/draft/class` | 选秀名单 |
| POST | `/api/game/simulate/:id` | 模拟一场比赛 |
| POST | `/api/game/simulate-batch/:id?count=5` | 连续模拟 N 场 |
| GET | `/api/game/logs/:id` | 比赛记录 |
| GET | `/api/season/state` | 联盟阶段状态 |
| POST | `/api/season/advance-phase` | 推进阶段 |
| POST | `/api/season/finalize/:id` | 结算赛季 |
| GET | `/api/season/schedule/:teamId` | 赛季赛程 |
| GET | `/api/season/summaries/:id` | 历史赛季 |
| GET | `/api/training/programs` | 训练项目列表 |
| POST | `/api/training/apply/:id?program=...` | 执行训练 |
| GET/POST | `/api/economy/...` | 代言/投资 |
| GET/POST | `/api/media/...` | 媒体事件 |
| POST | `/api/clout/request-trade/:id` | 要求交易 |
| GET | `/api/career/:id` | 生涯总览 |
| GET | `/api/teams` | 球队列表 |
| GET | `/api/league/standings` | 联盟排名 |
| GET | `/api/save/*` | 存档/读档 |
| GET | `/api/health` | 健康检查 |

## 开发原则

1. **只改该改的地方**：修 bug 时改后端游戏逻辑（`backend/server.js`），改界面时改 `frontend/`，改表结构时改 `database/init.sql`。
2. **SQL 直接写**，不要引入 ORM。
3. **不要加新依赖**：当前后端只依赖 `express`。数据库用 Node 内置 `node:sqlite`。
4. **保持 API 契约不变**：前端 `app.js` 里的路径和字段名与后端返回值一一对应，改字段名要两边同步。
5. **游戏数值用常量**：球员数值、球队 OVR、概率系数都集中在 `server.js` 顶部的常量区，方便调平衡。

## 每个 API 的数据流示例

以「模拟一场比赛」为例，说明每一层的往返：

```
Frontend 发请求:  POST /api/game/simulate/<playerId>
Backend 收到:     playerId（路径参数）
执行 SQL:         SELECT * FROM players WHERE id=?       （读球员）
                  SELECT * FROM league_state WHERE id=1  （读赛季状态）
                  INSERT INTO game_logs (...) VALUES (...)
                  UPDATE players SET s_pts=..., ... WHERE id=?
                  UPDATE league_state SET games_played_in_season=... 
Database 返回:    球员行、赛季状态行；INSERT/UPDATE 返回受影响行数
Backend 返回 JSON: { game_number, opponent, result, team_score, minutes, box_score, advanced, ... }
Frontend 怎么显示: 在 Play Game 页的 #g-result 里渲染比分、个人数据和高级数据。
```
