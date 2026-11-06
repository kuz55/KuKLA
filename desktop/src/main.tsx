type Role = "SYSTEM_OWNER"|"SUPERADMIN"|"SUPERUSER"|"ADMIN"|"LEADER"|"COORDINATOR"|"REGIONAL_MANAGER"|"SEARCHER"|"VIEWER";
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MapContainer,TileLayer,Marker,Popup,Polyline,useMap} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {api} from './api.js';
import {clearSessionToken,getSessionToken,setSessionToken} from './sessionToken.js';
import SubjectPanel from './SubjectPanel.js';
import SearchMembers from './SearchMembers.js';
import SectorZones from './SectorZones.js';
import './style.css';

type User={id:string;name:string;email?:string;phone?:string;role:string;active?:boolean};
type Search={id:string;title:string;status:string;area?:string;description?:string;incident_lat?:number;incident_lng?:number;member_count:number;open_tasks:number;gps_points:number};
type Task={id:string;title:string;description?:string;status:string;priority:number;assignee?:string;lat?:number;lng?:number};
type Invitation={id:string;name:string;email:string|null;phone:string|null;role:Role;expires_at:string;accepted_at:string|null;accepted_user_id:string|null;revoked_at:string|null;created_at:string};
type CreatedInvitation=Invitation&{token:string};
const roleLabels:Record<Role,string>={
  SYSTEM_OWNER:'Владелец системы',SUPERADMIN:'Суперадминистратор',SUPERUSER:'Суперпользователь',
  ADMIN:'Администратор',LEADER:'Руководитель поиска',COORDINATOR:'Координатор',
  REGIONAL_MANAGER:'Региональный руководитель',SEARCHER:'Поисковик',VIEWER:'Наблюдатель'
};
const roleLabel=(role:string)=>roleLabels[role as Role]??role;
const allowPublicRegistration=import.meta.env.VITE_ALLOW_PUBLIC_REGISTRATION==='true';
function FixLeaflet(){useEffect(()=>{const icon=L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41]});(L.Marker.prototype.options as any).icon=icon},[]);return null}
function Login({onLogin,initialError}:{onLogin:(u:User)=>void;initialError?:string}){
  const [mode,setMode]=useState<'login'|'invitation'|'register'>('login');
  const [login,setLogin]=useState('');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [invitationToken,setInvitationToken]=useState('');
  const [password,setPassword]=useState('');
  const [passwordConfirm,setPasswordConfirm]=useState('');
  const [error,setError]=useState(initialError??'');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{setError(initialError??'')},[initialError]);

  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setError('');
    if(mode!=='login'&&password!==passwordConfirm){
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try{
      let result:{token:string;user:User};
      if(mode==='login'){
        result=await api<{token:string;user:User}>('/auth/login',{
          method:'POST',
          body:JSON.stringify({login,password})
        });
      }else if(mode==='invitation'){
        result=await api<{token:string;user:User}>('/auth/accept-invitation',{
          method:'POST',
          body:JSON.stringify({token:invitationToken.trim(),password})
        });
      }else{
        await api<User>('/auth/register',{
          method:'POST',
          body:JSON.stringify({name,email,password})
        });
        result=await api<{token:string;user:User}>('/auth/login',{
          method:'POST',
          body:JSON.stringify({login:email,password})
        });
      }
      await setSessionToken(result.token);
      onLogin(result.user);
    }catch(e){
      setError(e instanceof Error ? e.message : 'Ошибка');
    }finally{
      setBusy(false);
    }
  };

  const switchMode=(next:'login'|'invitation'|'register')=>{
    if(next==='register'&&!allowPublicRegistration)return;
    setMode(next);
    setError('');
    setPassword('');
    setPasswordConfirm('');
    if(next==='login')setInvitationToken('');
  };

  return <div className="login">
    <div className="loginCard">
      <div className="brand">KuKLA</div>
      <h1>{mode==='login'?'Центр управления поисками':mode==='invitation'?'Принять приглашение':'Регистрация'}</h1>
      <p>{mode==='login'?'Desktop для руководителей и координаторов':mode==='invitation'?'Введите одноразовый токен, полученный от администратора':'Регистрация доступна только при включении на сервере'}</p>

      <form onSubmit={submit}>
        {mode==='login'
          ?<label>Логин
            <input
              required
              autoComplete="username"
              value={login}
              onChange={e=>setLogin(e.target.value)}
              placeholder="email или телефон"
            />
          </label>
          :mode==='invitation'
            ?<>
              <label>Токен приглашения
                <input
                  required
                  autoComplete="off"
                  value={invitationToken}
                  onChange={e=>setInvitationToken(e.target.value.trim())}
                  placeholder="Вставьте одноразовый токен"
                />
              </label>
              <p className="formHint">Приглашение действительно 24 часа и принимается только один раз.</p>
            </>
            :<>
              <label>Имя
                <input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя"/>
              </label>
              <label>Email
                <input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.org"/>
              </label>
            </>
        }

        <label>Пароль{mode==='login'?'':' (не менее 12 символов)'}
          <input
            required
            type="password"
            autoComplete={mode==='login'?'current-password':'new-password'}
            minLength={mode==='login'?1:12}
            maxLength={128}
            value={password}
            onChange={e=>setPassword(e.target.value)}
            placeholder={mode==='login'?'Введите пароль':'Создайте пароль'}
          />
        </label>

        {mode!=='login'&&<label>Повторите пароль
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={passwordConfirm}
            onChange={e=>setPasswordConfirm(e.target.value)}
            placeholder="Введите пароль ещё раз"
          />
        </label>}

        <button className="primary" type="submit" disabled={busy}>
          {busy?'Подождите…':mode==='login'?'Войти':mode==='invitation'?'Активировать аккаунт':'Зарегистрироваться'}
        </button>
      </form>

      {error&&<div className="error" role="alert">{error}</div>}

      <div className="authLinks">
        {mode==='login'
          ?<>
            <button className="linkButton" type="button" onClick={()=>switchMode('invitation')}>Есть приглашение? Активировать аккаунт</button>
            {allowPublicRegistration&&<button className="linkButton" type="button" onClick={()=>switchMode('register')}>Открытая регистрация</button>}
          </>
          :<button className="linkButton" type="button" onClick={()=>switchMode('login')}>Вернуться ко входу</button>
        }
      </div>
    </div>
  </div>
}

