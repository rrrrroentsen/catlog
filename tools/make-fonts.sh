#!/bin/sh
# 生成数字用的字体子集（Fredoka，SIL OFL）。需要 npm 和 fonttools（pip install fonttools brotli）。
# 只留数字、几个符号和「CatLog」「kg」「lb」这几个字母，两个字重各约 3.6 KB。
set -e
cd "$(dirname "$0")"
mkdir -p fonts && cd fonts
[ -d node_modules/@fontsource/fredoka ] || npm i @fontsource/fredoka
F=node_modules/@fontsource/fredoka/files
for w in 500 600; do
  pyftsubset "$F/fredoka-latin-$w-normal.woff2" --text="0123456789.,:/+-−±%·°$¥€£ kglbKGLBCatLogv" --flavor=woff2 \
    --output-file="../../app/fredoka-$w.woff2" --layout-features='kern,tnum' --no-hinting
done
cp node_modules/@fontsource/fredoka/LICENSE ../../app/OFL-Fredoka.txt
ls -la ../../app/fredoka-*.woff2
