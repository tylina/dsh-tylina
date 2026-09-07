export const css = `
body[data-tylina-docked] { width:calc(100% - var(--tylina-dock-width)); }
.tylina-dsh-open { display:flex; align-items:center; gap:8px; border:0; border-radius:8px; padding:8px 12px;
  color:var(--dsw-alias-label-primary); background:transparent; cursor:pointer; font:inherit; }
.tylina-dsh-open:hover { background:var(--dsw-alias-bg-overlay); }
.tylina-dsh-panel { position:fixed; inset:0 0 0 auto; height:100dvh; display:flex; flex-direction:column;
  box-sizing:border-box; border-left:1px solid var(--dsw-alias-border-l2,#ddd); z-index:30;
  color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-bg-base,#fff); }
.tylina-dsh-panel[hidden], .tylina-dsh-editor[hidden] { display:none; }
.tylina-dsh-bar { height:34px; flex:none; display:flex; align-items:center; gap:3px; padding:0 7px 0 12px;
  border-bottom:1px solid var(--dsw-alias-border-l2,#ddd); font:inherit; font-size:12px; }
.tylina-dsh-bar strong { font-size:12px; font-weight:600; margin-right:7px; }
.tylina-dsh-session { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.6; }
.tylina-dsh-bar button, .tylina-dsh-error button { display:grid; place-items:center; flex:none; width:26px; height:26px;
  padding:0; border:0; border-radius:4px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
.tylina-dsh-bar button:hover, .tylina-dsh-error button:hover { background:var(--dsw-alias-bg-overlay,#f0f1f3); }
.tylina-dsh-panel button:disabled { opacity:.4; cursor:default; }
.tylina-dsh-panel :focus-visible { outline:2px solid #5c83ba; outline-offset:1px; }
.tylina-dsh-editor { flex:1; min-height:0; min-width:0; }
.tylina-dsh-resize { position:absolute; left:-4px; top:0; bottom:0; width:8px; cursor:col-resize; touch-action:none; z-index:2; }
.tylina-dsh-resize:hover, .tylina-dsh-resize:focus-visible { background:#5c83ba55; }
.tylina-dsh-drag-shield { position:fixed; inset:0; z-index:1; cursor:col-resize; }
.tylina-dsh-project { margin:auto; padding:24px; width:400px; max-width:100%; max-height:100%; overflow:auto; box-sizing:border-box; }
.tylina-dsh-project h2 { font-size:17px; font-weight:600; margin:18px 0 8px; }
.tylina-dsh-project p { font-size:13px; line-height:1.7; opacity:.65; }
.tylina-dsh-project label { display:flex; flex-direction:column; gap:6px; margin-top:16px; font-size:12px; }
.tylina-dsh-project input, .tylina-dsh-project select { width:100%; padding:7px 9px; font:inherit;
  color:inherit; border:1px solid var(--dsw-alias-border-l2,#ddd); background:transparent; border-radius:5px; box-sizing:border-box; }
.tylina-dsh-project button { border:1px solid var(--dsw-alias-border-l2,#ddd); border-radius:5px; padding:7px 12px;
  color:inherit; background:var(--dsw-alias-bg-overlay,#f4f5f7); font:inherit; cursor:pointer; }
.tylina-dsh-project-actions { display:flex; gap:8px; justify-content:flex-end; margin:20px 0; }
.tylina-dsh-project a { color:inherit; font-size:12px; opacity:.65; }
.tylina-dsh-directory { font-size:11px; opacity:.6; overflow-wrap:anywhere; margin-top:6px; }
.tylina-dsh-error { display:flex; align-items:center; gap:8px; padding:6px 10px; font-size:12px; line-height:1.5;
  background:var(--dsw-alias-bg-overlay,#f4f5f7); border-bottom:1px solid var(--dsw-alias-border-l2,#ddd); }
.tylina-dsh-error span { flex:1; }
.tylina-dsh-mcp { width:360px; max-width:calc(100vw - 48px); padding:18px; border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2,#ddd); color:var(--dsw-alias-label-primary,#202124);
  background:var(--dsw-alias-bg-base,#fff); box-shadow:0 12px 40px #0002; font:13px/1.6 system-ui,sans-serif; }
.tylina-dsh-mcp::backdrop { background:#0003; }
.tylina-dsh-mcp-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.tylina-dsh-mcp-heading strong { font-size:14px; }
.tylina-dsh-mcp p { margin:12px 0; }
.tylina-dsh-mcp button.tylina-dsh-mcp-copy { width:auto; height:auto; margin:16px 0 0 auto; display:flex; gap:8px;
  padding:6px 12px; border:1px solid var(--dsw-alias-border-l2,#ddd); font:inherit; }
@media(max-width:899px) { body[data-tylina-docked] { width:100%; } .tylina-dsh-panel { border:0; } }
@media(prefers-reduced-motion:no-preference) {
  .tylina-dsh-bar button[aria-busy=true] svg { animation:tylina-dsh-reconnect 1.2s linear infinite; }
}
@keyframes tylina-dsh-reconnect { to { transform:rotate(360deg); } }
`