function App(){const [user,setUser]=useState<User|null>(null);const [tab,setTab]=useState<'overview'|'search'|'people'>('overview');const [searches,setSearches]=useState<Search[]>([]);const [selected,setSelected]=useState<Search|null>(null);const [tasks,setTasks]=useState<Task[]>([]);const [members,setMembers]=useState<User[]>([]);const [gps,setGps]=useState<any[]>([]);const [loading,setLoading]=useState(false);const [sessionError,setSessionError]=useState('');
useEffect(()=>{let active=true;const restore=async()=>{try{const token=await getSessionToken();if(!token||!active)return;try{const current=await api<User>('/me');if(active)setUser(current)}catch{try{await clearSessionToken()}catch{}}}catch(error){if(active)setSessionError(error instanceof Error?error.message:'Не удалось открыть системное хранилище учётных данных')}};void restore();return()=>{active=false}},[]);
const reload=async()=>{const s=await api<Search[]>('/searches');setSearches(s);if(selected){const fresh=s.find(x=>x.id===selected.id);if(fresh)setSelected(fresh)}};
const refreshSelectedSearch=async()=>{if(!selected)return;const [s,t,m,g]=await Promise.all([api<Search[]>('/searches'),api<Task[]>(`/searches/${selected.id}/tasks`),api<User[]>(`/searches/${selected.id}/members`),api<any[]>(`/searches/${selected.id}/gps`)]);setSearches(s);const fresh=s.find(x=>x.id===selected.id);if(fresh)setSelected(fresh);setTasks(t);setMembers(m);setGps(g)};
useEffect(()=>{if(user)reload()},[user]);
useEffect(()=>{if(selected){setLoading(true);Promise.all([api<Task[]>(`/searches/${selected.id}/tasks`),api<User[]>(`/searches/${selected.id}/members`),api<any[]>(`/searches/${selected.id}/gps`)]).then(([t,m,g])=>{setTasks(t);setMembers(m);setGps(g)}).finally(()=>setLoading(false))}},[selected?.id]);
if(!user)return <Login onLogin={setUser} initialError={sessionError}/>;
const canManage=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','REGIONAL_MANAGER'].includes(user.role);
const canCreateSearch=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR'].includes(user.role);
return <div className="shell"><aside><div className="logo">KuKLA <small>2.1</small></div><div className="profile"><b>{user.name}</b><span>{roleLabel(user.role)}</span></div><nav><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>⌂ Обзор</button><button className={tab==='search'?'active':''} onClick={()=>setTab('search')} disabled={!selected}>◉ Поиск</button><button className={tab==='people'?'active':''} onClick={()=>setTab('people')}>♙ Люди</button></nav><div className="sideSearch"><b>Поиски</b>{searches.map(s=><button key={s.id} onClick={()=>{setSelected(s);setTab('search')}}><span>{s.status==='ACTIVE'?'🔴':'⚪'} {s.title}</span><small>{s.member_count}</small></button>)}</div><button className="logout" onClick={async()=>{try{await api('/auth/logout',{method:'POST'})}catch{}try{await clearSessionToken();location.reload()}catch{window.alert('Не удалось удалить сессию из системного хранилища.')}}}>Выйти</button></aside><main><header><div><div className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</div><h1>{tab==='overview'?'Оперативная обстановка':tab==='search'?(selected?.title??'Поиск'):'Личный состав'}</h1></div><div className="headerActions"><button onClick={reload}>↻ Обновить</button>{canCreateSearch&&<button className="primary" onClick={async()=>{const title=prompt('Название поиска');if(!title)return;const s=await api<Search>('/searches',{method:'POST',body:JSON.stringify({title,status:'PLANNED'})});setSearches([s,...searches]);setSelected(s);setTab('search')}}>＋ Новый поиск</button>}</div></header>{tab==='overview'&&<Overview searches={searches} onSelect={s=>{setSelected(s);setTab('search')}}/>}{tab==='search'&&selected&&<><SearchView search={selected} tasks={tasks} members={members} gps={gps} canManage={canManage} currentUserId={user.id} onRefresh={refreshSelectedSearch}/>{canManage&&<SubjectPanel searchId={selected.id}/>}</>}{tab==='people'&&<People users={members.length?members:undefined} currentUser={user}/>}</main></div>}
function Overview({searches,onSelect}:{searches:Search[];onSelect:(s:Search)=>void}){const active=searches.filter(s=>s.status==='ACTIVE').length;const tasks=searches.reduce((a,s)=>a+s.open_tasks,0);const people=searches.reduce((a,s)=>a+s.member_count,0);return <><div className="metrics"><Metric label="Активных поисков" value={active}/><Metric label="Открытых задач" value={tasks}/><Metric label="Участников" value={people}/><Metric label="Всего поисков" value={searches.length}/></div><section className="panel"><div className="panelTitle"><h2>Последние поиски</h2><span>{searches.length}</span></div><div className="table">{searches.map(s=><button className="row" key={s.id} onClick={()=>onSelect(s)}><div><b>{s.title}</b><small>{s.area??'Район не указан'}</small></div><span className={'status '+s.status.toLowerCase()}>{s.status}</span><span>{s.member_count} чел.</span><span>{s.open_tasks} задач</span></button>)}</div></section></>}
function Metric({label,value}:{label:string;value:number}){return <div className="metric"><span>{label}</span><b>{value}</b></div>}
function SearchView({search,tasks,members,gps,canManage,currentUserId,onRefresh}:{search:Search;tasks:Task[];members:User[];gps:any[];canManage:boolean;currentUserId:string;onRefresh:()=>void|Promise<void>}){const center:[number,number]=[search.incident_lat??54.99,search.incident_lng??73.32];const track=useMemo(()=>gps.slice().reverse().map(p=>[p.lat,p.lng] as [number,number]),[gps]);return <div className="searchLayout"><div className="leftCol"><section className="panel"><div className="panelTitle"><div><h2>Статус</h2><p>{search.description??'Описание отсутствует'}</p></div>{canManage&&<select value={search.status} onChange={async e=>{await api(`/searches/${search.id}`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});onRefresh()}}><option>PLANNED</option><option>ACTIVE</option><option>PAUSED</option><option>COMPLETED</option><option>CANCELLED</option></select>}</div><div className="metrics compact"><Metric label="Участники" value={search.member_count}/><Metric label="Открытые задачи" value={search.open_tasks}/><Metric label="GPS-точки" value={search.gps_points}/></div></section><section className="panel"><div className="panelTitle"><h2>Задачи</h2>{canManage&&<button className="primary" onClick={async()=>{const title=prompt('Название задачи');if(!title)return;await api(`/searches/${search.id}/tasks`,{method:'POST',body:JSON.stringify({title,priority:2})});onRefresh()}}>＋ Задача</button>}</div>{tasks.map(t=><div className="taskRow" key={t.id}><div><b>{t.title}</b><small>{t.description??'Без описания'} {t.assignee?`· ${t.assignee}`:''}</small></div><select value={t.status} onChange={async e=>{await api(`/tasks/${t.id}`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});onRefresh()}}><option>OPEN</option><option>IN_PROGRESS</option><option>DONE</option><option>CANCELLED</option></select></div>)}</section></div><section className="panel mapPanel"><div className="panelTitle"><h2>Оперативная карта</h2><span>{gps.length} GPS</span></div><div className="map"><FixLeaflet/><MapContainer center={center} zoom={11} scrollWheelZoom><TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Marker position={center}><Popup>Точка происшествия</Popup></Marker>{track.length>1&&<Polyline positions={track}/>}</MapContainer></div><SearchMembers searchId={search.id} members={members} currentUserId={currentUserId} canManage={canManage} onChanged={onRefresh}/><SectorZones searchId={search.id} canManage={canManage} onChanged={onRefresh}/></section></div>}
function invitationRolesFor(actor:Role):Role[]{
  if(actor==='SYSTEM_OWNER')return ['SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','REGIONAL_MANAGER','SEARCHER','VIEWER'];
  if(actor==='SUPERADMIN'||actor==='SUPERUSER')return ['ADMIN','LEADER','COORDINATOR','REGIONAL_MANAGER','SEARCHER','VIEWER'];
  if(actor==='ADMIN')return ['LEADER','COORDINATOR','REGIONAL_MANAGER','SEARCHER','VIEWER'];
  return [];
}

