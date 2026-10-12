# 行迹 Atlas

个人旅行地图，使用 GitHub Pages 免费托管，没有付费地图接口和服务器依赖。

- 地图：https://warren-xh.github.io/travel-atlas/
- 管理：https://warren-xh.github.io/travel-atlas/#admin
- 大洲切换、国家搜索、地图缩放、五种自定义颜色、透明底色与清晰边界。
- 蓝色：普通中国护照免签且未去过；绿色：去过；黄色：电子签；橙色与紫色：自定义。
- 旅行日期、备注、浏览器本地保存、JSON 备份导入与导出。
- 网页管理面板可以通过 GitHub Contents API 发布 data/atlas.json。

## 管理与发布

1. 点击“管理地图”，选择国家，改颜色、日期和备注，点击“保存到本机”。
2. 如需所有设备看到相同记录，点击“发布到 GitHub”。
3. 第一次在 GitHub 创建细粒度 Personal Access Token：仅选择 travel-atlas 仓库；Repository permissions 的 Contents 设为 Read and write；设置合理的到期时间。
4. 将 Token 输入网站的发布面板，再点击“发布当前记录”。Token 只保留在当前页面内存中，不写入 localStorage、备份、仓库或 URL。刷新后需要再次输入。不要把 Token 发给别人。
5. 发布只修改数据文件，Pages 会自动构建。地图与发布记录公开；私人信息不要发布到公开仓库。
6. 多设备修改时如提示 GitHub 已有更新，先导出本机备份，再拉取最新记录后编辑，防止覆盖。

地图管理入口可以公开访问。访客只会修改自己的本机记录；发布到此仓库必须具有仓库写入授权，管理页不是服务器端登录后台。

## 本地预览

在此目录运行 Python 3 的 python3 -m http.server 8080，再打开 http://localhost:8080。需要 HTTP 服务加载 JSON，直接双击 HTML 不适用。

## 部署

仓库 Settings → Pages → Deploy from a branch → main / (root)。所有资源使用相对路径，适用于 GitHub Pages 项目子目录。

## 数据与修改

- data/atlas.json：颜色名称、颜色值、国家状态、日期、笔记与预填政策来源。
- data/countries.json：国家和地区的中文名、英文名、大洲、位置。
- data/world.geojson：Natural Earth 1:50m 边界；微型国家通过位置圆点补充。
- app.js / style.css / index.html：行为、样式与页面。

第一版只预填部分已核实的免签/电子签国家，透明表示未分类。出行前按官方来源核对停留期限、入境、过境和返程条件。初始“已去过”仅使用已确认的爱尔兰，不假设其他旅行历史。

## 第三方资料

- D3.js 7.9.0，ISC License：https://github.com/d3/d3/blob/main/LICENSE
- Natural Earth 边界，public domain：https://www.naturalearthdata.com/about/terms-of-use/
- @d3-maps/atlas 1.0.0：https://www.npmjs.com/package/@d3-maps/atlas
- mledoze/countries，ODbL-1.0：https://github.com/mledoze/countries
- 签证预填来源链接及核实日期保存在每条记录中。数据不是完整全球签证数据库。
