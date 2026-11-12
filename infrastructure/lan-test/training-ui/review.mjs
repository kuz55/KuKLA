import { ApiError } from './api.mjs';

// This UI holds retries only in memory; receipts are not current state.
export function setupReview({api,run,uuid,message}) {
  const $=id=>document.getElementById(id);
  let submission=null, context=null, cursor=null, closureUnknown=false;
  const decisions=new Map();
  const definitive=error=>error instanceof ApiError && error.status>=400 && error.status<500 && error.status!==429;
  const lock=(form,value)=>{for(const field of form.elements) if(field.name) field.disabled=value;};
  function reset() {
    submission=context=cursor=null; closureUnknown=false; decisions.clear();
    for(const id of ['result-submit','review-form','confirm-close','close-search','reopen-search','closure-audit']) {
      const form=$(id); form.reset(); lock(form,false); form.querySelector('button').disabled=false;
    }
    for(const id of ['result-new','review-more']) $(id).hidden=true;
    for(const id of ['result-message','review-list','closure-history','closure-message']) $(id).replaceChildren();
  }
  const pending=()=>Boolean(closureUnknown || submission?.uncertain || [...decisions.values()].some(item=>item.uncertain));
  $('result-submit').addEventListener('submit', event=>{event.preventDefault(); const form=event.currentTarget;
    run(async()=>{
      if(!submission) {
        const data=new FormData(form), search=uuid(data.get('searchId')),task=uuid(data.get('taskId')),result=String(data.get('result')??'').trim();
        if(!result || result.length>4000) throw new ApiError(400);
        submission={path:`/api/v1/field-tasks/searches/${search}/tasks/${task}/results`,body:{requestId:crypto.randomUUID(),result},uncertain:false};
        lock(form,true);
      }
      try {
        const receipt=await api.call(submission.path,{method:'POST',body:submission.body});
        submission.uncertain=false; form.querySelector('button').disabled=true; $('result-new').hidden=false;
        $('result-message').textContent=`Результат ${receipt.resultId} отправлен на проверку. Задача ещё не завершена.`;
        message('Отправка подтверждена. Повтор возвращает историческую квитанцию.');
      } catch(error) {
        if(!submission.uncertain && definitive(error)) {submission=null; lock(form,false);}
        else {submission.uncertain=true; $('result-message').textContent='Ответ не подтверждён. Повторите в этой вкладке без изменения текста; при выходе ключ будет потерян.';}
        throw error;
      }
    });
  });
  $('result-new').addEventListener('click',()=>{
    if($('result-new').hidden) return;
    submission=null; $('result-submit').reset(); lock($('result-submit'),false); $('result-submit').querySelector('button').disabled=false;
    $('result-new').hidden=true; $('result-message').textContent='';
  });
  async function load(search,task,after) {
    const page=await api.call(`/api/v1/field-tasks/searches/${search}/tasks/${task}/results?limit=50${after?`&after=${encodeURIComponent(after)}`:''}`);
    if(!after) $('review-list').replaceChildren();
    for(const item of page.items) {
      const id=uuid(item.id),li=document.createElement('li'),text=document.createElement('p');
      text.textContent=`Результат ${id}: ${item.result}; решение: ${item.decision ?? 'ожидает проверки'}${item.return_reason?`; причина возврата: ${item.return_reason}`:''}`;
      li.append(text);
      if(item.decision===null) {
        const reason=document.createElement('input'); reason.placeholder='Причина возврата (обязательна при возврате)'; reason.maxLength=2000;
        const approve=document.createElement('button'),reject=document.createElement('button');
        approve.type=reject.type='button'; approve.textContent='Принять результат'; reject.textContent='Вернуть с причиной';
        const existing=decisions.get(id);
        if(existing) {reason.value=existing.body.reason ?? ''; reason.disabled=true; approve.disabled=!existing.body.approve; reject.disabled=existing.body.approve;}
        const decide=accept=>run(async()=>{
          let attempt=decisions.get(id);
          if(!attempt) {
            const value=reason.value.trim();
            if(!accept && !value) {message('Для возврата укажите причину.'); return;}
            attempt={body:accept?{resultId:id,approve:true}:{resultId:id,approve:false,reason:value},uncertain:false};
            decisions.set(id,attempt);
          }
          // A retry must use exactly the first decision and reason.
          if(attempt.body.approve!==accept) return;
          reason.disabled=true; approve.disabled=!accept; reject.disabled=accept;
          try {
            await api.call(`/api/v1/field-tasks/searches/${search}/tasks/${task}/decision`,{method:'POST',body:attempt.body});
            decisions.delete(id); approve.disabled=reject.disabled=true;
            message('Решение записано. Обновите результат и статус задачи: квитанция историческая.');
          } catch(error) {
            if(!attempt.uncertain && definitive(error)) {decisions.delete(id); reason.disabled=false; approve.disabled=reject.disabled=false;}
            else {attempt.uncertain=true; message('Решение могло сохраниться. Повторите то же решение или проверьте историю результата.');}
            throw error;
          }
        });
        approve.addEventListener('click',()=>decide(true)); reject.addEventListener('click',()=>decide(false));
        li.append(reason,approve,reject);
      } else decisions.delete(id);
      $('review-list').append(li);
    }
    context={search,task}; cursor=page.nextCursor; $('review-more').hidden=!cursor; message('История результатов обновлена.');
  }
  $('review-form').addEventListener('submit',event=>{event.preventDefault(); const form=event.currentTarget;
    run(()=>{const data=new FormData(form); return load(uuid(data.get('searchId')),uuid(data.get('taskId')),null);});
  });
  $('review-more').addEventListener('click',()=>run(()=>load(context.search,context.task,cursor)));
  $('confirm-close').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;
    run(async()=>{const search=uuid(new FormData(form).get('searchId'));
      await api.call(`/api/v1/search-closure/searches/${search}/confirm`,{method:'POST',body:{}});
      $('closure-message').textContent='Готовность к закрытию подтверждена. Поиск ещё не закрыт.';
    });
  });
  function nonRetrying(id,action) {
    $(id).addEventListener('submit',event=>{event.preventDefault(); const form=event.currentTarget;
      if (form.querySelector('button').disabled) return;
      run(async()=>{
        const data=new FormData(form),search=uuid(data.get('searchId')),reason=String(data.get('reason')??'').trim();
        if(reason.length>2000 || (action==='reopen' && !reason)) throw new ApiError(400);
        const body=action==='reopen'?{reason}:reason?{exceptionReason:reason}:{};
        try {
          const result=await api.call(`/api/v1/search-closure/searches/${search}/${action}`,{method:'POST',body});
          form.querySelector('button').disabled=true;
          $('closure-message').textContent=action==='close'?'Закрытие подтверждено сервером. SMS не отправлено.':`Повторное открытие подтверждено: ${result.status}.`;
        } catch(error) {
          if(!definitive(error) || error.status===409) {
            closureUnknown=true; form.querySelector('button').disabled=true;
            $('closure-message').textContent='Результат операции неясен или конфликтует с состоянием. Проверьте журнал; не повторяйте вслепую.';
          }
          throw error;
        }
      });
    });
  }
  nonRetrying('close-search','close'); nonRetrying('reopen-search','reopen');
  $('closure-audit').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;
    run(async()=>{
      const search=uuid(new FormData(form).get('searchId'));
      const page=await api.call(`/api/v1/search-closure/searches/${search}/audit?limit=50`);
      $('closure-history').replaceChildren();
      for(const entry of page.items) {const li=document.createElement('li'); li.textContent=`${entry.type} — ${new Date(entry.created_at).toLocaleString('ru-RU')}`; $('closure-history').append(li);}
      $('closure-message').textContent=page.items.length?'Показаны последние записи журнала. Проверьте порядок событий.':'Записей о закрытии нет; текущее состояние не подтверждено.';
      if(page.nextCursor) $('closure-message').textContent+=' Показаны только последние 50 событий.';
    });
  });
  return {reset,pending};
}