function InvitationManager({currentUser}:{currentUser:User}){
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [revoking,setRevoking]=useState<string|null>(null);
  const [showForm,setShowForm]=useState(false);
  const [name,setName]=useState('');
  const [contactKind,setContactKind]=useState<'email'|'phone'>('email');
  const [contact,setContact]=useState('');
  const [role,setRole]=useState<Role>('SEARCHER');
  const [created,setCreated]=useState<CreatedInvitation|null>(null);
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState('');
  const [listError,setListError]=useState('');
  const roles=invitationRolesFor(currentUser.role as Role);

  const load=async()=>{
    setLoading(true);
    setListError('');
    try{
      setInvitations(await api<Invitation[]>('/users/invitations'));
    }catch(e){
      setListError(e instanceof Error?e.message:'Не удалось загрузить приглашения');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{void load()},[]);

  const create=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setError('');
    setCopied(false);
    setSaving(true);
    const payload={name:name.trim(),[contactKind]:contact.trim(),role};
    try{
      const invite=await api<CreatedInvitation>('/users/invitations',{
        method:'POST',
        body:JSON.stringify(payload)
      });
      setCreated(invite);
      setName('');
      setContact('');
      setShowForm(false);
      await load();
    }catch(e){
      setError(e instanceof Error?e.message:'Не удалось создать приглашение');
    }finally{
      setSaving(false);
    }
  };

  const revoke=async(invite:Invitation)=>{
    if(!window.confirm(`Отозвать приглашение для ${invite.name}?`))return;
    setError('');
    setRevoking(invite.id);
    try{
      await api(`/users/invitations/${invite.id}`,{method:'DELETE'});
      await load();
    }catch(e){
      setError(e instanceof Error?e.message:'Не удалось отозвать приглашение');
    }finally{
      setRevoking(null);
    }
  };

  const copyToken=async()=>{
    if(!created)return;
    try{
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    }catch{
      setError('Не удалось скопировать автоматически. Выделите токен и скопируйте его вручную.');
    }
  };

  return <section className="panel invitationPanel">
    <div className="panelTitle">
      <div><h2>Приглашения</h2><p>Одноразовые токены для подключения новых пользователей</p></div>
      <div className="inviteActions">
        <button type="button" onClick={()=>void load()} disabled={loading}>{loading?'Загрузка…':'↻ Обновить'}</button>
        <button type="button" className="primary" onClick={()=>{setError('');setShowForm(value=>!value)}}>{showForm?'Отмена':'＋ Пригласить'}</button>
      </div>
    </div>

    <div className="inviteWarning">Email и SMS не отправляются. Передайте токен приглашённому по доверенному каналу.</div>

    {error&&<div className="error" role="alert">{error}</div>}

    {created&&<div className="tokenPanel" role="status">
      <div><b>Приглашение создано</b><p>Токен показывается только сейчас. Скопируйте и передайте его лично; после закрытия восстановить токен нельзя.</p></div>
      <div className="tokenRow">
        <input aria-label="Одноразовый токен приглашения" readOnly value={created.token} onFocus={e=>e.currentTarget.select()}/>
        <button type="button" onClick={()=>void copyToken()}>{copied?'Скопировано':'Копировать'}</button>
        <button type="button" onClick={()=>{setCreated(null);setCopied(false)}}>Закрыть</button>
      </div>
      <small>{created.name} · {created.email??created.phone} · {roleLabel(created.role)} · действует до {new Date(created.expires_at).toLocaleString('ru-RU')}</small>
    </div>}

    {showForm&&<form className="inviteForm" onSubmit={create}>
      <label>Имя приглашённого
        <input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Имя и фамилия"/>
      </label>
      <label>Способ связи
        <select value={contactKind} onChange={e=>{setContactKind(e.target.value as 'email'|'phone');setContact('')}}>
          <option value="email">Email</option><option value="phone">Телефон</option>
        </select>
      </label>
      <label>{contactKind==='email'?'Email':'Телефон в формате E.164'}
        <input
          required
          type={contactKind==='email'?'email':'tel'}
          autoComplete="off"
          pattern={contactKind==='phone'?'\+[1-9][0-9]{7,14}':undefined}
          value={contact}
          onChange={e=>setContact(e.target.value)}
          placeholder={contactKind==='email'?'name@example.org':'+358401234567'}
        />
      </label>
      <label>Роль
        <select value={role} onChange={e=>setRole(e.target.value as Role)}>
          {roles.map(value=><option key={value} value={value}>{roleLabel(value)}</option>)}
        </select>
      </label>
      <div className="inviteFormFooter"><small>Токен действует 24 часа и может быть принят один раз.</small><button className="primary" type="submit" disabled={saving}>{saving?'Создание…':'Создать приглашение'}</button></div>
    </form>}

    {listError&&<div className="error" role="alert">{listError}</div>}
    <div className="invitationList">
      {loading&&!invitations.length?<p>Загрузка приглашений…</p>:invitations.length===0?<p className="emptyState">Приглашений пока нет.</p>:invitations.map(invite=>{
        const expired=Date.parse(invite.expires_at)<=Date.now();
        const status=invite.accepted_at?'Принято':invite.revoked_at?'Отозвано':expired?'Истекло':'Ожидает';
        const pending=!invite.accepted_at&&!invite.revoked_at&&!expired;
        return <div className="invitationRow" key={invite.id}>
          <div className="invitePerson"><b>{invite.name}</b><small>{invite.email??invite.phone}</small></div>
          <span className="inviteRole">{roleLabel(invite.role)}</span>
          <span className={`inviteState ${pending?'pending':status==='Принято'?'accepted':''}`}>{status}</span>
          <small className="inviteExpiry">{pending?'до':'создано'} {new Date(pending?invite.expires_at:invite.created_at).toLocaleDateString('ru-RU')}</small>
          {pending&&<button type="button" className="dangerButton" disabled={revoking===invite.id} onClick={()=>void revoke(invite)}>{revoking===invite.id?'Отзыв…':'Отозвать'}</button>}
        </div>;
      })}
    </div>
  </section>;
}

