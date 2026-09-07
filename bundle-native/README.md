# Tylina for DeepSeek Harness (native)

This 0.4.0 package supports macOS Apple Silicon (darwin-arm64). Typst and Tinymist run as bundled native processes on the Harness host. For other platforms, use `@tylina/dsh-wasm`.

Requires Node.js 22.19+ and DeepSeek Harness 0.1.2-rc.1.

```sh
dsh plugin --profile web add @tylina/dsh-native@0.4.0
dsh --profile web
```

Install one Tylina variant at a time. Open **Tylina** in the right sidebar and select a document
in the current conversation's workspace. The editor and Agent share the same files.
The bundle includes the complete editor, templates, fonts loaded on demand, Typst Skills,
Agent document tools and MCP integration. No source checkout or Rust toolchain is needed to use it.
A separate-window button is available in the editor.

The Harness host uses its normal authentication and project permissions. The host Agent owns
model credentials and conversation settings; this package contains no API keys.

[Source and detailed instructions](https://github.com/tylina/dsh-tylina)
