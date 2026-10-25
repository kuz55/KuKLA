import { smsAeroApiKey, smsAeroLogin, smsAeroSign, smsProvider, smsRuApiId } from './config.js';

export async function sendOtp(phone:string,code:string,log:{info:Function}) {
  if (smsProvider === 'console') {
    log.info({phone,code},'OTP generated (console provider)');
    return 'console';
  }
  if (smsProvider === 'smsaero') {
      if(!smsAeroLogin || !smsAeroApiKey) throw new Error('SMS Aero credentials are not configured');
      const params=new URLSearchParams({number:phone.replace(/^\+/,''),text:`KuKLA: код входа ${code}. Никому его не сообщайте.`,sign:smsAeroSign});
      const auth=Buffer.from(`${smsAeroLogin}:${smsAeroApiKey}`).toString('base64');
      const response=await fetch(`https://gate.smsaero.ru/v2/sms/send?${params}`,{headers:{accept:'application/json',authorization:`Basic ${auth}`},signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error(`SMS Aero HTTP ${response.status}`);
      const result=await response.json() as {success?:boolean;message?:string};
      if(!result.success) throw new Error(`SMS Aero rejected message: ${result.message??'unknown error'}`);
      return 'smsaero';
  }
  if(smsProvider==='smsru'&&!smsRuApiId) throw new Error('SMS.ru credentials are not configured');
  if(smsProvider!=='smsru') throw new Error(`Unsupported SMS provider: ${smsProvider}`);
  const body=new URLSearchParams({api_id:smsRuApiId,to:phone.replace(/^\+/,''),msg:`KuKLA: код входа ${code}. Никому его не сообщайте.`,json:'1'});
  const response=await fetch('https://sms.ru/sms/send',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error(`SMS provider HTTP ${response.status}`);
  const result=await response.json() as {status?:string;status_code?:number;status_text?:string};
  if(result.status!=='OK' || result.status_code!==100) throw new Error(`SMS provider rejected message: ${result.status_text??result.status_code??'unknown error'}`);
  return 'smsru';
}
