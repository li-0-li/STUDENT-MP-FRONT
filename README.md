# mp/student · 学生小程序（微信原生）

学生端小程序**全量前端**：24 页 + 5-tab 底部导航，覆盖骨架 UI 原型
（`ui-prototype/mp/app-*.html`）的全部学生页面。

## 页面清单与接口状态

### M-B 真实接口（本模块交付，后端已实现）

| 目录 | 标题 | 原型 | 接口 |
|---|---|---|---|
| `pages/courses` | 我的课程（tab） | `app-courses.html` | 表 3-1 课程列表（学生「我学的课」） |
| `pages/course-add` | 添加课程 | `app-course-add.html` | 表 3-3 加课（课程码/扫码） |
| `pages/course-detail` | 章节作业 | `app-course-detail.html` | 表 3-2 详情（课程信息+周目录，真实）；作业列表待 M-C |
| `pages/resource-view` | 资源查看 | `resource-view.html` | 表 3-2 周目录 + 表 3-4 资源列表 |

### 登录（表 2-1 契约，后端归 M-A）

| 目录 | 标题 | 说明 |
|---|---|---|
| `pages/login` | 登录 | 账号密码（clientType=mp_student）；开发期带「快捷登录」按钮走 dev-token |
| `pages/register` | 注册账号 | 前端校验版，接口待 M-A |
| `pages/forgot-password` | 找回密码 | 三步流程 UI，接口待 M-A |

### 其他模块页面（静态演示数据，联调时替换）

| 目录 | 归属模块 | 页面 |
|---|---|---|
| profile / settings / change-phone / change-pwd / notice | M-A | 我的（tab）/ 设置 / 换绑手机 / 修改密码 / 通知公告 |
| homework / submission / lab | M-C | 我的作业 / 作业提交 / 实验报告 |
| ai / analytics | M-D | AI 答疑 / 我的学情 |
| home / schedule / live / attendance / messages / support | M-E | 首页（tab）/ 课表（tab）/ 课堂参与 / 签到 / 消息（tab）/ 客服帮助 |

> 各页 js 顶部均有 `// TODO 联调：接口由 M-X 提供（表 x-x）` 标注；
> 联调时把静态 data 换成 `utils/api.js` 增补的对应接口调用即可，页面结构无需改。

## tabBar

首页 / 我的课程 / 我的课表 / 消息通知 / 我的（`app.json` 声明）。
跳转约定：tabBar 页用 `wx.switchTab`，其余 `wx.navigateTo`。

## 运行

1. 后端：SSH 隧道 + `java -jar target/itap-server-1.0.0.jar`（见 m-b/README.md）
2. 微信开发者工具导入本目录（测试号 AppID），勾选「不校验合法域名」
3. 登录页点「快捷登录」（学生 1002 李浩一）→ 进入首页

## 合并 TODO

- M-A 后端（RuoYi-Vue，见仓库根 `RuoYi-Vue/`）合入后：登录页走真实
  `POST /v1/auth/login`，删除 `pages/dev-login` 与登录页快捷登录按钮
- `utils/api.js` 按联调进度增补 M-C/D/E 接口；各静态页替换数据源
- tabBar 图标：当前为纯文字 tab，视觉定稿后补 81x81 图标
