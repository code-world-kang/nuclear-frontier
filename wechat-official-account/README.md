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

后续可使用公众号的草稿箱/发布能力实现自动入库。密钥只应保存在 GitHub Actions Secrets，不得写入本仓库。是否能自动发布取决于账户类型、认证状态与当前接口权限。
