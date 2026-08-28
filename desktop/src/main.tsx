type Role = "SYSTEM_OWNER"|"SUPERADMIN"|"SUPERUSER"|"ADMIN"|"LEADER"|"COORDINATOR"|"SEARCHER"|"VIEWER";
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MapContainer,TileLayer,Marker,Popup,Polyline,useMap} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

type User={id:string;name:string;email?:string;phone?:string;role:string;active?:boolean};
type Search={id:string;title:string;status:string;area?:string;description?:string;incident_lat?:number;incident_lng?:number;member_count:number;open_tasks:number;gps_points:number};
type Task={id:string;title:string;description?:string;status:string;priority:number;assignee?:string;lat?:number;lng?:number};
const API=import.meta.env.VITE_API_URL??'http://localhost:8080/api/v1';
async function api<T>(path:string,opts:RequestInit={}){const token=localStorage.getItem('kukla_token');const r=await fetch(API+path,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});if(!r.ok)throw new Error((await r.json().catch(()=>({message:r.statusText}))).message);return r.json() as Promise<T>}
function FixLeaflet(){useEffect(()=>{const icon=L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41]});(L.Marker.prototype.options as any).icon=icon},[]);return null}
function Login({onLogin}:{onLogin:(u:User)=>void}){
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [login,setLogin]=useState('');
  const [password,setPassword]=useState('');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  const submit=async()=>{
    setError('');
    setBusy(true);
    try{
      if(mode==='login'){
        const x=await api<{token:string;user:User}>('/auth/login',{
          method:'POST',
          body:JSON.stringify({login,password})
        });
        localStorage.setItem('kukla_token',x.token);
        onLogin(x.user);
      }else{
        const x=await api<User>('/auth/register',{
          method:'POST',
          body:JSON.stringify({name,email,password})
        });
        const y=await api<{token:string;user:User}>('/auth/login',{
          method:'POST',
          body:JSON.stringify({login:email,password})
        });
        localStorage.setItem('kukla_token',y.token);
        onLogin(y.user);
      }
    }catch(e){
      setError(e instanceof Error ? e.message : 'Ошибка');
    }finally{
      setBusy(false);
    }
  };

  return <div className="login">
    <div className="loginCard">
      <div className="brand">KuKLA</div>
      <h1>Центр управления поисками</h1>
      <p>Desktop для руководителей и координаторов</p>

      {mode==='register'&&
        <label>Имя
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя"/>
        </label>
      }

      <label>{mode==='login'?'Логин':'Email'}
        <input
          value={mode==='login'?login:email}
          onChange={e=>mode==='login'?setLogin(e.target.value):setEmail(e.target.value)}
          placeholder={mode==='login'?'email или телефон':'email@example.com'}
        />
      </label>

      <label>Пароль
        <input
          type="password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          placeholder="Введите пароль"
        />
      </label>

      <button className="primary" onClick={submit} disabled={busy}>
        {busy?'Подождите…':mode==='login'?'Войти':'Зарегистрироваться'}
      </button>

      {error&&<div className="error">{error}</div>}

      <button
        className="linkButton"
        onClick={()=>{
          setMode(mode==='login'?'register':'login');
          setError('');
        }}
      >
        {mode==='login'?'Регистрация':'Уже есть аккаунт? Войти'}
      </button>
    </div>
  </div>
}

