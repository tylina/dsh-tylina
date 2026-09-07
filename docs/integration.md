# Integration and development reference

Two self-contained profile bundles mount the same Web editor in the Harness sidebar:

- `dsh-tylina`: compilation and Tinymist language services run in the browser's Workers.
- `dsh-tylina-native`: the Node host runs the packaged Tinymist executables through an authenticated WebSocket.
  npm selects a separately packaged runtime for the user's operating system and CPU architecture.

Both reuse the complete built Web application, templates, fonts and renderer from shared npm resource dependencies.
Both also register every bundled Typst domain in Harness's Skills catalog using its released filesystem provider.
The complete Desktop Skills tree, including references, scripts and template resources, is provided by the shared resource package.
Bodies are loaded on demand; the Tylina provider adds no project/user roots or filesystem watchers.
The editor's source, resources, history, menus and persistence use the existing shared implementations.
The default right panel sits beside the conversation and can be resized with the pointer or keyboard.
Hiding the panel preserves its editing session, Undo and Agent tools. Narrow windows show one surface at a time.

Open Tylina to enter the current conversation’s working directory automatically.
The folder button is an optional way to select a project subfolder; there is no initial project picker for an active conversation.
The file list opens first when no main file has been selected; double-click the document to use as main.
Source edits save to the actual Harness project in both variants. External script and filesystem edits appear
through the editor's normal conflict handling and Undo. The project remains bound to the selected conversation
while editing. By default the dock follows conversation changes after saving the current document.
Pin the workspace to keep it open while browsing other conversations; unpin to resume following immediately.
Save failures retain the current editor and show the problem. Obsolete opening requests are cancelled.
File access reads the actual session working directory without creating, resuming or adopting an Agent,
including sessions owned by subagent routing. Tools bind separately to the owning Agent.
“Focus this conversation” keeps the document running while showing its chat.
“Open in separate window” saves before handing the project and exclusive tools to a standalone window.
A blocked popup or failed save keeps the current editor. “Return to sidebar” saves and hands the project back.
Window handoff recreates the editor and compiler: saved files, resources and main/active file selection survive,
but its in-memory Undo stack does not cross windows. A detached window stays bound to its original conversation.
The separate “Browser drafts” entry opens the standalone editor with browser storage.

## Build and install

This repository builds with Node.js 22.19+ (or Node.js 24), pnpm 11.9 and Git.
It installs only published npm artifacts: `tylina-sdk`, `tylina-web-assets` and an optional
platform-specific native runtime. No Tylina core checkout, repository credential, Rust compiler
or wasm-pack is needed, including in CI and fork pull requests.

```sh
git clone https://github.com/tylina/dsh-tylina.git
cd dsh-tylina
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:wasm
```

The SDK contains compiled adapters and public API declarations. Web resources contain the compiled
application, WASM, fonts, templates and Skills. Native runtime packages contain executable binaries.
Core TypeScript/Rust sources and source maps are excluded from those packages.
Update the exact npm dependency versions and lockfile to upgrade Tylina.
The native entry resolves a separate runtime for Linux, macOS and Windows on x64 or arm64.
Each runtime is built and smoke-tested on its matching platform before distribution.

`pnpm build:wasm` builds only the browser bundle; `pnpm build:native` builds the native variant.
`release/` contains both `.tgz` bundles and a manifest with byte counts and SHA-256.
Each native runtime manifest restricts installation to its actual OS and architecture.

Install **one** variant into an existing Web profile:

```sh
dsh plugin --profile web add /absolute/path/dsh-tylina-0.4.5.tgz
dsh --profile web
```

For native compilation, install `dsh-tylina-native-0.4.4.tgz` instead.
Remove the previous variant with `dsh plugin --profile web remove dsh-tylina` before switching.
The bundles use the same `tylina` configuration row and must not be stacked together.
Custom profiles must contain `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` before the Tylina bundle.

There are no install scripts, source-checkout requirements or compiler binary downloads.
The platform runtime tarballs preserve executable permissions through pnpm's `publishConfig.executableFiles`.
The integration currently targets the released Harness `0.1.2-rc.1` plugin contracts.

## Ownership

`plugin/src` owns the shared Cordis registration, dock, window handoff, static serving and socket adapter.
Each distribution bundles that implementation under its own client factory identity.
The compiled `tylina-sdk/node` API owns native LSP, compiler processes, filesystem snapshots and conditional
publication. `tylina-sdk/client` supplies the socket carrier; the shared Web resources adapt it into the same
editor capabilities as local Workers. These implementations are supplied by npm, not duplicated in this repository.

