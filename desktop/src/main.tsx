type Role = "SYSTEM_OWNER"|"SUPERADMIN"|"SUPERUSER"|"ADMIN"|"LEADER"|"COORDINATOR"|"SEARCHER"|"VIEWER";
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MapContainer,TileLayer,Marker,Popup,Polyline,useMap} from 'react-leaflet';
import L from 'leaflet';
import { openUrl } from '@tauri-apps/plugin-opener';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './profile.css';

type User={id:string;name:string;email?:string;phone?:string;role:string;active?:boolean;has_profile?:boolean;profile_verified?:boolean;profile_updated_at?:string};
type Profile={fullName:string;birthDate:string;city:string;district:string;extraPhone:string;medicalNotes:string;skills:string;hasTransport:boolean;availableForSearches:boolean;emergencyContactName:string;emergencyContactPhone:string;consentPersonalData:boolean;verified:boolean};
type Search={id:string;title:string;status:string;area?:string;description?:string;incident_lat?:number;incident_lng?:number;member_count:number;open_tasks:number;gps_points:number};
type Task={id:string;title:string;description?:string;status:string;priority:number;assignee?:string;lat?:number;lng?:number};
const API=import.meta.env.VITE_API_URL??'http://localhost:8080/api/v1';
const PUBLIC_AUTH_API=import.meta.env.VITE_PUBLIC_AUTH_URL??API;
async function apiAt<T>(base:string,path:string,opts:RequestInit={}){const token=localStorage.getItem('kukla_token');const r=await fetch(base+path,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});if(!r.ok)throw new Error((await r.json().catch(()=>({message:r.statusText}))).message);return r.json() as Promise<T>}
const api=<T,>(path:string,opts:RequestInit={})=>apiAt<T>(API,path,opts);
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function openAuthorization(url:string){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='id.vk.ru')throw new Error('Сервер вернул недоверенную ссылку авторизации');if('__TAURI_INTERNALS__' in window)await openUrl(parsed.toString());else{const popup=window.open(parsed.toString(),'_blank');if(!popup)throw new Error('Разрешите открытие окна авторизации VK ID')}}
function FixLeaflet(){useEffect(()=>{const icon=L.icon({iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41]});(L.Marker.prototype.options as any).icon=icon},[]);return null}
function Login({onLogin}:{onLogin:(u:User)=>void}){
  const [phone,setPhone]=useState('');
  const [code,setCode]=useState('');
  const [name,setName]=useState('');
  const [requested,setRequested]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [vkBusy,setVkBusy]=useState(false);

  const loginWithVk=async()=>{
    setError('');setVkBusy(true);
    try{
      const flow=await apiAt<{requestId:string;pollSecret:string;authorizationUrl:string}>(PUBLIC_AUTH_API,'/auth/vk/start',{method:'POST'});
      await openAuthorization(flow.authorizationUrl);
      for(let attempt=0;attempt<300;attempt++){
        await wait(2000);
        const result=await apiAt<{status:'pending'|'failed'|'complete';token?:string;user?:User}>(PUBLIC_AUTH_API,'/auth/vk/poll',{method:'POST',body:JSON.stringify({requestId:flow.requestId,pollSecret:flow.pollSecret})});
        if(result.status==='failed')throw new Error('VK ID не завершил вход. Попробуйте ещё раз.');
        if(result.status==='complete'&&result.token&&result.user){localStorage.setItem('kukla_token',result.token);onLogin(result.user);return;}
      }
      throw new Error('Время ожидания входа истекло. Запустите вход заново.');
    }catch(e){setError(e instanceof Error?e.message:'Не удалось войти через VK ID');}
    finally{setVkBusy(false);}
  };

  const submit=async()=>{
    setError('');
    setBusy(true);
    try{
      if(!requested){
        await api('/auth/request-otp',{
          method:'POST',
          body:JSON.stringify({phone,name})
        });
        setRequested(true);
      }else{
        const x=await api<{token:string;user:User}>('/auth/verify-otp',{
          method:'POST',
          body:JSON.stringify({phone,code,name})
        });
        localStorage.setItem('kukla_token',x.token);
        onLogin(x.user);
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
      <p>Вход по номеру телефона без пароля</p>

      <label>Имя
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя"/>
      </label>

      <label>Номер телефона
        <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+79991234567" disabled={requested}/>
      </label>

      {requested&&<label>Одноразовый код
        <input value={code} onChange={e=>setCode(e.target.value)} placeholder="6 цифр" inputMode="numeric" maxLength={6}/>
      </label>}

      <button className="primary" onClick={submit} disabled={busy}>
      {busy?'Подождите…':requested?'Войти по коду':'Получить код'}
      </button>

      <button className="secondary" onClick={loginWithVk} disabled={busy||vkBusy}>
        {vkBusy?'Ожидаем подтверждение VK ID…':'Войти через VK ID'}
      </button>

      {requested&&<small>Если SMS не пришла, проверьте номер и повторите запрос позже.</small>}
      {error&&<div className="error">{error}</div>}
    </div>
  </div>
}

function App(){const [user,setUser]=useState<User|null>(null);const [tab,setTab]=useState<'overview'|'search'|'people'|'profile'>('overview');const [searches,setSearches]=useState<Search[]>([]);const [selected,setSelected]=useState<Search|null>(null);const [tasks,setTasks]=useState<Task[]>([]);const [members,setMembers]=useState<User[]>([]);const [gps,setGps]=useState<any[]>([]);const [loading,setLoading]=useState(false);
useEffect(()=>{if(localStorage.getItem('kukla_token'))api<User>('/me').then(setUser).catch(()=>localStorage.removeItem('kukla_token'))},[]);
const reload=async()=>{const s=await api<Search[]>('/searches');setSearches(s);if(selected){const fresh=s.find(x=>x.id===selected.id);if(fresh)setSelected(fresh)}};
useEffect(()=>{if(user)reload()},[user]);
useEffect(()=>{if(selected){setLoading(true);Promise.all([api<Task[]>(`/searches/${selected.id}/tasks`),api<User[]>(`/searches/${selected.id}/members`),api<any[]>(`/searches/${selected.id}/gps`)]).then(([t,m,g])=>{setTasks(t);setMembers(m);setGps(g)}).finally(()=>setLoading(false))}},[selected?.id]);
if(!user)return <Login onLogin={setUser}/>;
const canManage=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR'].includes(user.role);
return <div className="shell"><aside><div className="logo">KuKLA <small>2.1</small></div><div className="profile"><b>{user.name}</b><span>{user.role}</span></div><nav><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>⌂ Обзор</button><button className={tab==='search'?'active':''} onClick={()=>setTab('search')} disabled={!selected}>◉ Поиск</button><button className={tab==='people'?'active':''} onClick={()=>setTab('people')}>♙ Люди</button><button className={tab==='profile'?'active':''} onClick={()=>setTab('profile')}>◉ Моя анкета</button></nav><div className="sideSearch"><b>Поиски</b>{searches.map(s=><button key={s.id} onClick={()=>{setSelected(s);setTab('search')}}><span>{s.status==='ACTIVE'?'🔴':'⚪'} {s.title}</span><small>{s.member_count}</small></button>)}</div><button className="logout" onClick={()=>{localStorage.removeItem('kukla_token');location.reload()}}>Выйти</button></aside><main><header><div><div className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</div><h1>{tab==='overview'?'Оперативная обстановка':tab==='search'?(selected?.title??'Поиск'):tab==='profile'?'Моя анкета':'Личный состав'}</h1></div><div className="headerActions"><button onClick={reload}>↻ Обновить</button>{canManage&&<button className="primary" onClick={async()=>{const title=prompt('Название поиска');if(!title)return;const s=await api<Search>('/searches',{method:'POST',body:JSON.stringify({title,status:'PLANNED'})});setSearches([s,...searches]);setSelected(s);setTab('search')}}>＋ Новый поиск</button>}</div></header>{tab==='overview'&&<Overview searches={searches} onSelect={s=>{setSelected(s);setTab('search')}}/>}{tab==='search'&&selected&&<SearchView search={selected} tasks={tasks} members={members} gps={gps} canManage={canManage} onRefresh={()=>{reload();}}/>}{tab==='people'&&<People users={members.length?members:undefined} currentUser={user}/ >}{tab==='profile'&&<ProfileForm user={user}/>}</main></div>}
function ProfileForm({user}:{user:User}){
  const [profile,setProfile]=useState<Profile>({fullName:user.name,birthDate:'',city:'',district:'',extraPhone:'',medicalNotes:'',skills:'',hasTransport:false,availableForSearches:true,emergencyContactName:'',emergencyContactPhone:'',consentPersonalData:false,verified:false});
  const [busy,setBusy]=useState(false);const [linking,setLinking]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  useEffect(()=>{api<any>('/me/profile').then(p=>{if(p)setProfile({...profile,...p,birthDate:p.birthDate?.slice(0,10)??'',skills:Array.isArray(p.skills)?p.skills.join(', '):''})}).catch(e=>setError(e instanceof Error?e.message:'Не удалось загрузить анкету'))},[]);
  const field=(key:keyof Profile,value:any)=>setProfile(p=>({...p,[key]:value}));
  const linkVk=async()=>{setLinking(true);setError('');setMessage('');try{const flow=await apiAt<{requestId:string;pollSecret:string;authorizationUrl:string}>(PUBLIC_AUTH_API,'/auth/vk/link/start',{method:'POST'});await openAuthorization(flow.authorizationUrl);for(let attempt=0;attempt<300;attempt++){await wait(2000);const result=await apiAt<{status:'pending'|'failed'|'complete';token?:string}> (PUBLIC_AUTH_API,'/auth/vk/poll',{method:'POST',body:JSON.stringify({requestId:flow.requestId,pollSecret:flow.pollSecret})});if(result.status==='failed')throw new Error('Не удалось привязать VK ID. Попробуйте ещё раз.');if(result.status==='complete'&&result.token){localStorage.setItem('kukla_token',result.token);setMessage('VK ID привязан к вашей учётной записи.');return;}}throw new Error('Время ожидания истекло. Запустите привязку заново.');}catch(e){setError(e instanceof Error?e.message:'Не удалось привязать VK ID')}finally{setLinking(false)}};
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{const saved=await api<any>('/me/profile',{method:'PUT',body:JSON.stringify({...profile,skills:profile.skills.split(',').map(s=>s.trim()).filter(Boolean)})});setProfile({...profile,...saved,birthDate:saved.birthDate?.slice(0,10)??'',skills:Array.isArray(saved.skills)?saved.skills.join(', '):''});setMessage('Анкета сохранена. Ожидает проверки администратора.')}catch(err){setError(err instanceof Error?err.message:'Не удалось сохранить анкету')}finally{setBusy(false)}};
  return <form className="panel profileForm" onSubmit={submit}><div className="panelTitle"><div><h2>Анкета участника</h2><p>{profile.verified?'Анкета подтверждена':'Заполните данные для участия в поисках'}</p></div><span className={'status '+(profile.verified?'completed':'')}>{profile.verified?'Подтверждена':'На проверке'}</span></div><div className="formGrid">
    <label>ФИО<input required value={profile.fullName} onChange={e=>field('fullName',e.target.value)}/></label>
    <label>Дата рождения<input type="date" value={profile.birthDate} onChange={e=>field('birthDate',e.target.value)}/></label>
    <label>Город<input value={profile.city} onChange={e=>field('city',e.target.value)}/></label>
    <label>Район<input value={profile.district} onChange={e=>field('district',e.target.value)}/></label>
    <label>Дополнительный телефон<input value={profile.extraPhone} onChange={e=>field('extraPhone',e.target.value)}/></label>
    <label>Навыки и квалификация<input placeholder="Первая помощь, кинолог…" value={profile.skills} onChange={e=>field('skills',e.target.value)}/></label>
    <label>Контактное лицо при ЧС<input value={profile.emergencyContactName} onChange={e=>field('emergencyContactName',e.target.value)}/></label>
    <label>Телефон контактного лица<input value={profile.emergencyContactPhone} onChange={e=>field('emergencyContactPhone',e.target.value)}/></label>
    <label className="wide">Медицинские ограничения или важные сведения<textarea rows={3} value={profile.medicalNotes} onChange={e=>field('medicalNotes',e.target.value)}/></label>
    <label className="checkField"><input type="checkbox" checked={profile.hasTransport} onChange={e=>field('hasTransport',e.target.checked)}/> Есть личный транспорт</label>
    <label className="checkField"><input type="checkbox" checked={profile.availableForSearches} onChange={e=>field('availableForSearches',e.target.checked)}/> Готов(а) участвовать в поисках</label>
    <label className="checkField wide"><input type="checkbox" required checked={profile.consentPersonalData} onChange={e=>field('consentPersonalData',e.target.checked)}/> Согласен(на) на обработку персональных данных для организации поисковых мероприятий</label>
  </div>{error&&<div className="error">{error}</div>}{message&&<div className="success">{message}</div>}<button className="primary" disabled={busy}>{busy?'Сохранение…':'Сохранить анкету'}</button><button type="button" className="secondary" disabled={linking} onClick={linkVk}>{linking?'Ожидаем подтверждение VK ID…':'Привязать VK ID к учётной записи'}</button></form>
}

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
  const [profiles,setProfiles]=useState<Record<string,any>>({});

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
  const canReview=['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN'].includes(currentUser.role);
  const canAdminister=canReview;

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

  const reviewProfile=async(u:User)=>{setSaving(u.id);setError('');try{await api(`/users/${u.id}/profile/review`,{method:'PATCH',body:JSON.stringify({verified:!u.profile_verified})});setData(prev=>prev.map(x=>x.id===u.id?{...x,profile_verified:!u.profile_verified}:x))}catch(e){setError(e instanceof Error?e.message:'Не удалось обновить статус анкеты')}finally{setSaving(null)}};
  const toggleProfile=async(u:User)=>{if(profiles[u.id]){setProfiles(prev=>{const next={...prev};delete next[u.id];return next});return}setSaving(u.id);setError('');try{const profile=await api<any>(`/users/${u.id}/profile`);setProfiles(prev=>({...prev,[u.id]:profile??{}}))}catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить анкету')}finally{setSaving(null)}};

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
                {canAdminister?
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
                :<span>{u.role}</span>}
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

              {canReview&&<div className="profileReview"><small>{u.has_profile?(u.profile_verified?'Анкета подтверждена':'Анкета на проверке'):'Анкета не заполнена'}</small>{u.has_profile&&<><button disabled={saving===u.id} onClick={()=>toggleProfile(u)}>{profiles[u.id]?'Скрыть анкету':'Открыть анкету'}</button><button disabled={saving===u.id} onClick={()=>reviewProfile(u)}>{u.profile_verified?'Снять подтверждение':'Подтвердить'}</button></>}</div>}
              {profiles[u.id]&&<div className="profileDetails"><span>ФИО: {profiles[u.id].fullName||u.name}</span><span>Дата рождения: {profiles[u.id].birthDate||'—'}</span><span>Город / район: {[profiles[u.id].city,profiles[u.id].district].filter(Boolean).join(' / ')||'—'}</span><span>Навыки: {profiles[u.id].skills?.join(', ')||'—'}</span><span>Транспорт: {profiles[u.id].hasTransport?'есть':'нет'}</span><span>Готовность: {profiles[u.id].availableForSearches?'участвует':'не участвует'}</span><span>Экстренный контакт: {[profiles[u.id].emergencyContactName,profiles[u.id].emergencyContactPhone].filter(Boolean).join(', ')||'—'}</span><span>Медицинские сведения: {profiles[u.id].medicalNotes||'не указаны'}</span></div>}

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
