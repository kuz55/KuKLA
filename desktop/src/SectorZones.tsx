import { useEffect, useState } from 'react';
import { api } from './api.js';

type ZoneType = 'FOOT_AREA' | 'VEHICLE_CORRIDOR' | 'UAV_AREA' | 'GENERIC';

interface SectorMetrics {
  areaSqM: number;
  perimeterM: number;
  lengthM: number;
  plannedCoverageSqM: number;
  estimatedHours: number;
  podPct: number;
}

interface Sector {
  id: string;
  code: string;
  name?: string;
  status: string;
  priority: number;
  zoneType: ZoneType;
  geometry: unknown;
  sweepParams: Record<string, unknown>;
  notes?: string;
  metrics: SectorMetrics;
}

interface Coverage {
  totalAreaSqM: number;
  totalPlannedCoverageSqM: number;
  byType: Record<string, { count: number; areaSqM: number; plannedCoverageSqM: number; podPct: number }>;
}

type SectorZonesProps = {
  searchId: string;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
};

const EXAMPLE_GEOMETRY = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[73.0, 55.0], [73.009, 55.0], [73.009, 55.009], [73.0, 55.009], [73.0, 55.0]]],
}, null, 2);

const zoneLabels: Record<ZoneType, string> = {
  FOOT_AREA: 'Пеший участок (полосы прочёсывания)',
  VEHICLE_CORRIDOR: 'Авто коридор (вдоль дорог)',
  UAV_AREA: 'Зона облёта БПЛА',
  GENERIC: 'Произвольная зона',
};

const formatArea = (sqm: number) => {
  if (sqm >= 1_000_000) return `${(sqm / 1_000_000).toFixed(2)} км²`;
  if (sqm >= 10_000) return `${(sqm / 10_000).toFixed(2)} га`;
  return `${Math.round(sqm)} м²`;
};

