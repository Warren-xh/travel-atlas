# 行迹 Atlas

一张属于自己的旅行地图。免费部署到 GitHub Pages，地图、国旗和脚本均从本仓库加载，没有付费地图接口或外部字体，记录由独立发布后台保存。

- [打开地图](https://warren-xh.github.io/travel-atlas/)
- [进入管理](https://warren-xh.github.io/travel-atlas/#admin)

## 可以做什么

- 按世界与七大洲浏览；搜索中文、英文、ISO 代码，支持英文重音字符。
- 自定义五种图例颜色与名称，点击图例筛选国家；小型国家以圆点补充。
- 缩放、平移、国家定位、全屏地图、导出带图例的 SVG。
- 旅行日期与笔记、旅行清单、最近旅程、足迹统计；统计包含国家和地区。
- 明暗主题、手机适配、键盘搜索、可访问的控件与减少动态效果支持。
- 管理密码解锁后编辑；草稿自动保存，支持撤销、重做、近期快照恢复。
- 管理主页名称、标题、介绍与默认国家；JSON 备份导入和导出。
- 发布前预览修改；自动合并不同设备的独立修改，相同字段的冲突由你选择。
- 发布后再次读取服务器，确认所有设备能看到新记录。

## 密码管理与发布

1. 打开地图，点击「管理地图」，输入拥有者设置的管理密码。
2. 修改国家颜色、日期、笔记、主页文字或图例；草稿自动保存到本机。
3. 点击「发布修改」，查看修改清单，再点击「确认发布到网站」。
4. 后台验证密码并保存记录，原 GitHub Pages 地图网址在所有设备读取更新。

无需创建、输入或保存 GitHub Token，也不需要首次配置页面。密码仅在后台 Secret 中配置，网页中只在管理会话内存里保留；刷新、手动锁定或闲置 15 分钟后需重新输入。

地图源码继续由本 GitHub 仓库管理。发布记录保存在独立后台的私有存储中，由公开地图读取；不会为每次记录修改生成 GitHub 提交，也不需要 Codex 对话保持运行。

后台地址：https://travel-atlas-publish-warren.neoncorgi.chatgpt.site

- 密码由服务端验证，错误密码不能解锁或发布。后台有持久化尝试次数限制。
- 多设备独立修改会自动进行字段级三方合并；同一字段冲突需要选择保留内容。后台版本检查防止覆盖并发更新。
- 「检查并合并云端更新」保留本机草稿，JSON 备份仍可导入和导出。
- **地图、旅行日期与笔记公开。** 管理密码保护的是发布能力。
- 清理浏览器存储会删除本机未发布草稿；已经发布的记录仍保存在后台。

## 开发与验证

Node.js 22 或更新版本，无需安装运行时依赖：

```sh
node scripts/serve.mjs
node --test
```

打开 `http://127.0.0.1:4173`。`PORT` 可设置端口。不要直接双击 HTML：地图数据与 ES 模块需要 HTTP 服务。

本地 HTTP 服务用于地图预览。管理登录与发布仅允许来自正式 GitHub Pages 地图网址的请求。原静态授权测试夹具保留用于旧模块回归，不用于生产发布。

自动测试覆盖原数据兼容、日期与备份验证、字段级合并、冲突选择、Unicode、授权状态、SHA 写入、公开授权读取与同源回退、加密往返、错误密码、篡改检测和 KDF 参数约束。

## 部署与文件

GitHub Pages：**Deploy from a branch → main → / (root)**。所有站内资源使用相对路径，支持 `/travel-atlas/` 子目录；无需构建命令。

| 文件                                         | 用途                                   |
| -------------------------------------------- | -------------------------------------- |
| `data/atlas.json`                            | 服务不可用时的初始记录快照 |
| `cloud.mjs`                                 | 密码登录及记录发布客户端 |
| `data/countries.json` / `data/world.geojson` | 国家与地区元数据、Natural Earth 边界   |
| `app.js`                                     | 界面与地图交互                         |
| `core.mjs`                                   | 数据验证、搜索、修改比较和三方合并     |
| `auth.mjs` / `github.mjs` / `device-auth.mjs` | 原静态授权实现，当前页面不再加载 |
| `style.css` / `map.css`                      | 响应式界面与地图主题                   |
| `assets/flags/`                              | 本地 SVG 国旗                          |
| `tests/`                                     | 不依赖外部服务的自动测试               |

保留原始旅行历史：初始足迹只有已确认的爱尔兰。签证分类保留原版部分官方来源预填；透明表示尚未分类，并非一定需要签证。旅行前请重新核对最新入境、中转、停留和返程条件。

## 第三方资料

- [D3.js 7.9.0](https://github.com/d3/d3)，ISC License；许可证在 `assets/D3-LICENSE.txt`。
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)，public domain；边界来自 `@d3-maps/atlas` 1.0.0。
- [mledoze/countries](https://github.com/mledoze/countries)，ODbL 1.0；修改说明在 `data/NOTICE.txt`。
- [flag-icons](https://github.com/lipis/flag-icons)，MIT License；许可证在 `assets/FLAGS-LICENSE.txt`。
