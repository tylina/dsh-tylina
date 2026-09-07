export const projectPickerCss = `
.tylina-dsh-project { margin:auto; padding:24px; width:384px; max-width:100%; max-height:100%;
  overflow:auto; box-sizing:border-box; font:13px/1.5 system-ui,sans-serif; scrollbar-width:thin; }
.tylina-dsh-project-heading { display:flex; align-items:flex-start; gap:12px; margin-bottom:26px; }
.tylina-dsh-project-heading img { flex:none; margin-top:1px; }
.tylina-dsh-project h2 { font-size:16px; line-height:1.4; font-weight:600; margin:0 0 5px; letter-spacing:-.2px; }
.tylina-dsh-project p { font-size:12px; line-height:1.6; margin:0; color:var(--dsw-alias-label-secondary,#747881); }
.tylina-dsh-field { display:flex; flex-direction:column; gap:7px; font-size:12px; font-weight:500; }
.tylina-dsh-project input, .tylina-dsh-project select { width:100%; height:36px; padding:7px 10px; font:13px/1.5 system-ui,sans-serif;
  color:inherit; border:1px solid var(--dsw-alias-border-l2,#dedfe3); background:var(--dsw-alias-bg-base,#fff);
  border-radius:7px; box-sizing:border-box; }
.tylina-dsh-project input::placeholder { color:var(--dsw-alias-label-tertiary,#969aa2); }
.tylina-dsh-select { position:relative; display:block; }
.tylina-dsh-select select { appearance:none; padding-right:32px; cursor:pointer; }
.tylina-dsh-select svg { position:absolute; right:11px; top:11px; pointer-events:none; opacity:.6; }
.tylina-dsh-directory { display:flex; align-items:center; gap:6px; margin-top:8px;
  color:var(--dsw-alias-label-secondary,#747881); font-size:11px; }
.tylina-dsh-directory svg { flex:none; }
.tylina-dsh-directory span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tylina-dsh-project button { display:inline-flex; align-items:center; justify-content:center; gap:8px;
  min-height:34px; padding:6px 12px; border:1px solid var(--dsw-alias-border-l2,#dedfe3); border-radius:7px;
  color:inherit; background:transparent; font:12px/1.5 system-ui,sans-serif; cursor:pointer; }
.tylina-dsh-project button:hover:not(:disabled) { background:var(--dsw-alias-bg-overlay,#f3f4f6); }
.tylina-dsh-project button.tylina-dsh-subfolder { justify-content:flex-start; max-width:100%; min-height:30px;
  padding:5px 0; margin:10px 0 8px; border:0; border-radius:3px; font-size:11px;
  color:var(--dsw-alias-label-secondary,#747881); }
.tylina-dsh-subfolder[aria-expanded=true] svg { transform:rotate(90deg); }
.tylina-dsh-project-actions { display:flex; gap:8px; margin-top:20px; }
.tylina-dsh-project button.tylina-dsh-primary { flex:1; justify-content:space-between; font-weight:500;
  color:var(--dsw-alias-bg-base,#fff); background:var(--dsw-alias-label-primary,#25272c); border-color:transparent; }
.tylina-dsh-project button.tylina-dsh-primary:hover:not(:disabled) { opacity:.86; }
.tylina-dsh-project-footer { margin-top:24px; padding-top:14px; border-top:1px solid var(--dsw-alias-border-l2,#e6e7e9); }
.tylina-dsh-project-footer a { display:inline-flex; align-items:center; gap:7px; text-decoration:none; font-size:11px;
  color:var(--dsw-alias-label-secondary,#747881); }
.tylina-dsh-project-footer a:hover { color:inherit; }
.tylina-dsh-empty-project { display:flex; flex-direction:column; gap:16px; }
`