const SectorZones = ({ searchId, canManage, onChanged }: SectorZonesProps) => {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [zoneType, setZoneType] = useState<ZoneType>('FOOT_AREA');
  const [priority, setPriority] = useState('2');
  const [geometryText, setGeometryText] = useState(EXAMPLE_GEOMETRY);
  const [laneWidthM, setLaneWidthM] = useState('');
  const [speedKmh, setSpeedKmh] = useState('');
  const [viewRadiusM, setViewRadiusM] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const enc = encodeURIComponent(searchId);
    setLoading(true);
    return Promise.all([
      api<Sector[]>(`/searches/${enc}/sectors`),
      api<Coverage>(`/searches/${enc}/coverage`),
    ])
      .then(([list, cov]) => {
        setSectors(list);
        setCoverage(cov);
      })
      .catch((cause) => {
        setSectors([]);
        setCoverage(null);
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сектора');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId]);

  const createSector = async () => {
    if (!code) {
      setError('Укажите код сектора');
      return;
    }
    let geometry: unknown;
    try {
      geometry = JSON.parse(geometryText);
    } catch {
      setError('Геометрия должна быть валидным JSON (GeoJSON)');
      return;
    }
    const sweepParams: Record<string, number> = {};
    if (laneWidthM) sweepParams.laneWidthM = Number(laneWidthM);
    if (speedKmh) sweepParams.speedKmh = Number(speedKmh);
    if (viewRadiusM) sweepParams.viewRadiusM = Number(viewRadiusM);
    if (hours) sweepParams.hours = Number(hours);

    setBusy(true);
    setError('');
    try {
      const enc = encodeURIComponent(searchId);
      await api(`/searches/${enc}/sectors`, {
        method: 'POST',
        body: JSON.stringify({
          code,
          name: name || undefined,
          zoneType,
          priority: Number(priority),
          geometry,
          sweepParams,
        }),
      });
      setCode('');
      setName('');
      await onChanged();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать сектор');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sectorZones">
      <div className="sectorZonesTitle">
        <b>Зоны поиска ({sectors.length})</b>
        {coverage && (
          <small className="sectorCoverageSummary">
            Покрытие: {formatArea(coverage.totalPlannedCoverageSqM)}
            {coverage.totalAreaSqM > 0 && ` из ${formatArea(coverage.totalAreaSqM)}`}
          </small>
        )}
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      {loading && <p className="memberHint">Загрузка зон…</p>}

      <div className="sectorRows">
        {sectors.map((sector) => (
          <div className="sectorRow" key={sector.id}>
            <div className="sectorRowHead">
              <b>{sector.code}</b>
              <small>{zoneLabels[sector.zoneType] ?? sector.zoneType}</small>
              <small>приоритет {sector.priority}</small>
            </div>
            {sector.name && <div className="sectorName">{sector.name}</div>}
            <div className="sectorMetrics">
              <span>Площадь: {formatArea(sector.metrics.areaSqM)}</span>
              <span>План покрытия: {formatArea(sector.metrics.plannedCoverageSqM)}</span>
              <span>≈ {sector.metrics.estimatedHours} ч</span>
              <span>POD: {sector.metrics.podPct}%</span>
            </div>
          </div>
        ))}
        {!loading && sectors.length === 0 && <p className="memberHint">Зоны поиска ещё не определены.</p>}
      </div>

      {canManage && (
        <div className="sectorEditor">
          <h4>Новая зона</h4>
          <div className="sectorEditorRow">
            <label htmlFor={`sector-code-${searchId}`}>Код</label>
            <input
              id={`sector-code-${searchId}`}
              value={code}
              maxLength={20}
              onChange={(event) => setCode(event.target.value)}
            />
            <label htmlFor={`sector-name-${searchId}`}>Название</label>
            <input
              id={`sector-name-${searchId}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="sectorEditorRow">
            <label htmlFor={`sector-type-${searchId}`}>Тип зоны</label>
            <select
              id={`sector-type-${searchId}`}
              value={zoneType}
              onChange={(event) => setZoneType(event.target.value as ZoneType)}
            >
              {Object.entries(zoneLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <label htmlFor={`sector-priority-${searchId}`}>Приоритет</label>
            <select
              id={`sector-priority-${searchId}`}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="1">1 (высокий)</option>
              <option value="2">2 (средний)</option>
              <option value="3">3 (низкий)</option>
            </select>
          </div>
          <div className="sectorEditorRow">
            <label htmlFor={`sector-lane-${searchId}`}>Ширина полосы (м)</label>
            <input
              id={`sector-lane-${searchId}`}
              type="number"
              value={laneWidthM}
              onChange={(event) => setLaneWidthM(event.target.value)}
            />
            <label htmlFor={`sector-speed-${searchId}`}>Скорость (км/ч)</label>
            <input
              id={`sector-speed-${searchId}`}
              type="number"
              value={speedKmh}
              onChange={(event) => setSpeedKmh(event.target.value)}
            />
            <label htmlFor={`sector-view-${searchId}`}>Радиус обзора (м)</label>
            <input
              id={`sector-view-${searchId}`}
              type="number"
              value={viewRadiusM}
              onChange={(event) => setViewRadiusM(event.target.value)}
            />
            <label htmlFor={`sector-hours-${searchId}`}>Часы (усилие)</label>
            <input
              id={`sector-hours-${searchId}`}
              type="number"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="sectorEditorRow">
            <label htmlFor={`sector-geom-${searchId}`}>Геометрия (GeoJSON)</label>
            <textarea
              id={`sector-geom-${searchId}`}
              className="sectorGeometry"
              value={geometryText}
              onChange={(event) => setGeometryText(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="sectorAddButton"
            onClick={() => void createSector()}
            disabled={busy || !code}
          >
            {busy ? 'Создание…' : 'Создать зону'}
          </button>
        </div>
      )}

      {!canManage && <p className="memberHint">Только руководитель поиска может создавать зоны.</p>}
    </div>
  );
};

export default SectorZones;
