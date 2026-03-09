import { parsePagedResponse } from './paged-response.adapter';

describe('parsePagedResponse', () => {
  it('parses standard paged envelope responses', () => {
    const parsed = parsePagedResponse<{ id: number }>({
      items: [{ id: 1 }, { id: 2 }],
      total: 8,
      page: 2,
      pageSize: 2,
    });

    expect(parsed.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parsed.total).toBe(8);
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(2);
  });

  it('parses plain array responses as a fallback', () => {
    const parsed = parsePagedResponse<{ id: number }>([{ id: 10 }, { id: 11 }]);

    expect(parsed.items).toEqual([{ id: 10 }, { id: 11 }]);
    expect(parsed.total).toBe(2);
    expect(parsed.page).toBeNull();
    expect(parsed.pageSize).toBeNull();
  });
});
