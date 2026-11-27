export const isColliderName = (name: string) => /coll|_col(?:$|[_\d.])/i.test(name);

export type MeshTags = Map<string, Map<string, boolean>>;

export function tagOverride(tags: MeshTags, label: string, names: string[]): boolean | undefined {
  for (const name of names) {
    const value = tags.get(name)?.get(label);
    if (value !== undefined) return value;
  }
}

export function colliderType(tags: MeshTags, ...names: string[]): boolean {
  return tagOverride(tags, "Collider", names) ?? names.some(isColliderName);
}
