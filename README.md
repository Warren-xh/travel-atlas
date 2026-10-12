# 行迹 Atlas

一张属于自己的旅行地图。免费部署到 GitHub Pages，地图、国旗和脚本均从本仓库加载，没有付费地图接口、外部字体或服务器依赖。

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
- 发布后显示 GitHub 提交链接，并检查 Pages 是否已显示新记录。

## 本机 PIN 管理（支持四位数字）

首次打开「管理地图」，选择「本机 PIN」，粘贴仅授权此仓库、Contents 读写的细粒度 GitHub Token，再设置 4 至 8 位数字 PIN。配置完成后，在同一浏览器输入 PIN 就能编辑并发布。PIN 配置不会创建公开的 `admin.vault.json`。

授权密文和随机、不可导出的浏览器密钥保存在 IndexedDB。PIN 与该密钥通过 HMAC 派生加密密码，再使用 PBKDF2 和 AES-GCM 加密 Token。单独拿到密文和 PIN 不能在另一设备解密；这仍是可信设备上的便捷锁，不能抵御已控制浏览器或设备的攻击者。连续 5 次尝试后等待 1 分钟。

清理网站存储、换浏览器或换电脑时需要重新授权。Token 不包含在旅行记录备份里；它会在 2027 年 10 月 12 日到期，届时应在 GitHub 创建新的授权并在「管理设置」替换。管理 PIN 不可找回；可以用 GitHub Token 重新配置。

## 首次配置跨设备长密码

配置一次后，同一台或另一台设备只需输入管理密码，无需每次重新粘贴 Token。

