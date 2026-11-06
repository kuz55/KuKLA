// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import SectorZones from './SectorZones.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);
const sector = {
  id: 'sector-1',
  code: 'F1',
  name: 'Сектор 1',
  status: 'UNSEARCHED',
  priority: 1,
  zoneType: 'FOOT_AREA',
  geometry: { type: 'Polygon', coordinates: [] },
  sweepParams: { laneWidthM: 20, speedKmh: 3.5 },
  metrics: {
    areaSqM: 572_000,
    perimeterM: 3140,
    lengthM: 0,
    plannedCoverageSqM: 603_000,
    estimatedHours: 8.2,
    podPct: 21.3,
  },
};
const coverage = {
  totalAreaSqM: 572_000,
  totalPlannedCoverageSqM: 603_000,
  byType: { FOOT_AREA: { count: 1, areaSqM: 572_000, plannedCoverageSqM: 603_000, podPct: 21.3 } },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('SectorZones', () => {
  it('lists sectors and shows computed coverage metrics for a manager', async () => {
    apiMock
      .mockResolvedValueOnce([sector] as never)
      .mockResolvedValueOnce(coverage as never);

    const { container } = render(<SectorZones searchId="search-1" canManage onChanged={vi.fn()} />);

    expect(await screen.findByText('F1')).toBeTruthy();
    expect(container.textContent).toContain('Пеший участок');
    expect(container.textContent).toMatch(/57[.,]20\s*га|572000\s*м²|0[.,]57\s*км²/);
    expect(apiMock).toHaveBeenNthCalledWith(1, '/searches/search-1/sectors');
    expect(apiMock).toHaveBeenNthCalledWith(2, '/searches/search-1/coverage');
  });

  it('creates a sector from valid GeoJSON and refreshes the view', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    apiMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ totalAreaSqM: 0, totalPlannedCoverageSqM: 0, byType: {} } as never)
      .mockResolvedValueOnce({ id: 'new', metrics: {} } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ totalAreaSqM: 0, totalPlannedCoverageSqM: 0, byType: {} } as never);

    render(<SectorZones searchId="search-1" canManage onChanged={onChanged} />);

    fireEvent.change(await screen.findByLabelText('Код'), { target: { value: 'F2' } });
    fireEvent.change(screen.getByLabelText('Геометрия (GeoJSON)'), {
      target: { value: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать зону' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(apiMock).toHaveBeenNthCalledWith(
      3,
      '/searches/search-1/sectors',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = apiMock.mock.calls[2][1] as { body?: string } | undefined;
    const body = JSON.parse(call?.body ?? '{}');
    expect(body.code).toBe('F2');
    expect(body.zoneType).toBe('FOOT_AREA');
    expect(body.geometry.type).toBe('Polygon');
  });

  it('rejects invalid GeoJSON without sending a request', async () => {
    apiMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({ totalAreaSqM: 0, totalPlannedCoverageSqM: 0, byType: {} } as never);

    render(<SectorZones searchId="search-1" canManage onChanged={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Код'), { target: { value: 'BAD' } });
    fireEvent.change(screen.getByLabelText('Геометрия (GeoJSON)'), { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать зону' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/GeoJSON/i);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('hides the editor for non-managers', () => {
    render(<SectorZones searchId="search-1" canManage={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Создать зону' })).toBeNull();
    expect(screen.getByText(/только руководитель поиска/i)).toBeTruthy();
  });
});
