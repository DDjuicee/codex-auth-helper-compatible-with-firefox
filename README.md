# codex-auth-helper(compatible with Firefox)

仓库地址：https://github.com/DDjuicee/codex-auth-helper-compatible-with-firefox

GitHub 仓库名不能包含空格和括号，所以上面的地址用了连字符。页面上的名字按这个标题显示。

这个仓库不是原扩展的作者维护的。原扩展由 [zhishile](https://github.com/zhishile) 编写，我从这里下载：

https://github.com/zhishile/codex-auth-helper

原项目说明采用 MIT 许可，并要求二次分发时保留原作者署名。这里只发布一份为了能在 Firefox 上使用而做的修改。浏览器里的扩展名称仍是「Codex认证助手」。

## 这次改了什么

原扩展按 Chrome 编写。这份修改让它在 Chrome 和 Firefox 121 及以上版本都能加载。

Firefox 上有两处和 Chrome 不一样，所以做了对应调整：

- 后台直接请求 ChatGPT 时，Firefox 不会带上登录 Cookie。已登录时，扩展改为在 `chatgpt.com` 页面里读取会话。如果当时没有打开这个网站，但浏览器里还有登录 Cookie，会短暂打开一个后台标签，读完就关掉。
- Firefox 不能用 `data:` 地址下载文件，所以导出 `auth.json` 时改用本地文件下载。

数据仍只在本机处理，用来生成 `auth.json`。不要把这个文件发给别人或提交到仓库。

## 安装

先下载或克隆本仓库。要加载的是包含 `manifest.json` 的这一层目录。

### Chrome

1. 打开 `chrome://extensions/`。
2. 打开「开发者模式」。
3. 选择「加载已解压的扩展程序」，选中本仓库目录。
4. 在工具栏固定「Codex认证助手」。

### Firefox

需要 Firefox 121 或更新版本。

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击「临时载入附加组件」。
3. 选中本仓库里的 `manifest.json`。
4. 在工具栏固定「Codex认证助手」。

临时载入会在 Firefox 关闭后消失。要一直保留，需要经过签名，或在 Firefox Developer Edition 中关闭附加组件签名检查。

## 使用

1. 在同一个浏览器里登录 [ChatGPT](https://chatgpt.com/)。
2. 点击工具栏里的「Codex认证助手」。
3. 已登录时，点击「导出身份信息」，浏览器会下载 `auth.json`。未登录时，点「一键跳转 ChatGPT 登录」，登录后再打开扩展。
4. 把下载的 `auth.json` 放到 Codex 配置目录。目录里已经有同名文件时，用这份覆盖。
   - Windows：`%USERPROFILE%\.codex\auth.json`
   - macOS：`~/.codex/auth.json`
5. 重新启动 Codex，让它读取这份配置。
