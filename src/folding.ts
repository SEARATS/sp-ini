function iniFolds(lines) {
  const ranges = [];
  let start, end;
  for (const [line, text] of lines.entries()) {
    if (/^\s*\[/.test(text)) {
      if (end > start) ranges.push({ startLine: start, endLine: end });
      start = line;
    }
    if (/\S/.test(text)) end = line;
  }
  if (end > start) ranges.push({ startLine: start, endLine: end });
  return ranges;
}

function objFolds(document) {
  const ranges = [];
  let object, group, end;
  function close(start) {
    if (end > start) ranges.push({ startLine: start, endLine: end });
  }
  for (let line = 0; line < document.lineCount; line++) {
    const text = document.lineAt(line).text.trimStart();
    if (!text) continue;
    const header = /^([og])(?:\s|$)/.exec(text);
    if (header) {
      close(group);
      group = undefined;
      if (header[1] === "o") {
        close(object);
        object = line;
      } else group = line;
    }
    end = line;
  }
  close(group);
  close(object);
  return ranges.sort((a, b) => a.startLine - b.startLine);
}

export { iniFolds, objFolds };