Harness project access uses the selected Agent's filesystem provider and requires an explicit host-directory
mapping. No provider target keys are parsed as native paths. Snapshots preserve text encodings and binary bytes;
directory enumeration skips symlinks and special files. VCS metadata and dependency directories are excluded.
Both modes read requested bytes through Harness `fs.readBytes`; only the root and opened directories are indexed.
Opening a project does not import unrelated binary files; Typst requests computed dependencies as needed.
The browser working set is bounded to 4096 loaded files, 64 MiB per file and 128 MiB total.
The metadata index is bounded to 16,384 entries across 512 visited directories, with at most 4096 children per directory.
Saving uses explicit file/folder removal intents; missing entries in a partial index never authorize deletion.
Explicit folder moves and downloads load their requested scope first and fail clearly if it exceeds the working set.
View leases share one write queue per host directory. Closing the last view releases retained bytes and metadata
after admitted operations finish. Hiding a view or reconnecting its tools preserves the lease. An idle timeout
cleans up unreachable views; active saves cannot expire. Native mode needs the matching on-demand runtime release.
For another host, implement the public [SDK workspace filesystem](https://www.npmjs.com/package/tylina-sdk):
`stat`, `readDirectory`, `readFile`, opaque versions and cancellation. Host persistence is a separate versioned callback.
Saving checks the previous content revision, publishes each file atomically and attempts guarded rollback if a
later write fails. This is not a filesystem-wide transaction. An uncertain or conflicting write remains an error
until the current disk contents are inspected and reconciled; it is never silently replayed.
The native compiler receives the materialized memory working set and requests missing paths through the same
host reader as WASM. It cannot opt into disk-backed workspace compilation.
Every editor connection owns independent preview, command and language-service sessions.
Disposing the editor destroys its native sessions. A tool socket disconnect rejects pending calls while preserving
the document; “Reconnect Agent tools” explicitly restores tool registration without replaying previous calls.

The bound Agent receives the shared 18-tool catalog, including current unsaved file reads, version-checked writes,
Typst validation, semantic document queries, templates, Skills and actual rendered image attachments.
The ordinary Harness Agent owns model configuration, keys and chat. Opening a document queues the shared authoring
instructions but does not start inference. Tool registration is session scoped and exclusively owned by one editor.
Both bundles expose the complete Desktop Skill scripts in the Harness filesystem. `tylina_tool_runtime` supplies
the actual project and Skill roots and an isolated uv environment. It prefers installed system uv; when absent,
an explicit tool request starts managed background installation using the shared Desktop installer.

App routes and socket upgrades reuse Harness Connection authentication and Host/Origin checks.
The plugin adds no unauthenticated process endpoint, arbitrary network proxy or application launcher.
Use the normal Harness authenticated URL to log in before opening `/tylina/` directly.

## MCP clients

The plug icon in the document header opens **Connect an MCP client**. Copy the configuration into a
Streamable HTTP MCP client to use the same 18 live document tools and authoring instructions.
Harness already receives these tools directly; this connection is for another client and does not duplicate
the Harness Agent's tool catalog. Tools read the live editor, retain version-checked file writes and Undo,
and use the same compiler, templates and packaged Skills as the ordinary Harness tools.

The exported configuration uses the common `mcpServers` wrapper, with an HTTP `url` and an `Authorization`
header. Adapt the outer configuration key if your client uses another format (for example VS Code's `servers`).
The key grants access to this document project only. Keep the editor open; hiding its sidebar is fine.
Closing, reconnecting, changing projects or moving the document between windows revokes that configuration.
Copy a new one after reconnecting. An old client never silently follows a different project.

The key is generated in memory for each editor connection and sent to its authenticated browser only.
It is not the Harness login credential and never enters workspace files, preferences or share URLs.
Machine clients still pass the Harness Host/Origin fence. MCP 2025 protocol sessions retain cancellation
correlation; modern clients use the SDK's per-request transport. Closing an editor cancels both.
Requests and concurrent clients have bounded size and count; uncertain mutations are never replayed by Tylina.

## Acceptance

After packaging, with the supported `dsh` executable available:

```sh
pnpm test:installed
```

This installs the tarballs into isolated profiles, launches the real Harness, and opens Chromium.
It verifies authentication, actual project and Agent instances, compilation and formatting, CRLF preservation,
Source input, disk saves, external edits and exact Undo/Redo, hidden-editor image attachments, real system uv,
pending instructions, reload and native process cleanup. A deterministic streaming model adapter then drives
the actual Agent loop through reading, editing, validation, PDF export to the project and image rendering.
The next model request must receive each real tool result. The suite replaces the actual Session message surface
as compaction does and repeats the turn, verifying that authoring instructions remain present exactly once.
The model fixture and authenticated test probe are not distributed. No model API key or live provider inference
is involved; the test controls model output and the summary text, while Harness owns its actual loop and history.
It also exercises the dock beside an editable chat, pointer/keyboard resizing, narrow-screen focus isolation,
blocked popups, rejected project saves with unsaved text retained, separate-window edits and return to the dock.
Switching between two real conversations transfers tools and restores each project's main file without changing
the other project's bytes. A completed-history fixture makes those conversations visible in Harness navigation.
Screenshots and isolated profile logs live under `.benchmarks`. Set `TYLINA_DSH_OFFLINE=1` only when all exact
dependencies are already in the local pnpm store; ordinary acceptance allows dependency downloads.
The installed suite also copies the actual MCP configuration and uses the official SDK to verify scoped
workspace reads, writes, compilation, images, Skills, templates and revocation. The transport suite is
`node --test tests/dsh-mcp.mjs`; it checks both protocol eras, authentication,
schema rejection and cancellation. Bundles include notices for the server dependencies actually embedded.
`node --test tests/dsh-skills.mjs` also checks discovery, exact bodies and disposal
against the real released Cordis and Skill registry.
`node --test tests/dsh-tools.mjs tests/dsh-editor-connection.mjs`
checks the shared 18-tool catalog against the released Harness registry and the authenticated editor
connection over real sockets, including session isolation, cancellation and teardown. These boundary
tests do not invoke a model or prove the installed Agent loop.

`node --test tests/dsh-workspaces.mjs` checks provider mapping and authenticated HTTP project access
against the released Harness filesystem. The installed acceptance suite checks actual disk publication
and external edits through the compiled SDK.

The remaining integration work is tracked in the issue tracker: additional project and session recovery
cases, live-provider acceptance when configured and the broader product acceptance matrix.

## npm distribution

The public package names are `dsh-tylina` and `dsh-tylina-native`; `plugin/` is private
implementation shared by the two bundles. Both publish only compiled output and bundled resources,
with repository metadata, a public access setting and no runtime workspace dependencies.
The source workspace shares one candidate version. Run `pnpm release:version <version>` to update
all four manifests together. Build and packaging reject mismatched candidate versions. Publication
can be staged: 0.4.5 ships the WASM bundle first; the native bundle remains unpublished until its
matching cross-platform runtimes are ready. The published native version is still 0.4.4. Update
the native runtime dependencies before publishing that candidate. SDK, assets and platform binaries
keep independent versions, and release notes must identify which bundles are actually available.

`pnpm pack:bundles` and `pnpm verify:packages` are the release gate before publishing a tarball.
No npm publication happens during build or CI.

`dsh-tylina-native` is a universal plugin entry. Its optional dependencies select an independent
`tylina-native-<platform>-<arch>` package, each restricted by npm `os`/`cpu` metadata. Linux packages require glibc (Ubuntu 22.04 or newer baseline). The plugin
checks the installed runtime identity before launching executables and reports missing dependencies
or unsupported platforms explicitly. It never launches another platform's binary or downloads executables
from a mutable URL. Windows runtime packages use `.exe` names; POSIX executables retain execute permission.

Licensing is inherited from Tylina (`UNLICENSED`); third-party notices are included separately.
Publishing preserves that existing license; it does not change the core source visibility.

## Native runtime distribution

The native bundle installs the matching runtime as an optional npm dependency. Windows x64 uses
`npm:@orangex4/tylina-native-win32-x64@0.4.1` under the usual `tylina-native-win32-x64` dependency name.
All six platforms use npm registry packages and retain pnpm's default subdependency checks.
Optional dependencies must remain enabled; no source checkout or Rust toolchain is required.

WASM and native bundles can release patches independently; the shared Web assets have their own pinned version.
Local release checks build, pack, and verify both bundles, rejecting URL and local dependencies before publication.
The Check workflow is manual only; ordinary pushes and documentation edits do not consume CI runners.
