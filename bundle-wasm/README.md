# Tylina for DeepSeek Harness

**Beautiful documents, right beside your agent.**

[Website](https://tylina.github.io/) · [Try the Web editor](https://tylina.github.io/app/) · [简体中文](https://github.com/tylina/dsh-tylina/blob/main/README.zh-CN.md)

![Tylina editing an academic presentation beside Harness](https://raw.githubusercontent.com/tylina/dsh-tylina/main/docs/media/harness-slides.png)

Create résumés, posters, academic slides, charts, papers, notes, and reports. Edit the typeset page directly, or open the source beside it.
The document and your Harness agent share the conversation's workspace, with Typst Skills, document tools, and MCP.

Typst compilation runs in WASM Workers in your browser.

```sh
dsh plugin --profile web add dsh-tylina
dsh web
```

Update:

```sh
dsh plugin --profile web update dsh-tylina@latest
```

Restart Harness after updating. Verify the installed version with
`dsh plugin --profile web list dsh-tylina --depth 0`.
If pnpm's release-age delay keeps an older version, use the exact command in the
[latest release](https://github.com/tylina/dsh-tylina/releases/latest).

Open **Tylina**, choose or create a conversation, and open its document project.
The editor uses Better Sidebar tabs when available, or its own resizable sidebar. You can also open a separate window.

Includes templates, fonts loaded on demand, Slides Mode, presenter view, and PDF export.
Requires Node.js 22.19+ and DeepSeek Harness 0.1.2-rc.1. Install one Tylina edition per profile.

Your Harness provider owns model credentials and conversations. No Tylina account, model proxy, source checkout, or Rust toolchain is required.

[Full guide and template gallery](https://github.com/tylina/dsh-tylina) · [Development and MCP setup](https://github.com/tylina/dsh-tylina/blob/main/docs/integration.md)

Tylina is proprietary software. Third-party components, fonts, and templates retain their own licenses.
