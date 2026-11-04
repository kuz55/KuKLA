// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import SubjectPanel from './SubjectPanel.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);
const subject = {
  id: 'subject-1',
  fullName: 'Иван Иванов',
  age: 42,
  sex: 'Не указано',
  description: 'Тестовое описание',
  clothing: 'Тёмная куртка',
  medicalNotes: 'Тестовая медицинская заметка',
  lastKnownLat: 58.0105,
  lastKnownLng: 73.3682,
  lastKnownAt: '2026-11-04T10:00:00.000Z',
  createdAt: '2026-11-04T10:00:00.000Z',
  updatedAt: '2026-11-04T10:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('SubjectPanel', () => {
  it('loads only the current search and exposes list/edit, but no delete action', async () => {
    apiMock.mockResolvedValueOnce([subject] as never);

    render(<SubjectPanel searchId="search/one" />);

    expect(await screen.findByText('Иван Иванов')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('/searches/search%2Fone/subjects');
    expect(screen.getByText('Тестовая медицинская заметка')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /удалить/i })).toBeNull();
  });

  it('requires at least one detail before creating a profile', async () => {
    apiMock.mockResolvedValueOnce([] as never);
    render(<SubjectPanel searchId="search-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /добавить профиль/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Укажите хотя бы одну характеристику');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an incomplete coordinate pair without sending a request', async () => {
    apiMock.mockResolvedValueOnce([] as never);
    render(<SubjectPanel searchId="search-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /добавить профиль/i }));
    fireEvent.change(screen.getByLabelText('Последняя известная широта'), { target: { value: '58.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Укажите обе координаты');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('creates a profile with trimmed text, then reloads the same search', async () => {
    apiMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(subject as never)
      .mockResolvedValueOnce([subject] as never);
    render(<SubjectPanel searchId="search-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /добавить профиль/i }));
    fireEvent.change(screen.getByLabelText('Имя или ориентир'), { target: { value: '  Иван Иванов  ' } });
    fireEvent.change(screen.getByLabelText('Последняя известная широта'), { target: { value: '58.0105' } });
    fireEvent.change(screen.getByLabelText('Последняя известная долгота'), { target: { value: '73.3682' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await screen.findByText('Иван Иванов');
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    expect(apiMock.mock.calls[1][0]).toBe('/searches/search-1/subjects');
    expect(apiMock.mock.calls[1][1]?.method).toBe('POST');
    expect(JSON.parse(String(apiMock.mock.calls[1][1]?.body))).toMatchObject({
      fullName: 'Иван Иванов',
      lastKnownLat: 58.0105,
      lastKnownLng: 73.3682,
    });
    expect(apiMock.mock.calls[2][0]).toBe('/searches/search-1/subjects');
  });

  it('updates through PATCH and keeps the profile in the current search', async () => {
    const updatedSubject = { ...subject, description: 'Обновлённое описание' };
    apiMock
      .mockResolvedValueOnce([subject] as never)
      .mockResolvedValueOnce(updatedSubject as never)
      .mockResolvedValueOnce([updatedSubject] as never);
    render(<SubjectPanel searchId="search-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }));
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Обновлённое описание' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Обновлённое описание')).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    expect(apiMock.mock.calls[1][0]).toBe('/searches/search-1/subjects/subject-1');
    expect(apiMock.mock.calls[1][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(apiMock.mock.calls[1][1]?.body))).toMatchObject({
      description: 'Обновлённое описание',
    });
  });

  it('shows a network error and does not fall back to cached/offline data', async () => {
    apiMock.mockRejectedValueOnce(new Error('Сервер недоступен'));
    render(<SubjectPanel searchId="search-1" />);

    expect((await screen.findByRole('alert')).textContent).toContain('Сервер недоступен');
    expect(screen.queryByText('Иван Иванов')).toBeNull();
    expect(screen.queryByText(/офлайн|offline/i)).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('clears the previously loaded list if the post-save refresh fails', async () => {
    const updatedSubject = { ...subject, description: 'Обновлённое описание' };
    apiMock
      .mockResolvedValueOnce([subject] as never)
      .mockResolvedValueOnce(updatedSubject as never)
      .mockRejectedValueOnce(new Error('Сервер недоступен'));
    render(<SubjectPanel searchId="search-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Изменить' }));
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Обновлённое описание' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Сервер недоступен');
    expect(screen.queryByText('Иван Иванов')).toBeNull();
  });

  it('keeps the create form visible and shows the server error when saving fails', async () => {
    apiMock
      .mockResolvedValueOnce([] as never)
      .mockRejectedValueOnce(new Error('Сервер недоступен'));
    render(<SubjectPanel searchId="search-1" />);

    fireEvent.click(await screen.findByRole('button', { name: /добавить профиль/i }));
    fireEvent.change(screen.getByLabelText('Имя или ориентир'), { target: { value: 'Тестовый субъект' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Сервер недоступен');
    expect((screen.getByLabelText('Имя или ориентир') as HTMLInputElement).value).toBe('Тестовый субъект');
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