1. 打开地图，点击「管理地图」。若尚未配置，将进入「设置你的地图钥匙」。管理方式选择「跨设备长密码」。
2. 在 [GitHub 细粒度 Token 页面](https://github.com/settings/personal-access-tokens/new) 创建授权：资源所有者选 Warren-xh；Repository access 选 **Only select repositories**，只选 **travel-atlas**。
3. Repository permissions 仅需 **Contents → Read and write**。设置适当的到期时间；不需要账户权限或其他仓库权限。
4. 将 `github_pat_` 开头的 Token 粘贴到配置表单。经典 Token 和 OAuth Token 不接受。
5. 设置长密码，建议使用页面生成的 **24 位随机密码**，保存到密码管理器，勾选「我已把管理密码保存到安全的位置」。
6. 点击「保存授权并解锁地图」。浏览器会先加密 Token，再把密文保存为 `data/admin.vault.json`。

GitHub 连接器的仓库写入权限不能自动转换成网页使用的个人 Token。仓库中没有内置密码或明文授权；首次配置仍需由拥有仓库权限的人提供细粒度 Token。

## 日常管理与发布

1. 点击「管理地图」，输入管理密码。
2. 点击国家或搜索国家，修改颜色、日期与笔记。草稿会自动保存到当前浏览器。
3. 需要时点击「主页设置」或「自定义图例颜色与名称」。
4. 点击「发布修改」，检查修改清单，再点击「确认发布到 GitHub」。
5. 如其他设备也有修改，网页先执行字段级三方合并。不同国家、不同字段的修改会同时保留；同一字段的不同修改必须由你选择。
6. 发布写入 `data/atlas.json` 的 `main` 分支，并使用当前文件 SHA 防止并发覆盖。等待 GitHub Pages 自动构建；提交成功和网页已更新会分别提示。

「检查并合并云端更新」保留本机草稿。「恢复近期草稿」可找回当前浏览器最近 8 份快照。导入的备份先进入草稿，不会立即覆盖 GitHub。

## 密码、授权与数据

- Token 使用 **PBKDF2-SHA256（600,000 次迭代）+ AES-256-GCM** 加密，随机 16 字节盐、12 字节 IV 和认证标签；密文绑定到本仓库。
- GitHub Pages 为公开静态托管。加密授权文件也公开，攻击者可尝试离线猜测密码，因此必须使用强随机密码，并将 Token 严格限制在此仓库。
- 管理密码与解密后的 Token 仅在解锁页面的内存中使用，不写入浏览器存储、JSON 备份或 URL。配置表单关闭后清空敏感输入。
- 页面闲置 15 分钟自动锁定；刷新或手动锁定后需重新输入密码。本机草稿仍保留。
- 修改密码或更新即将过期的 Token：解锁后点击「管理设置」。Token 留空时沿用当前授权，填写新 Token 时替换授权。
- Git 会保留历史版本。单独修改密码不会撤销旧 Token；若旧密码或 Token 已泄露，需在 GitHub 撤销旧 Token，并配置新的细粒度授权。
- 忘记密码无法从密文中恢复。使用新的细粒度 Token，通过「密码忘了或授权过期？重新配置」设置新密码。需要时在 GitHub 撤销旧 Token。
- **地图、日期与笔记会公开。** 密码保护的是发布授权，公开地图的内容仍可被访客读取。请勿把私人信息放入旅行笔记。
- 本机草稿与快照依赖浏览器存储。清理浏览器数据会删除它们，建议定期导出 JSON；导出的记录不含管理授权。

## 开发与验证

Node.js 22 或更新版本，无需安装运行时依赖：

```sh
node scripts/serve.mjs
node --test
```

打开 `http://127.0.0.1:4173`。`PORT` 可设置端口。不要直接双击 HTML：地图数据与 ES 模块需要 HTTP 服务。

隔离的浏览器验证模式：

```sh
node scripts/serve.mjs --test-api
```

该模式仅在本机服务时替换 GitHub 请求的传输层；加密与应用逻辑仍运行原代码。测试 API 在内存中保存模拟提交，**不会写入真实 GitHub，也不会修改数据文件**。测试用 Token 为 `github_pat_TestOnlyNoPermissions12345678901234567890`，不具备任何权限。此模式不得用于生产部署。

自动测试覆盖原数据兼容、日期与备份验证、字段级合并、冲突选择、Unicode、授权状态、SHA 写入、公开授权读取与同源回退、加密往返、错误密码、篡改检测和 KDF 参数约束。

## 部署与文件

GitHub Pages：**Deploy from a branch → main → / (root)**。所有站内资源使用相对路径，支持 `/travel-atlas/` 子目录；无需构建命令。

| 文件                                         | 用途                                   |
| -------------------------------------------- | -------------------------------------- |
| `data/atlas.json`                            | 图例、国家记录、官方来源及可选主页设置 |
| `data/admin.vault.json`                      | 首次配置后创建的加密管理授权           |
| `data/countries.json` / `data/world.geojson` | 国家与地区元数据、Natural Earth 边界   |
| `app.js`                                     | 界面与地图交互                         |
| `core.mjs`                                   | 数据验证、搜索、修改比较和三方合并     |
| `auth.mjs` / `github.mjs`                    | 密码加密与 GitHub 发布                 |
| `style.css` / `map.css`                      | 响应式界面与地图主题                   |
| `assets/flags/`                              | 本地 SVG 国旗                          |
| `tests/`                                     | 不依赖外部服务的自动测试               |

保留原始旅行历史：初始足迹只有已确认的爱尔兰。签证分类保留原版部分官方来源预填；透明表示尚未分类，并非一定需要签证。旅行前请重新核对最新入境、中转、停留和返程条件。

## 第三方资料

- [D3.js 7.9.0](https://github.com/d3/d3)，ISC License；许可证在 `assets/D3-LICENSE.txt`。
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)，public domain；边界来自 `@d3-maps/atlas` 1.0.0。
- [mledoze/countries](https://github.com/mledoze/countries)，ODbL 1.0；修改说明在 `data/NOTICE.txt`。
- [flag-icons](https://github.com/lipis/flag-icons)，MIT License；许可证在 `assets/FLAGS-LICENSE.txt`。
