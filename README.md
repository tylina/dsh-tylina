<p align="center"><img src="docs/media/tylina.svg" width="72" alt="Tylina"></p>
<h1 align="center">Tylina for DeepSeek Harness</h1>
<p align="center"><strong>Beautiful documents, right beside your agent.</strong></p>
<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://tylina.github.io/">Website</a> · <a href="https://tylina.github.io/app/">Try the Web editor</a> · <a href="#install--update">Install</a></p>

Edit typeset Typst documents inside DeepSeek Harness. Share a workspace with your agent, from first draft to finished PDF.

![An academic presentation open beside the DeepSeek Harness conversation](docs/media/harness-slides.png)

- **Edit the finished page.** Click and write on the typeset document; use Split or Source Lens for precise source control.
- **Create with your agent.** Share the conversation's workspace, document tools, Typst Skills, and MCP. Harness owns the model and chat.
- **Go from template to delivery.** Templates, fonts, Slides Mode, presenter view, and PDF export are part of the same editor.

## Install & update

Already using DeepSeek Harness? Install the browser WASM edition:

```sh
dsh plugin --profile web add dsh-tylina@0.4.7
dsh web
```

Update:

```sh
dsh plugin --profile web update dsh-tylina@latest
```

For a newly published release, use `dsh plugin --profile web update dsh-tylina@0.4.7`.
[pnpm 11](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md) may defer `latest` updates for one day.


Click **Tylina** to open the current conversation’s workspace automatically. Double-click a `.typ` file,
or ask your agent to set the main document. Switch conversations and the editor follows; pin it to stay in one workspace.
WASM lists folders as you expand them and reads only requested files, including Typst dependencies. The header also offers a separate window.
With Better Sidebar installed, Tylina joins its tabs; otherwise it provides its own resizable sidebar.

<details>
<summary><strong>Native edition, requirements, and switching</strong></summary>

The browser edition is **0.4.7**; the published native edition remains **0.4.4** while its matching platform update is being validated. Choose browser WASM or native compilation on the Harness host.

| Package | Compilation runs in | Choose it for |
| --- | --- | --- |
| `dsh-tylina` | WASM Workers in your browser | A portable setup without native Typst executables |
| `dsh-tylina-native` | Native processes on the Harness host | Native compilation performance |

Both share the editor, workspace, templates, and tools. Native packages target macOS, Windows, and Linux on x64/arm64; Linux requires glibc.
Install one edition per profile. To switch to native:

```sh
dsh plugin --profile web remove dsh-tylina
dsh plugin --profile web add dsh-tylina-native
```

Native updates: `dsh plugin --profile web update dsh-tylina-native@latest`.
Verified with Harness `0.1.2-rc.1`, Node.js 22.19+ or 24, and pnpm 11.9.
Restart a running Harness after installation or updates.

</details>

## What will you make?

Start with a template, then shape it through conversation and direct editing. These are real compiled template examples.

<table>
<tr><td align="center" width="50%"><strong>Résumé</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/cv-basic-resume.png" height="210" alt="Résumé"></a></td><td align="center" width="50%"><strong>Poster</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/poster-pollux.png" height="210" alt="Poster"></a></td></tr>
<tr><td align="center" width="50%"><strong>Academic slides</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/slides-botanical-7.png" height="210" alt="Academic slides"></a></td><td align="center" width="50%"><strong>Charts</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/chart-area.png" height="210" alt="Charts"></a></td></tr>
<tr><td align="center" width="50%"><strong>Paper</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/paper-accelerated-jacow.png" height="210" alt="Paper"></a></td><td align="center" width="50%"><strong>Notes</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/note-bananote.png" height="210" alt="Notes"></a></td></tr>
<tr><td align="center" width="50%"><strong>Report</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/report.png" height="210" alt="Report"></a></td><td align="center" width="50%"><strong>Book</strong><br><a href="https://tylina.github.io/#scenes"><img src="docs/media/book-min-book.png" height="210" alt="Book"></a></td></tr>
</table>

[Explore Tylina](https://tylina.github.io/) · [Watch the editing demo](https://tylina.github.io/demo/) · [Template and screenshot credits](docs/media/ATTRIBUTIONS.md)

## Try asking your agent

> Turn the paper in this workspace into a 10-slide research talk. Keep the citations, add speaker notes, review the layout, and export a PDF.

> Turn my experience into a one-page résumé with a clear hierarchy and an emphasis on project outcomes.

Documents remain standard `.typ` source and resources that you can edit locally. Model requests use your configured
Harness provider. Tylina requires no account and adds no model proxy server.

[Embed elsewhere with the SDK](https://www.npmjs.com/package/tylina-sdk) · [Development & builds](docs/integration.md#build-and-install) · [Connect MCP clients](docs/integration.md#mcp-clients) · [Report an issue](https://github.com/tylina/dsh-tylina/issues)

<sub>Tylina is proprietary software. This repository provides the Harness integration; the core is distributed as compiled npm dependencies. Third-party templates and fonts retain their own licenses.</sub>