function App(){const [user,setUser]=useState<User|null>(null);const [tab,setTab]=useState<'overview'|'search'|'people'>('overview');const [searches,setSearches]=useState<Search[]>([]);const [selected,setSelected]=useState<Search|null>(null);const [tasks,setTasks]=useState<Task[]>([]);const [members,setMembers]=useState<User[]>([]);const [gps,setGps]=useState<any[]>([]);const [loading,setLoading]=useState(false);
useEffect(()=>{if(localStorage.getItem('kukla_token'))api<User>('/me').then(setUser).catch(()=>localStorage.removeItem('kukla_token'))},[]);
const reload=async()=>{const s=await api<Search[]>('/searches');setSearches(s);if(selected){const fresh=s.find(x=>x.id===selected.id);if(fresh)setSelected(fresh)}};
useEffect(()=>{if(user)reload()},[user]);
useEffect(()=>{if(selected){setLoading(true);Promise.all([api<Task[]>(`/searches/${selected.id}/tasks`),api<User[]>(`/searches/${selected.id}/members`),api<any[]>(`/searches/${selected.id}/gps`)]).then(([t,m,g])=>{setTasks(t);setMembers(m);setGps(g)}).finally(()=>setLoading(false))}},[selected?.id]);
if(!user)return <Login onLogin={setUser}/>;
const canManage=['ADMIN','LEADER','COORDINATOR'].includes(user.role);
return <div className="shell"><aside><div className="logo">KuKLA <small>2.1</small></div><div className="profile"><b>{user.name}</b><span>{user.role}</span></div><nav><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>⌂ Обзор</button><button className={tab==='search'?'active':''} onClick={()=>setTab('search')} disabled={!selected}>◉ Поиск</button><button className={tab==='people'?'active':''} onClick={()=>setTab('people')}>♙ Люди</button></nav><div className="sideSearch"><b>Поиски</b>{searches.map(s=><button key={s.id} onClick={()=>{setSelected(s);setTab('search')}}><span>{s.status==='ACTIVE'?'🔴':'⚪'} {s.title}</span><small>{s.member_count}</small></button>)}</div><button className="logout" onClick={()=>{localStorage.removeItem('kukla_token');location.reload()}}>Выйти</button></aside><main><header><div><div className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</div><h1>{tab==='overview'?'Оперативная обстановка':tab==='search'?(selected?.title??'Поиск'):'Личный состав'}</h1></div><div className="headerActions"><button onClick={reload}>↻ Обновить</button>{canManage&&<button className="primary" onClick={async()=>{const title=prompt('Название поиска');if(!title)return;const s=await api<Search>('/searches',{method:'POST',body:JSON.stringify({title,status:'PLANNED'})});setSearches([s,...searches]);setSelected(s);setTab('search')}}>＋ Новый поиск</button>}</div></header>{tab==='overview'&&<Overview searches={searches} onSelect={s=>{setSelected(s);setTab('search')}}/>}{tab==='search'&&selected&&<SearchView search={selected} tasks={tasks} members={members} gps={gps} canManage={canManage} onRefresh={()=>{reload();}}/>}{tab==='people'&&<People users={members.length?members:undefined} currentUser={user}/>}</main></div>}
function Overview({searches,onSelect}:{searches:Search[];onSelect:(s:Search)=>void}){const active=searches.filter(s=>s.status==='ACTIVE').length;const tasks=searches.reduce((a,s)=>a+s.open_tasks,0);const people=searches.reduce((a,s)=>a+s.member_count,0);return <><div className="metrics"><Metric label="Активных поисков" value={active}/><Metric label="Открытых задач" value={tasks}/><Metric label="Участников" value={people}/><Metric label="Всего поисков" value={searches.length}/></div><section className="panel"><div className="panelTitle"><h2>Последние поиски</h2><span>{searches.length}</span></div><div className="table">{searches.map(s=><button className="row" key={s.id} onClick={()=>onSelect(s)}><div><b>{s.title}</b><small>{s.area??'Район не указан'}</small></div><span className={'status '+s.status.toLowerCase()}>{s.status}</span><span>{s.member_count} чел.</span><span>{s.open_tasks} задач</span></button>)}</div></section></>}
function Metric({label,value}:{label:string;value:number}){return <div className="metric"><span>{label}</span><b>{value}</b></div>}
function SearchView({search,tasks,members,gps,canManage,onRefresh}:{search:Search;tasks:Task[];members:User[];gps:any[];canManage:boolean;onRefresh:()=>void}){const center:[number,number]=[search.incident_lat??54.99,search.incident_lng??73.32];const track=useMemo(()=>gps.slice().reverse().map(p=>[p.lat,p.lng] as [number,number]),[gps]);return <div className="searchLayout"><div className="leftCol"><section className="panel"><div className="panelTitle"><div><h2>Статус</h2><p>{search.description??'Описание отсутствует'}</p></div>{canManage&&<select value={search.status} onChange={async e=>{await api(`/searches/${search.id}`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});onRefresh()}}><option>PLANNED</option><option>ACTIVE</option><option>PAUSED</option><option>COMPLETED</option><option>CANCELLED</option></select>}</div><div className="metrics compact"><Metric label="Участники" value={search.member_count}/><Metric label="Открытые задачи" value={search.open_tasks}/><Metric label="GPS-точки" value={search.gps_points}/></div></section><section className="panel"><div className="panelTitle"><h2>Задачи</h2>{canManage&&<button className="primary" onClick={async()=>{const title=prompt('Название задачи');if(!title)return;await api(`/searches/${search.id}/tasks`,{method:'POST',body:JSON.stringify({title,priority:2})});onRefresh()}}>＋ Задача</button>}</div>{tasks.map(t=><div className="taskRow" key={t.id}><div><b>{t.title}</b><small>{t.description??'Без описания'} {t.assignee?`· ${t.assignee}`:''}</small></div><select value={t.status} onChange={async e=>{await api(`/tasks/${t.id}`,{method:'PATCH',body:JSON.stringify({status:e.target.value})});onRefresh()}}><option>OPEN</option><option>IN_PROGRESS</option><option>DONE</option><option>CANCELLED</option></select></div>)}</section></div><section className="panel mapPanel"><div className="panelTitle"><h2>Оперативная карта</h2><span>{gps.length} GPS</span></div><div className="map"><FixLeaflet/><MapContainer center={center} zoom={11} scrollWheelZoom><TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Marker position={center}><Popup>Точка происшествия</Popup></Marker>{track.length>1&&<Polyline positions={track}/>}</MapContainer></div><div className="memberList"><b>Участники ({members.length})</b>{members.slice(0,8).map(m=><span key={m.id}>● {m.name}</span>)}</div></section></div>}
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

  const roles:Role[]=[
    'ADMIN',
    'LEADER',
    'COORDINATOR',
    'SEARCHER',
    'VIEWER'
  ];

  if(canSuperuser){
    roles.unshift('SUPERUSER');
  }

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
                    (isSuperuser&&!canSuperuser) ||
                    (isSelf&&u.role==='SUPERUSER')
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
                      {role}
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
  );
}
createRoot(document.getElementById('root')!).render(<App/>);
