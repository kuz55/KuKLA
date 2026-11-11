import { ApiError } from './api.mjs';

// Training-only UI. A request and its UUID stay in memory until confirmed.
// These receipts are not an offline queue and never establish current state.
export function setupGroups({api,run,uuid,message}) {
  const $=id=>document.getElementById(id);
  const forms=['group-create','task-create'];
  let groupAttempt=null, taskAttempt=null, groupCursor=null, taskCursor=null, taskContext=null;
  const acceptanceKeys=new Map();
  const lock=(form,value)=>{ for (const element of form.elements) if(element.name) element.disabled=value; };
  const definitive=error=>error instanceof ApiError && error.status>=400 && error.status<500 && error.status!==429;
  const retryMessage='Ответ не подтверждён. Повторите в этой вкладке с теми же данными; после выхода ключ будет потерян.';
  function reset() {
    groupAttempt=taskAttempt=groupCursor=taskCursor=taskContext=null; acceptanceKeys.clear();
    for (const id of forms) { $(id).reset(); lock($(id),false); $(id).querySelector('button').disabled=false; }
    for (const id of ['group-new','task-new','group-inbox-more','task-more']) $(id).hidden=true;
    for (const id of ['group-create-result','task-create-result','group-inbox-list','task-list']) $(id).replaceChildren();
    $('task-list-form').reset();
  }
  const pending=()=>Boolean(groupAttempt?.uncertain || taskAttempt?.uncertain);
  function attemptForm({id,getAttempt,setAttempt,make,output,newButton,success}) {
    $(id).addEventListener('submit',event=>{ event.preventDefault(); const form=event.currentTarget;
      run(async()=>{
        let attempt=getAttempt();
        if (!attempt) { attempt=make(new FormData(form)); setAttempt(attempt); lock(form,true); }
        try {
          const result=await api.call(attempt.path,{method:'POST',body:attempt.body});
          attempt.uncertain=false; form.querySelector('button').disabled=true; $(newButton).hidden=false;
          $(output).textContent=success(result); message('Сервер подтвердил запрос. Квитанция не заменяет проверку текущего состояния.');
        } catch(error) {
          if (!attempt.uncertain && definitive(error)) { setAttempt(null); lock(form,false); }
          else { attempt.uncertain=true; $(output).textContent=retryMessage; }
          throw error;
        }
      });
    });
    $(newButton).addEventListener('click',()=>{
      if ($(newButton).hidden) return;
      const form=$(id); setAttempt(null); form.reset(); lock(form,false); form.querySelector('button').disabled=false;
      $(output).textContent=''; $(newButton).hidden=true;
    });
  }
  attemptForm({id:'group-create',getAttempt:()=>groupAttempt,setAttempt:v=>{groupAttempt=v;},output:'group-create-result',newButton:'group-new',
    make:form=>{const search=uuid(form.get('searchId')),candidate=uuid(form.get('candidateId')),title=String(form.get('title')??'').trim();
      if (title.length<2 || title.length>200) throw new ApiError(400);
      return {path:`/api/v1/field-groups/searches/${search}/groups`,body:{requestId:crypto.randomUUID(),title,candidateId:candidate},uncertain:false};},
    success:r=>`Группа ${r.groupId}. Приглашение ${r.proposalId}; ожидается принятие.`});
  attemptForm({id:'task-create',getAttempt:()=>taskAttempt,setAttempt:v=>{taskAttempt=v;},output:'task-create-result',newButton:'task-new',
    make:form=>{const search=uuid(form.get('searchId')),group=uuid(form.get('groupId')),description=String(form.get('description')??'').trim(),
      due=new Date(String(form.get('dueAt')??'')),priority=String(form.get('priority'));
      if (!description || description.length>4000 || !Number.isFinite(due.getTime()) || !['NORMAL','HIGH','URGENT'].includes(priority)) throw new ApiError(400);
      return {path:`/api/v1/field-tasks/searches/${search}/groups/${group}/tasks`,body:{requestId:crypto.randomUUID(),description,dueAt:due.toISOString(),priority},uncertain:false};},
    success:r=>`Задача ${r.taskId} назначена. Проверьте её текущий статус в списке.`});
  async function inbox(after) {
    const page=await api.call(`/api/v1/field-groups/notifications?limit=50${after?`&after=${encodeURIComponent(after)}`:''}`);
    if(!after) $('group-inbox-list').replaceChildren();
    for(const item of page.items.filter(x=>x.kind==='LEAD_PROPOSED')) {
      const search=uuid(item.search_id), group=uuid(item.group_id), proposal=uuid(item.proposal_id);
      const li=document.createElement('li'), label=document.createElement('span'), accept=document.createElement('button');
      label.textContent=`Поиск ${search}; группа ${group}; приглашение ${proposal}. `;
      accept.type='button'; accept.textContent='Принять руководство группой';
      accept.addEventListener('click',()=>run(async()=>{
        await api.call(`/api/v1/field-groups/searches/${search}/groups/${group}/lead-response`,{method:'POST',body:{proposalId:proposal,accept:true}});
        accept.disabled=true; message('Принятие подтверждено. Повтор возвращает квитанцию, а не текущий статус группы.');
      }));
      li.append(label,accept); $('group-inbox-list').append(li);
    }
    groupCursor=page.nextCursor; $('group-inbox-more').hidden=!groupCursor;
    message('Учебные приглашения обновлены; это не гарантированная доставка.');
  }
  $('group-inbox').addEventListener('click',()=>run(()=>inbox(null)));
  $('group-inbox-more').addEventListener('click',()=>run(()=>inbox(groupCursor)));
  async function taskList(search,group,after) {
    const page=await api.call(`/api/v1/field-tasks/searches/${search}/groups/${group}/tasks?limit=50${after?`&after=${encodeURIComponent(after)}`:''}`);
    if(!after) $('task-list').replaceChildren();
    const priority={NORMAL:'Обычный',HIGH:'Высокий',URGENT:'⚠ Срочный'};
    for(const item of page.items) {
      const id=uuid(item.id),li=document.createElement('li'),text=document.createElement('p');
      text.textContent=`${item.description} — ${priority[item.priority] ?? 'Неизвестный приоритет'}; срок ${new Date(item.due_at).toLocaleString('ru-RU')}; статус ${item.status}${item.overdue?' — ПРОСРОЧЕНО':''}. ID ${id}`;
      li.append(text);
      if(item.status==='ASSIGNED') {
        const accept=document.createElement('button'); accept.type='button'; accept.textContent='Принять задачу (старший группы)';
        accept.addEventListener('click',()=>run(async()=>{
          if(!acceptanceKeys.has(id)) acceptanceKeys.set(id,crypto.randomUUID());
          await api.call(`/api/v1/field-tasks/searches/${search}/tasks/${id}/accept`,{method:'POST',body:{requestId:acceptanceKeys.get(id)}});
          accept.disabled=true; message('Приём задачи подтверждён. Обновите список для текущего статуса.');
        })); li.append(accept);
      }
      $('task-list').append(li);
    }
    taskContext={search,group}; taskCursor=page.nextCursor; $('task-more').hidden=!taskCursor;
    message('Список задач обновлён.');
  }
  $('task-list-form').addEventListener('submit',event=>{event.preventDefault(); const form=event.currentTarget;
    run(()=>{const data=new FormData(form); return taskList(uuid(data.get('searchId')),uuid(data.get('groupId')),null);});
  });
  $('task-more').addEventListener('click',()=>run(()=>taskList(taskContext.search,taskContext.group,taskCursor)));
  return {reset,pending};
}
