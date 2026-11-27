/** Unknown entries retain source order. Duplicate sibling names keep their source occurrence. */
export function siblingKeys(nodes: readonly {name:string}[]) {
  const counts = new Map<string,number>();
  return nodes.map(({name}) => {
    const occurrence = (counts.get(name) ?? 0) + 1;
    counts.set(name,occurrence);
    return occurrence === 1 ? name : name + " [" + occurrence + "]";
  });
}

export function orderedSiblings<T extends {name:string}>(nodes: T[], order: readonly string[]) {
  const keys = siblingKeys(nodes);
  const rows = nodes.map((node,i) => ({node,key:keys[i]}));
  if (!order.length || rows.length < 2) return rows;
  const ranks = new Map(order.map((key,i) => [key,i]));
  return rows.sort((a,b) =>
    (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity));
}

export function orderHierarchy<T extends {name:string; children:T[]}>(nodes: T[], order: readonly string[]): T[] {
  if (!order.length || !nodes.length) return nodes;
  return orderedSiblings(nodes,order).map(({node}) => ({...node,children:orderHierarchy(node.children,order)}));
}
