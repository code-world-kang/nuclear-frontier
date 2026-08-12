# 微信公众号发布稿

这里是“小康康的物理世界”的公众号发布输出。公众号采用**固定入口模式**：底部菜单直接打开每日自动更新的 GitHub Pages 网站，不需要每天发布公众号文章。

## 固定菜单

- `menu.json`：公众号三组菜单的完整链接配置。
- 统一入口：<https://code-world-kang.github.io/nuclear-frontier/wechat-entry/>
- 公众号后台也可参照 `menu.json` 手动建立同名菜单，无需使用 API 或在公开仓库保存密钥。

## 可选科研简报

公众号图文简报只作为周报、月报或特别推送的可选稿件，不会自动提交或发布到公众号。每次网站数据更新时会重新生成：

- `index.html`：使用内联样式的公众号图文稿，可在浏览器打开后复制正文。
- `latest.md`：纯文本/Markdown 备份。
- `metadata.json`：日期、篇数和入选内容 ID，供后续自动发布使用。

公众号作为“每日推送入口”，GitHub Pages 网站继续承担完整论文库、历史搜索、收藏、笔记、翻译和 Cite。小程序源码保留，但不再作为当前的首发渠道。

## 本地生成

```bash
python3 scripts/build_wechat_digest.py
```

在线预览地址：

<https://code-world-kang.github.io/nuclear-frontier/wechat-digest/>

## 与公众号账户连接

已接入公众号草稿箱和发布 API。当账户具备“素材管理、草稿箱、发布能力”权限时，每日 GitHub Actions 可自动：

1. 使用已生成的中文简报；
2. 复用或上传绿色封面；
3. 查找当日同名草稿/已发布记录，防止重复发布；
4. 写入草稿箱并提交发布。

仓库不保存任何公众号凭据。需在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中配置：

- Secret `WECHAT_OFFICIAL_APP_ID`：公众号 AppID。
- Secret `WECHAT_OFFICIAL_APP_SECRET`：公众号 AppSecret。
- Secret `WECHAT_OFFICIAL_PUBLISH_ENABLED`：确认权限与首篇测试后设为 `true`。
- Variable `WECHAT_OFFICIAL_AUTHOR`：可选，默认“小康康”。

正式启用前，应先在公众号后台核对接口权限和 IP 白名单要求。`AppSecret` 只能放在 GitHub Actions Secrets 中，不得写入公开仓库。