function People({
  users,
  currentUser
}:{
  users?:User[];
  currentUser:User;
}){
  const [data,setData]=useState<User[]>(users??[]);
  const [saving,setSaving]=useState<string|null>(null);
  const [error,setError]=useState('');

  const load=async()=>{
    try{
      const result=await api<User[]>('/users');
      setData(result);
    }catch(e){
      setError(e instanceof Error?e.message:'Ошибка загрузки пользователей');
    }
  };

  useEffect(()=>{
    load();
  },[]);

  const canSuperuser=currentUser.role==='SUPERUSER';
  const canAdministerUsers=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN'].includes(currentUser.role);

  const roles:Role[]=[
    'ADMIN',
    'LEADER',
    'COORDINATOR',
    'REGIONAL_MANAGER',
    'SEARCHER',
    'VIEWER'
  ];

  if(canSuperuser){
    roles.unshift('SUPERUSER');
  }

  const canManageInvitations=invitationRolesFor(currentUser.role as Role).length>0;

  const updateUser=async(
    userId:string,
    patch:Partial<Pick<User,'role'|'active'|'name'|'phone'>>
  )=>{
    setSaving(userId);
    setError('');

    try{
      const updated=await api<User>(`/users/${userId}`,{
        method:'PATCH',
        body:JSON.stringify(patch)
      });

      setData(prev=>
        prev.map(u=>u.id===updated.id?updated:u)
      );
    }catch(e){
      setError(
        e instanceof Error
          ?e.message
          :'Не удалось изменить пользователя'
      );
    }finally{
      setSaving(null);
    }
  };

  return (
    <>
    <section className="panel">
      <div className="panelTitle">
        <h2>Личный состав</h2>
        <span>{data.length}</span>
      </div>

      {error&&<div className="error">{error}</div>}

      <div className="peopleTable">
        {data.map(u=>{
          const isSelf=u.id===currentUser.id;
          const isSuperuser=u.role==='SUPERUSER';

          return (
            <div className="personRow" key={u.id}>
              <div className="personInfo">
                <div className="avatar">
                  {u.name.slice(0,1)}
                </div>

                <div>
                  <b>
                    {u.name}
                    {isSelf&&<small> • Вы</small>}
                  </b>

                  <small>
                    {u.email??u.phone??''}
                  </small>
                </div>
              </div>

              <div className="personRole">
                <select
                  value={u.role}
                  disabled={
                    saving===u.id ||
                    !canAdministerUsers ||
                    (isSuperuser&&!canSuperuser) ||
                    isSelf
                  }
                  onChange={e=>
                    updateUser(
                      u.id,
                      {role:e.target.value as Role}
                    )
                  }
                >
                  {roles.map(role=>(
                    <option
                      key={role}
                      value={role}
                      disabled={
                        role==='SUPERUSER'&&!canSuperuser
                      }
                    >
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="personStatus">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={u.active!==false}
                    disabled={
                      saving===u.id ||
                      !canAdministerUsers ||
                      isSelf ||
                      (isSuperuser&&!canSuperuser)
                    }
                    onChange={e=>
                      updateUser(
                        u.id,
                        {active:e.target.checked}
                      )
                    }
                  />
                  <span></span>
                </label>

                <small>
                  {u.active!==false?'Активен':'Отключён'}
                </small>
              </div>

              {saving===u.id&&
                <div className="saving">
                  Сохранение…
                </div>
              }
            </div>
          );
        })}
      </div>
    </section>
    {canManageInvitations&&<InvitationManager currentUser={currentUser}/>}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App/>);
