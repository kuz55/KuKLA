// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import SearchMembers from './SearchMembers.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('SearchMembers', () => {
  it('adds an available user only to the selected search and refreshes that view', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    apiMock
      .mockResolvedValueOnce([
        { id: 'already-member', name: 'Уже в поиске', role: 'SEARCHER', active: true },
        { id: 'candidate', name: 'Кандидат', role: 'SEARCHER', active: true },
        { id: 'inactive', name: 'Неактивный', role: 'SEARCHER', active: false },
      ] as never)
      .mockResolvedValueOnce({ ok: true, added: true } as never);

    render(
      <SearchMembers
        searchId="search/one"
        members={[{ id: 'already-member', name: 'Уже в поиске', role: 'SEARCHER' }]}
        currentUserId="regional-manager"
        canManage
        onChanged={onChanged}
      />,
    );

    const selector = await screen.findByRole('combobox');
    expect(screen.getByRole('option', { name: 'Кандидат · Поисковик' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Уже в поиске · Поисковик' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Неактивный · Поисковик' })).toBeNull();

    fireEvent.change(selector, { target: { value: 'candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(apiMock).toHaveBeenNthCalledWith(1, '/users');
    expect(apiMock).toHaveBeenNthCalledWith(2, '/searches/search%2Fone/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'candidate' }),
    });
  });

  it('does not load or expose member-management controls when the current role cannot manage', () => {
    render(
      <SearchMembers
        searchId="search-1"
        members={[{ id: 'member-1', name: 'Участник', role: 'SEARCHER' }]}
        currentUserId="viewer"
        canManage={false}
        onChanged={vi.fn()}
      />,
    );

    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText('Участники (1)')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Исключить Участник из поиска' })).toBeNull();
  });

  it('allows a manager to remove another member but never presents removal for their own account', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ ok: true, removed: true } as never);

    render(
      <SearchMembers
        searchId="search-1"
        members={[
          { id: 'regional-manager', name: 'Региональный руководитель', role: 'REGIONAL_MANAGER' },
          { id: 'member-1', name: 'Участник', role: 'SEARCHER' },
        ]}
        currentUserId="regional-manager"
        canManage
        onChanged={onChanged}
      />,
    );

    const removeButton = await screen.findByRole('button', { name: 'Исключить Участник из поиска' });
    expect(screen.queryByRole('button', { name: 'Исключить Региональный руководитель из поиска' })).toBeNull();
    fireEvent.click(removeButton);

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledOnce();
    expect(apiMock).toHaveBeenNthCalledWith(1, '/users');
    expect(apiMock).toHaveBeenNthCalledWith(2, '/searches/search-1/members/member-1', {
      method: 'DELETE',
    });
  });

  it('shows server errors instead of assuming that a membership change succeeded', async () => {
    apiMock
      .mockResolvedValueOnce([{ id: 'candidate', name: 'Кандидат', role: 'SEARCHER', active: true }] as never)
      .mockRejectedValueOnce(new Error('Доступ запрещён'));

    render(
      <SearchMembers
        searchId="search-1"
        members={[]}
        currentUserId="regional-manager"
        canManage
        onChanged={vi.fn()}
      />,
    );

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Доступ запрещён');
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
