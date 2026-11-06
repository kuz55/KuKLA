import { useEffect, useState } from 'react';
import { api } from './api.js';

type Member = {
  id: string;
  name: string;
  role: string;
  active?: boolean;
};

type SearchMembersProps = {
  searchId: string;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
};

const roleLabels: Record<string, string> = {
  SYSTEM_OWNER: 'Владелец системы',
  SUPERADMIN: 'Суперадминистратор',
  SUPERUSER: 'Суперпользователь',
  ADMIN: 'Администратор',
  LEADER: 'Руководитель поиска',
  COORDINATOR: 'Координатор',
  REGIONAL_MANAGER: 'Региональный руководитель',
  SEARCHER: 'Поисковик',
  VIEWER: 'Наблюдатель',
};

const roleLabel = (role: string) => roleLabels[role] ?? role;

const SearchMembers = ({ searchId, members, currentUserId, canManage, onChanged }: SearchMembersProps) => {
  const [users, setUsers] = useState<Member[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canManage) {
      setUsers([]);
      setLoadingUsers(false);
      setError('');
      return;
    }

    let active = true;
    setUsers([]);
    setSelectedUserId('');
    setError('');
    setLoadingUsers(true);

    api<Member[]>('/users')
      .then((result) => {
        if (active) setUsers(result);
      })
      .catch((cause) => {
        if (active) {
          setUsers([]);
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить доступных пользователей');
        }
      })
      .finally(() => {
        if (active) setLoadingUsers(false);
      });

    return () => {
      active = false;
    };
  }, [searchId, canManage]);

  const memberIds = new Set(members.map((member) => member.id));
  const candidates = users.filter((user) => user.active !== false && !memberIds.has(user.id));

  const addMember = async () => {
    if (!selectedUserId) return;
    const userId = selectedUserId;
    setBusyUserId(userId);
    setError('');
    try {
      await api(`/searches/${encodeURIComponent(searchId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setSelectedUserId('');
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось добавить участника');
    } finally {
      setBusyUserId(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (member.id === currentUserId || !window.confirm(`Исключить ${member.name} из этого поиска?`)) return;
    setBusyUserId(member.id);
    setError('');
    try {
      await api(`/searches/${encodeURIComponent(searchId)}/members/${encodeURIComponent(member.id)}`, {
        method: 'DELETE',
      });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось исключить участника');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="searchMembers">
      <div className="searchMembersTitle">
        <b>Участники ({members.length})</b>
      </div>

      {canManage && (
        <div className="memberControls">
          <p>Добавление предоставляет доступ к выбранному поиску. Членство в организации проверяется отдельно.</p>
          <div className="memberControlRow">
            <label className="visuallyHidden" htmlFor={`member-candidate-${searchId}`}>Пользователь для добавления</label>
            <select
              id={`member-candidate-${searchId}`}
              aria-label="Пользователь для добавления"
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              disabled={loadingUsers || candidates.length === 0 || busyUserId !== null}
            >
              <option value="">{loadingUsers ? 'Загрузка пользователей…' : 'Выберите пользователя'}</option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {roleLabel(user.role)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="memberAddButton"
              onClick={() => void addMember()}
              disabled={!selectedUserId || busyUserId !== null}
            >
              {busyUserId === selectedUserId && selectedUserId ? 'Добавление…' : 'Добавить'}
            </button>
          </div>
          {!loadingUsers && !error && candidates.length === 0 && (
            <small className="memberHint">Нет доступных пользователей для добавления. Нового пользователя сначала должен пригласить администратор.</small>
          )}
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      <div className="memberRows">
        {members.map((member) => (
          <div className="searchMemberRow" key={member.id}>
            <span>● {member.name}</span>
            <small>{roleLabel(member.role)}</small>
            {canManage && member.id !== currentUserId && (
              <button
                type="button"
                className="memberRemoveButton"
                disabled={busyUserId !== null}
                aria-label={`Исключить ${member.name} из поиска`}
                onClick={() => void removeMember(member)}
              >
                {busyUserId === member.id ? 'Исключение…' : 'Исключить'}
              </button>
            )}
          </div>
        ))}
        {members.length === 0 && <p className="memberHint">Участники ещё не назначены.</p>}
      </div>
    </div>
  );
};

export default SearchMembers;
