#!/usr/bin/env bash
# Regenerates the docx/odt/rtf/pdf fixtures from the hand-written Flat ODT sources.
# Writes only into ${OUT_DIR:-<this directory>}: 12 binaries and GENERATED.md.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${OUT_DIR:-$here}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

names=(he_chords_above en_table songbook_mixed)
filters=('docx:MS Word 2007 XML' 'odt' 'rtf' 'pdf:writer_pdf_Export')
exts=(docx odt rtf pdf)

version="$(soffice --version | head -n 1)"
commands=()

for name in "${names[@]}"; do
  for i in "${!exts[@]}"; do
    ext="${exts[$i]}"
    filter="${filters[$i]}"
    cmd="soffice --headless --convert-to \"${filter}\" --outdir <tmp> ${name}.fodt"
    commands+=("$cmd")
    soffice --headless --convert-to "$filter" --outdir "$tmp" "$here/$name.fodt" >/dev/null
    cp "$tmp/$name.$ext" "$out/$name.$ext"
  done
done

{
  printf '%s\n' "$version"
  for c in "${commands[@]}"; do
    printf '%s\n' "$c"
  done
} > "$out/GENERATED.md"
