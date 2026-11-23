# Document fixtures: hand-written notes

Written by hand, never by `generate.sh`.

- The `.fodt` sources are the single source of truth. The docx, odt, rtf and pdf files are
  LibreOffice 7.3 conversions of them (see `GENERATED.md`).
- Hebrew paragraphs use `fo:text-align="end"` with `style:writing-mode="rl-tb"`. LibreOffice 7.3
  renders `start` on a right-to-left paragraph at the left edge; `end` renders at the right edge
  and exports the OOXML `<w:bidi w:val="1"/><w:jc w:val="left"/>` pair, which Word reads as a
  start-aligned (right edge) Hebrew paragraph.
- docx: the converter splits runs (for example `D/F` and `#` can be separate `w:r` runs; the
  Hebrew word and the Latin text of a mixed line are separate runs). Concatenate the runs.
- docx en_table: soffice adds an empty paragraph after the table. Empty blocks are dropped, so the
  expected file has no such block.
- docx songbook_mixed: the page break is `<w:br w:type="page"/>` inside the last paragraph of the
  Hebrew song. It is not a line break; the expected text has no `\n` for it. The odt keeps it as a
  paragraph property and the rtf as `\pagebb`.
- odt: runs of spaces are `<text:s text:c="N"/>` (soffice rewrites `  ` as ` <text:s text:c="1"/>`
  style splits), so decode `text:s` rather than comparing raw text.
- rtf: Hebrew is written as `\uNNNN\'3f` pairs (niqqud included); each text group begins with a
  newline after `\loch` or `{`, which is formatting, not text. Line breaks are `\line`, tabs `\tab`.
- pdf: chord symbols in a right-to-left paragraph form one left-to-right run, so a chord line reads
  left to right while its lyric reads right to left. A trailing `#` in a chord line would be
  displaced by the bidi algorithm, so `D/F#` is followed by another chord.
- anchors oracle: each index is read from the rendered page (`pdftoppm -r 150`, x positions from
  `pdftotext -bbox`): cell k counted from the right text edge (7.2 pt per monospace cell) is
  lyric grapheme k; on a space the next letter in reading order.
- g12 regenerated only the `songbook_mixed.*` binaries (and `GENERATED.md`) from the recorded run
  (title renamed to "Saltwater Steps"); `he_chords_above.*` and `en_table.*` are the g11
  conversions, produced by the same commands with the same LibreOffice version.
- `he_word_cp1255.rtf` is written by hand (Word-style: Hebrew as cp1255 `\'hh` bytes in `\rtlch`
  runs whose associated font `\af` is the `\fcharset177` font). `generate.sh` never produces or
  changes it, and its `.expected.json` is the extraction a correct reader returns.
