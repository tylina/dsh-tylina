#set page(width: 1080pt, height: 1350pt, margin: 0pt, fill: rgb("#f7f6f1"))
#set text(font: ("Noto Sans SC", "PingFang SC", "Arial"), fill: rgb("#171817"))
#set par(leading: 1.04em)

#let ink = rgb("#171817")
#let paper = rgb("#f7f6f1")
#let muted = rgb("#5b5d58")
#let red = rgb("#e33b43")
#let white = rgb("#ffffff")

#place(top + left, rect(width: 1080pt, height: 1350pt, fill: paper))
#place(top + left, dx: 744pt, rect(width: 336pt, height: 1350pt, fill: ink))
#place(top + left, dx: 744pt, rect(width: 7pt, height: 1350pt, fill: red))

#place(top + left, pad(left: 66pt, top: 62pt)[
  #text(font: ("IBM Plex Mono", "Arial"), size: 13pt, weight: 700, tracking: 2pt,
    fill: muted, [Tylina / DSH])
])

#place(top + left, pad(left: 66pt, top: 184pt, right: 370pt)[
  #text(font: ("IBM Plex Mono", "Noto Sans SC"), size: 17pt, weight: 700,
    tracking: 3pt, fill: red)[原生 Typst · 所见即所得]
  #v(32pt)
  #text(font: ("Noto Sans SC", "PingFang SC"), size: 79pt, weight: 700,
    fill: ink)[原来 DSH#linebreak()也能写论文、#linebreak()简历和 PPT]
  #v(32pt)
  #rect(width: 96pt, height: 8pt, fill: red)
  #v(28pt)
  #text(font: ("Noto Serif SC", "Songti SC"), size: 26pt, fill: muted)[
    一个插件，把写作、排版和交付放进同一个工作区。
  ]
])

#place(top + left, pad(left: 66pt, top: 726pt, right: 370pt)[
  #line(length: 100%, stroke: 1.2pt + ink)
  #v(18pt)
  #grid(columns: (1fr, 1fr), column-gutter: 24pt,
    stack(
      spacing: 5pt,
      text(font: ("IBM Plex Mono", "Arial"), size: 14pt, weight: 700, tracking: 1.5pt,
        fill: red, [01 论文 · 报告 · 简历]),
      text(font: ("Noto Serif SC", "Songti SC"), size: 17pt, fill: muted,
        [从源码到排版成稿]),
    ),
    stack(
      spacing: 5pt,
      text(font: ("IBM Plex Mono", "Arial"), size: 14pt, weight: 700, tracking: 1.5pt,
        fill: red, [02 图表 · 海报 · PPTX]),
      text(font: ("Noto Serif SC", "Songti SC"), size: 17pt, fill: muted,
        [把 Slides 也放进工作区]),
    ),
  )
])

#place(top + left, pad(left: 66pt, top: 906pt, right: 370pt)[
  #grid(columns: (1fr, 1fr), column-gutter: 18pt,
    box(fill: white, stroke: 0.8pt + rgb("#deded7"), inset: 8pt,
      image("paper.png", width: 292pt, height: 196pt, fit: "contain")),
    box(fill: white, stroke: 0.8pt + rgb("#deded7"), inset: 8pt,
      image("slides.png", width: 292pt, height: 196pt, fit: "contain")),
  )
])

#place(top + left, pad(left: 66pt, top: 1248pt, right: 370pt)[
  #grid(columns: (1fr, auto), align: horizon,
    text(font: ("IBM Plex Mono", "Arial"), size: 12pt, weight: 700, tracking: 1.7pt,
      fill: muted, [WORKSPACE → DOCUMENT → DELIVERY]),
    text(font: ("IBM Plex Mono", "Arial"), size: 12pt, weight: 700, tracking: 1.7pt,
      fill: muted, [Tylina]),
  )
])

#place(top + left, pad(left: 790pt, top: 74pt, right: 64pt)[
  #text(font: ("IBM Plex Mono", "Arial"), size: 14pt, weight: 700, tracking: 2.4pt,
    fill: white, [THE TYPST WORKSPACE])
  #v(46pt)
  #text(font: ("Noto Sans SC", "PingFang SC"), size: 36pt, weight: 700, fill: white)[
    不是模板，#linebreak()是可以继续修改的文档。
  ]
  #v(48pt)
  #line(length: 100%, stroke: 1pt + white.transparentize(65%))
  #v(26pt)
  #text(font: ("IBM Plex Mono", "Arial"), size: 13pt, weight: 700, tracking: 1.8pt,
    fill: red, [WYSIWYG / SOURCE / EXPORT])
  #v(22pt)
  #text(font: ("Noto Serif SC", "Songti SC"), size: 22pt, fill: white.transparentize(16%))[
    和当前会话共用工作区，
    #linebreak()
    文件、素材和排版预览都在一起。
  ]
])

#place(bottom + right, pad(right: 64pt, bottom: 70pt)[
  #text(font: ("IBM Plex Mono", "Arial"), size: 13pt, weight: 700, tracking: 2pt,
    fill: white.transparentize(18%), [PDF · PPTX · TYPST])
])
