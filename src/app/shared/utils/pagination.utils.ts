export type PaginationItem = number;

export const PAGINATION_ELLIPSIS = -1;

export function buildPaginationItems(
  totalPages: number,
  currentPage: number,
  maxNumericLinks: number = 5,
): PaginationItem[] {
  const total = Math.max(0, Math.floor(totalPages));
  const current = Math.max(1, Math.floor(currentPage));

  if (total <= 0) {
    return [];
  }

  if (total <= maxNumericLinks) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const items: PaginationItem[] = [1];

  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);

  if (current <= 3) {
    start = 2;
    end = 4;
  } else if (current >= total - 2) {
    start = total - 3;
    end = total - 1;
  }

  if (start > 2) {
    items.push(PAGINATION_ELLIPSIS);
  }

  for (let page = start; page <= end; page++) {
    items.push(page);
  }

  if (end < total - 1) {
    items.push(PAGINATION_ELLIPSIS);
  }

  items.push(total);

  return items;
}
