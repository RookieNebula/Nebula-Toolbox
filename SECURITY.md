# 前端安全审计（v9）

审计范围：本目录下的静态页面与其脚本（`index.html`、`查询.html`、`批量改密.html`、`自动分类.html`、`author.html`、`插件箱.html`、新增插件页、旧版工具页、`app-core.js`、`lib-io.js`、`lib-zip.js`）。
审计方式：静态阅读 + 依赖/外链扫描 + 数据流跟踪。**未做**登录协议逆向、未做漏洞利用、未扩大 `bob-query.html` 的数据采集能力。

> 说明：需求里提到的「还原登录接口 / 用漏洞做账号采集」不在交付范围内。对他人账号的批量抓取（实名、封禁、充值限制等属于个人信息）没有授权基础；本次只做防守侧的加固。

---

## 结论速览

| 级别 | 数量 | 说明 |
|---|---|---|
| 严重 | 1 | `bob-query.html` 前端硬编码 API 密钥与中转令牌 |
| 高 | 2 | `postMessage` 通配、第三方中转可信度 |
| 中 | 3 | 本地明文存储、无 CSP、`innerHTML` 拼接面 |
| 低 | 3 | 文件协议限制、依赖体积、错误信息 |

---

## 严重

### S-1 `bob-query.html` 把签名密钥与中转令牌写死在客户端

```
API_SECRET = 'KApx7cy9qx0s4mg0ELvNr9XOovFf9ngu'
DEFAULT_PROXY = 'https://…edgeone.cool/?eo_token=…&eo_time=…'
```

任何人打开开发者工具就能拿到密钥，自己构造签名、绕过你的中转直接打官方接口。**这是当前最大的泄露面**，且与「批量上限 50」这类前端限制无关——限制只挡普通用户。

处置建议（按顺序）：
1. **立即轮换** `API_SECRET` 与中转 `eo_token`，旧值视为已泄露。
2. 密钥只放服务端；客户端只发「球球号/昵称」，签名、鉴权、频控都在服务端完成。
3. 中转增加按用户的鉴权与配额（否则只是把密钥换了个地方公开）。
4. 如果没有服务端计划，就不要在客户端保留签名能力。

本次未改该文件逻辑（仅加了统一主题条）。

---

## 高

### H-1 `postMessage` 使用 `*`

`index.html` 的 `syncFrame()` 与子页 `nb-theme-set` 都用 `postMessage(..., '*')`。同源 iframe 场景下风险有限，但任意窗口都能向页面投递消息。

建议：改为 `location.origin`，并在接收端校验 `ev.origin === location.origin`。v9 新增的 `nb-theme-set` 已经只做主题赋值，影响面小，但仍建议校验。

### H-2 第三方中转是单点信任

`bob-query.html` 依赖 `edgeone.cool` 的个人中转：对方能看到全部查询词与返回内容，也能随时停服或篡改响应。

建议：自建中转并加鉴权；或直接下线该能力。

---

## 中

### M-1 本地明文存储

`diary_data`（日志正文）、`nb_last_import`（最近导入文件名）、`nb_sponsors`（赞助昵称与留言）都存在 `localStorage`，同源脚本可读；设备被 root / 备份导出即可拿到明文。

建议：敏感内容提示用户；需要更强保护时用「口令派生密钥 + WebCrypto 加密后再存」，并明确告知忘记口令不可恢复。

### M-2 没有 CSP

页面未设置 Content-Security-Policy。虽然 v9 已移除唯一的外部 CDN（JSZip），但一旦将来引入外链脚本，缺少 CSP 会让注入更容易生效。

建议在 `index.html` 等页面加：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'">
```

（当前代码有大量内联脚本，`unsafe-inline` 暂时省不掉；后续可改为外部文件 + nonce。）

### M-3 `innerHTML` 拼接面

`index.html`、`查询.html`、`bob-query.html`、`插件箱.html` 等用 `innerHTML` 渲染。现有实现基本都过了 `IO.escape` / `NB.esc`，但这是最容易回归的地方：新增字段时忘记转义就会变成存储型 XSS。

建议：统一走 `textContent` + DOM 构建，或至少把「所有插入 innerHTML 的用户数据必须 esc」写成代码评审清单。回归测试里已加入关键词注入用例。

---

## 低

### L-1 `file://` 打开的功能残缺

`file://` 下 `localStorage`、iframe 同源、剪贴板 API 行为因浏览器而异，可能导致主题不同步、导出失败。README 已注明用静态服务器。

### L-2 依赖

`vendor/confetti.min.js`（MIT，约 25KB）为本地文件，无外链；`lib-zip.js` 自写，无依赖。旧版 `tool-skin.css/js` 仍被部分页面引用，属于冗余而非风险。

### L-3 错误信息

`bob-query.html` 会把网络错误原文拼进 UI（含中转域名）。对普通用户无害，但会暴露基础设施。

---

## 已做的加固（v9）

- 移除 `自动分类.html` 的 cdnjs JSZip，改本地 `lib-zip.js`；
- 新增 `NB.sanitizeName`：导出文件名过滤 `\ / : * ? " < > |` 与控制字符；
- 新增 `NB.esc` 并在新页面统一使用；
- 赞助后端：admin token 常量时间比较、3 次/分/IP 限流、Body ≤8KB、CORS 白名单、IP 加盐哈希、默认不返回联系方式、静态目录禁止访问 `server/`；
- 所有文本输入统一 50,000 上限，避免超长输入拖垮页面。

## 复测清单

```bash
grep -rn "cdnjs\|unpkg\|jsdelivr" --include=*.html .   # 应为空
grep -rn "postMessage" --include=*.html --include=*.js .  # 检查是否仍为 '*'
grep -rn "API_SECRET" --include=*.html .               # 应为 0 处（轮换后删除）
node --test server/test/api.test.js
```
