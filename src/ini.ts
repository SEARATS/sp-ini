import { ignoreSuffix } from "./ini-edits";
const unitSection = /^(?:Taskforce\d+|Blue|Red|Neutral)(Vessel|Submarine|Aircraft|Helicopter|LandUnit|Biologic)\d+$/i;
const directives = {
  extend: "Add entries to another INI file.",
  prepend: "Load entries before the target INI file.",
  alias: "Use definitions from another INI file.",
  copy: "Create a separate definition based on the source file.",
  repeat: "Repeat a block with named substitutions.",
  end: "Close a repeat block."
};

function sectionGroup(name) {
  return name.toLowerCase().replace(/^(?:taskforce\d+|blue|red|neutral)(?=vessel|submarine|aircraft|helicopter|landunit|biologic)/, "taskforce")
    .replace(/\d+/g, "#");
}

export interface IniSection { name: string; line: number; start: number; keys: IniEntry[] }
export interface IniEntry { name: string; value: string; valueStart: number; line: number; start: number; section?: IniSection; repeated: boolean }

function parse(text: string) {
  const lines = text.split(/\r\n|\n|\r/);
  const sections: IniSection[] = [], entries: IniEntry[] = [], issues = [], modifiers = [];
  let section: IniSection, repeat: number;
  for (const [line, raw] of lines.entries()) {
    const start = raw.search(/\S/);
    if (start < 0) continue;
    const value = raw.slice(start);
    const directive = value.startsWith("#!") && /^#!(\w+)\b\s*(.*)/.exec(value.replace(ignoreSuffix, "").trimEnd());
    if (directive) {
      const [, name, args] = directive;
      modifiers.push({ name, args, line, argsStart: start + directive[0].length - args.length });
      if (name === "repeat") {
        if (repeat !== undefined) issues.push({ line, message: "Nested #!repeat block." });
        else repeat = line;
      } else if (name === "end") {
        if (repeat === undefined) issues.push({ line, message: "No matching #!repeat." });
        repeat = undefined;
      } else if (Object.hasOwn(directives, name) && !args.trim()) {
        issues.push({ line, message: "Expected a target path." });
      }
      continue;
    }
    const content = value.split(/;|#|(?<!:)\/\//, 1)[0].trimEnd();
    if (!content) continue;
    if (content.startsWith("[")) {
      const match = /^\[([^\]]+)\]$/.exec(content);
      section = undefined;
      if (!match) issues.push({ line, message: "Expected a [section name]." });
      else if (!/^[ =*-]/.test(match[1])) {
        section = { name: match[1], line, start: start + 1, keys: [] };
        sections.push(section);
      }
      continue;
    }
    const equals = content.indexOf("=");
    if (equals < 1) {
      issues.push({ line, message: "Expected key=value." });
      continue;
    }
    const key = content.slice(0, equals).trimEnd();
    const tail = content.slice(equals + 1);
    const entry = { name: key, value: tail.trim(), valueStart: start + equals + 1 + tail.length - tail.trimStart().length,
      start, line, section, repeated: repeat !== undefined };
    entries.push(entry);
    section?.keys.push(entry);
  }
  if (repeat !== undefined) issues.push({ line: repeat, message: "Missing #!end." });
  return { lines, sections, entries, modifiers, issues };
}

export { parse, sectionGroup, unitSection, directives };
