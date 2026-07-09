// std/shapes recipe source. Cooked template: must stay free of backslashes and backticks.
export default `# std/shapes — bundled shared parts

draw arrow 7x7:
  pal k=#1a1a1a
  pixels:
    ...k...
    ..kk...
    .kkkkkk
    kkkkkkk
    .kkkkkk
    ..kk...
    ...k...

draw dot 3x3:
  pal k=#1a1a1a
  pixels:
    .k.
    kkk
    .k.

draw spark(c) 5x5:
  px c 2:0
  px c 2:1
  px c 0:2
  px c 1:2
  px c 2:2
  px c 3:2
  px c 4:2
  px c 2:3
  px c 2:4

draw star4(c) 7x7:
  px c 3:0
  px c 3:1
  px c 3:2
  px c 0:3
  px c 1:3
  px c 2:3
  px c 3:3
  px c 4:3
  px c 5:3
  px c 6:3
  px c 3:4
  px c 3:5
  px c 3:6

draw dash(c) 5x1:
  line c 0:0 4:0

draw arcMark(c) 7x4:
  arc c 3:3 3 200 340

draw zig(c) 7x3:
  poly c 0:1 2:1 3:0 4:2 6:2

draw blob(c) 7x5:
  ellipse c 3:2 3:2 fill
  circle c 2:1 1 fill
  circle c 5:2 1 fill

draw capsule(c) 8x3:
  rrect c 0:0 7:2 1 fill

draw leaf(c) 7x4:
  ellipse c 3:2 3:1 fill
  line c 1:2 5:2

draw tri(c) 5x5:
  poly c 2:0 4:4 0:4 fill
`
