/** 按给定顺序排列，不在列表里的排在后面（按中文排序） */
export function sortByList(values: string[], order: string[]): string[] {
  return [...values].sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b, 'zh');
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}
