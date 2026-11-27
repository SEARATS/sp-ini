interface MeshFlag {
  label: string;
  icon: string;
}

export const meshFlagSetting = "seapowerIni.meshFlags";

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];

/** Compile once per settings change. A bad expression only disables that expression. */
export function meshFlagMatcher(value: unknown) {
  const rules: {flag: MeshFlag; substrings: string[]; patterns: RegExp[]}[] = [];
  for (const rule of Array.isArray(value) ? value : []) {
    if (!rule || rule.enabled === false || typeof rule.label !== "string" || !rule.label.trim()) continue;
    const substrings = strings(rule.substrings).map(text => text.toLowerCase());
    const patterns: RegExp[] = [];
    for (const source of strings(rule.patterns)) {
      try { patterns.push(new RegExp(source, "i")); } catch { /* Settings may be mid-edit. */ }
    }
    const flag: MeshFlag = {label:rule.label, icon:typeof rule.icon === "string" && /^[a-z0-9-]+$/.test(rule.icon) ? rule.icon : "tag"};
    rules.push({flag, substrings, patterns});
  }
  return (...names: string[]): MeshFlag[] => {
    const candidates = [...new Set(names.filter(Boolean))].map(name => ({name, lower:name.toLowerCase()}));
    return rules.filter(({substrings, patterns}) => candidates.some(({name, lower}) =>
      substrings.some(text => lower.includes(text)) || patterns.some(regex => regex.test(name))))
      .map(rule => rule.flag);
  };
}
