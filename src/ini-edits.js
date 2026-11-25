const ignorePrefix = "; sp-ini-ignore ";
const ignoreSuffix = /;\s*sp-ini-ignore\s+([\w-]+(?:,[\w-]+)*)\s*$/i;
const disabledHeader = "; sp-ini-off ";
function ignoredRules(line) {
  return ignoreSuffix.exec(line)?.[1].split(",") || [];
}

function suppression(text, line, code) {
  const rules = ignoredRules(text);
  if (rules.includes(code)) return;
  return { line, start: text.trimEnd().length, text: rules.length ? "," + code : " " + ignorePrefix + code };
}

function sectionEdit(lines, line) {
  const header = text => /^\s*\[/.test(text) || (text.startsWith(disabledHeader) && /^\s*\[/.test(text.slice(disabledHeader.length)));
  let first = line;
  while (first >= 0 && !header(lines[first])) first--;
  if (first < 0) return;
  const disabled = lines[first].startsWith(disabledHeader);
  let end = first + 1;
  while (end < lines.length && !header(lines[end])) end++;
  const edits = [];
  for (let i = first; i < end; i++) {
    if (!lines[i].trim()) continue;
    const prefix = i === first ? disabledHeader : "; ";
    if (!disabled || lines[i].startsWith(prefix)) edits.push({ line: i, start: 0, length: disabled ? prefix.length : 0, text: disabled ? "" : prefix });
  }
  return { disabled, edits };
}

module.exports = { ignoreSuffix, ignoredRules, suppression, sectionEdit };
