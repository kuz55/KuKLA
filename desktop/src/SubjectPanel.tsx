import { useEffect, useState } from 'react';
import { api } from './api.js';

type Subject = {
  id: string;
  fullName: string | null;
  age: number | null;
  sex: string | null;
  description: string | null;
  clothing: string | null;
  medicalNotes: string | null;
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  lastKnownAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  fullName: string;
  age: string;
  sex: string;
  description: string;
  clothing: string;
  medicalNotes: string;
  lastKnownLat: string;
  lastKnownLng: string;
  lastKnownAt: string;
};

const emptyDraft: Draft = {
  fullName: '',
  age: '',
  sex: '',
  description: '',
  clothing: '',
  medicalNotes: '',
  lastKnownLat: '',
  lastKnownLng: '',
  lastKnownAt: '',
};

const dateTimeInput = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const toDraft = (subject: Subject): Draft => ({
  fullName: subject.fullName ?? '',
  age: subject.age === null ? '' : String(subject.age),
  sex: subject.sex ?? '',
  description: subject.description ?? '',
  clothing: subject.clothing ?? '',
  medicalNotes: subject.medicalNotes ?? '',
  lastKnownLat: subject.lastKnownLat === null ? '' : String(subject.lastKnownLat),
  lastKnownLng: subject.lastKnownLng === null ? '' : String(subject.lastKnownLng),
  lastKnownAt: dateTimeInput(subject.lastKnownAt),
});

const displayDate = (value: string | null) => {
  if (!value) return 'Время не указано';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
};

export default function SubjectPanel({ searchId }: { searchId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setSubjects(await api<Subject[]>(`/searches/${encodeURIComponent(searchId)}/subjects`));
    } catch (cause) {
      setSubjects([]);
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить профиль');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let current = true;
    setSubjects([]);
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setLoading(true);
    setError('');
    api<Subject[]>(`/searches/${encodeURIComponent(searchId)}/subjects`)
      .then((result) => { if (current) setSubjects(result); })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить профиль');
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [searchId]);

  const cancel = () => {
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setError('');
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const latitude = draft.lastKnownLat.trim() === '' ? null : Number(draft.lastKnownLat);
    const longitude = draft.lastKnownLng.trim() === '' ? null : Number(draft.lastKnownLng);
    if ((latitude === null) !== (longitude === null)) {
      setError('Укажите обе координаты или оставьте оба поля пустыми');
      return;
    }

    const payload = {
      fullName: draft.fullName.trim() || null,
      age: draft.age.trim() === '' ? null : Number(draft.age),
      sex: draft.sex.trim() || null,
      description: draft.description.trim() || null,
      clothing: draft.clothing.trim() || null,
      medicalNotes: draft.medicalNotes.trim() || null,
      lastKnownLat: latitude,
      lastKnownLng: longitude,
      lastKnownAt: draft.lastKnownAt ? new Date(draft.lastKnownAt).toISOString() : null,
    };
    if (creating && !Object.entries(payload).some(([key, value]) => key !== 'lastKnownAt' && value !== null && value !== '')) {
      setError('Укажите хотя бы одну характеристику человека или координаты');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api<Subject>(`/searches/${encodeURIComponent(searchId)}/subjects/${encodeURIComponent(editingId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api<Subject>(`/searches/${encodeURIComponent(searchId)}/subjects`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      cancel();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить профиль');
    } finally {
      setSaving(false);
    }
  };

  const beginCreate = () => {
    setError('');
    setEditingId(null);
    setDraft(emptyDraft);
    setCreating(true);
  };

  const beginEdit = (subject: Subject) => {
    setError('');
    setCreating(false);
    setEditingId(subject.id);
    setDraft(toDraft(subject));
  };

  const form = (
    <form className="subjectForm" onSubmit={submit}>
      <div className="subjectFormGrid">
        <label>Имя или ориентир
          <input maxLength={160} value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
        </label>
        <label>Возраст
          <input type="number" min={0} max={130} step={1} value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} />
        </label>
        <label>Пол / описание
          <input maxLength={40} value={draft.sex} onChange={(event) => setDraft({ ...draft, sex: event.target.value })} />
        </label>
        <label>Одежда и приметы
          <textarea maxLength={2000} rows={3} value={draft.clothing} onChange={(event) => setDraft({ ...draft, clothing: event.target.value })} />
        </label>
        <label className="subjectWide">Описание
          <textarea maxLength={4000} rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <label className="subjectWide">Медицинская информация — ограниченный доступ
          <textarea maxLength={4000} rows={3} value={draft.medicalNotes} onChange={(event) => setDraft({ ...draft, medicalNotes: event.target.value })} />
        </label>
        <label>Последняя известная широта
          <input type="number" min={-90} max={90} step="any" value={draft.lastKnownLat} onChange={(event) => setDraft({ ...draft, lastKnownLat: event.target.value })} />
        </label>
        <label>Последняя известная долгота
          <input type="number" min={-180} max={180} step="any" value={draft.lastKnownLng} onChange={(event) => setDraft({ ...draft, lastKnownLng: event.target.value })} />
        </label>
        <label className="subjectWide">Время фиксации координат
          <input type="datetime-local" value={draft.lastKnownAt} onChange={(event) => setDraft({ ...draft, lastKnownAt: event.target.value })} />
        </label>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="subjectFormActions">
        <button className="primary" type="submit" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
        <button type="button" onClick={cancel} disabled={saving}>Отмена</button>
      </div>
    </form>
  );

  return (
    <section className="panel subjectPanel">
      <div className="panelTitle">
        <div>
          <h2>Профили пропавших</h2>
          <p>Доступ только пользователям с правами управления и доступом к этому поиску.</p>
        </div>
        {!creating && !editingId && <button className="primary" type="button" onClick={beginCreate}>＋ Добавить профиль</button>}
      </div>
      <div className="subjectPrivacyNotice" role="note">
        Полевой и мобильный доступ, загрузка фотографий и утверждённые сроки хранения и удаления этих данных пока не реализованы.
      </div>
      {error && !creating && !editingId && <div className="error" role="alert">{error}</div>}
      {loading ? <p className="subjectEmpty">Загрузка…</p> : subjects.length === 0 && !creating && !error ? <p className="subjectEmpty">Профиль ещё не добавлен.</p> : null}
      {creating && form}
      {!loading && subjects.map((subject) => editingId === subject.id ? (
        <div key={subject.id}>{form}</div>
      ) : (
        <article className="subjectCard" key={subject.id}>
          <div className="subjectCardHeader">
            <div>
              <h3>{subject.fullName ?? 'Имя не указано'}</h3>
              <p>{[subject.age !== null ? `${subject.age} лет` : null, subject.sex].filter(Boolean).join(' · ') || 'Возраст и пол не указаны'}</p>
            </div>
            <button type="button" onClick={() => beginEdit(subject)}>Изменить</button>
          </div>
          {subject.description && <div className="subjectDetail"><b>Описание</b><p>{subject.description}</p></div>}
          {subject.clothing && <div className="subjectDetail"><b>Одежда и приметы</b><p>{subject.clothing}</p></div>}
          {subject.medicalNotes && <div className="subjectMedical"><b>Медицинская информация</b><p>{subject.medicalNotes}</p></div>}
          {(subject.lastKnownLat !== null || subject.lastKnownLng !== null) && (
            <div className="subjectLocation">
              <b>Последнее известное местоположение</b>
              <span>{subject.lastKnownLat}, {subject.lastKnownLng}</span>
              <small>{displayDate(subject.lastKnownAt)}</small>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
