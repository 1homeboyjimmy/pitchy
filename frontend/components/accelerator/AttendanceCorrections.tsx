"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, Paperclip, X } from "lucide-react";
import { describeApiError, getAuthJson, patchAuthJson, postAuthForm, postAuthJson } from "@/lib/api";
import { useAcceleratorRefresh } from "@/lib/hooks/useAcceleratorRefresh";
import { eventDateText } from "@/lib/acceleratorDates";

type Attachment = {name:string;url:string;size_bytes:number;mime_type:string};
export type AttendanceCorrection = {id:number;event_id:number;membership_id:number;full_name:string;was_present:boolean;description:string;attachments:Attachment[];status:"pending"|"approved"|"rejected";review_comment?:string|null;created_at:string;reviewed_at?:string|null;event_title?:string;event_starts_at?:string;account_name?:string;account_email?:string|null};
export const CORRECTION_STATUS = {pending:"Заявка на проверке",approved:"Заявка подтверждена",rejected:"Заявка отклонена"};

export function AttendanceCorrectionDialog({membershipId,event,token,initialName,onClose,onSaved}:{membershipId:number;event:{id:number;title:string;starts_at?:string;timezone?:string|null};token:string;initialName:string;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const [fullName,setFullName]=useState(initialName);
 const [presence,setPresence]=useState("");
 const [description,setDescription]=useState("");
 const [attachment,setAttachment]=useState<Attachment|null>(null);
 const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState(false);const [error,setError]=useState("");
 useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
 const upload=async(file:File)=>{
  setUploading(true);setError("");
  try {const data=new FormData();data.append("file",file);setAttachment(await postAuthForm<Attachment>(`/api/accelerators/memberships/${membershipId}/events/${event.id}/attendance-corrections/files`,data,token));}
  catch(reason){setError(describeApiError(reason,"Не удалось загрузить подтверждение"));}
  finally{setUploading(false);}
 };
 const submit=async(e:FormEvent)=>{
  e.preventDefault();if(presence!=="yes"&&presence!=="no")return;
  setBusy(true);setError("");
  try {await postAuthJson(`/api/accelerators/memberships/${membershipId}/events/${event.id}/attendance-corrections`,{full_name:fullName.trim(),was_present:presence==="yes",description:description.trim(),attachments:attachment?[attachment.url]:[]},token);await onSaved();onClose();}
  catch(reason){setError(describeApiError(reason,"Не удалось отправить заявку"));}
  finally{setBusy(false);}
 };
 return <dialog ref={dialog} onCancel={e=>{e.preventDefault();if(!busy&&!uploading)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!busy&&!uploading)onClose();}} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-[#1c1b1b] p-0 text-white shadow-2xl backdrop:bg-black/70" aria-labelledby="attendance-correction-title">
  <form onSubmit={submit} className="p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><h2 id="attendance-correction-title" className="text-xl">Заявка на корректировку посещаемости</h2><button type="button" aria-label="Закрыть заявку" disabled={busy||uploading} onClick={onClose}><X size={22}/></button></div>
  <p className="mt-3 text-sm text-white/60">{event.title}</p>{event.starts_at&&<p className="mt-1 text-xs text-white/45">{eventDateText(event.starts_at,event.timezone||"Europe/Moscow")}</p>}
  <label className="mt-5 block text-sm">ФИО<input autoFocus required minLength={2} maxLength={200} value={fullName} onChange={e=>setFullName(e.target.value)} className="workspace-input mt-2" autoComplete="name"/></label>
  <fieldset className="mt-5"><legend className="text-sm">Был на мероприятии</legend><div className="mt-2 flex gap-3">{[["yes","Да"],["no","Нет"]].map(([value,label])=><label key={value} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border p-3 ${presence===value?"border-blue-400 bg-blue-400/10":"border-white/15"}`}><input required type="radio" name="attendance-presence" value={value} checked={presence===value} onChange={()=>setPresence(value)}/>{label}</label>)}</div></fieldset>
  <label className="mt-5 block text-sm">Опишите ситуацию<textarea required minLength={3} maxLength={5000} rows={4} value={description} onChange={e=>setDescription(e.target.value)} className="workspace-input mt-2 resize-y"/></label>
  <div className="mt-5"><label className="inline-flex cursor-pointer items-center gap-2 text-sm"><Paperclip size={16}/>{uploading?"Загрузка…":"Приложить подтверждение"}<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" disabled={busy||uploading} className="sr-only" onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);e.target.value="";}}/></label><p className="mt-1 text-xs text-white/45">Необязательно. Фото или скриншот до 10 МБ, PDF до 25 МБ.</p>{attachment&&<div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm"><span className="break-all">{attachment.name}</span><button type="button" aria-label="Удалить вложение" onClick={()=>setAttachment(null)} disabled={busy||uploading}><X size={16}/></button></div>}</div>
  {error&&<p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
  <div className="mt-6 flex justify-end gap-3"><button type="button" className="overview-secondary" onClick={onClose} disabled={busy||uploading}>Отмена</button><button className="workspace-button" disabled={busy||uploading||!presence}>{(busy||uploading)&&<Loader2 className="animate-spin" size={16}/>}Отправить на проверку</button></div>
 </form></dialog>;
}

type Queue={total:number;pending:number;timezone?:string;team_attendance:boolean;items:AttendanceCorrection[]};
export function AttendanceCorrectionQueue({cohortId,token}:{cohortId:number;token:string}) {
 const [status,setStatus]=useState("pending");const [offset,setOffset]=useState(0);const [data,setData]=useState<Queue|null>(null);const [loading,setLoading]=useState(false);const [busy,setBusy]=useState<number|null>(null);const [error,setError]=useState("");const [comments,setComments]=useState<Record<number,string>>({});
 const load=useCallback(async()=>{setLoading(true);try{const next=await getAuthJson<Queue>(`/api/accelerators/cohorts/${cohortId}/attendance-corrections?status=${status}&offset=${offset}&limit=30`,token);setData(next);setError("");if(!next.items.length&&offset>0)setOffset(Math.max(0,offset-30));}catch(reason){setError(describeApiError(reason,"Не удалось загрузить заявки"));}finally{setLoading(false);}},[cohortId,offset,status,token]);
 useEffect(()=>{void load();},[load]);useAcceleratorRefresh(load,cohortId);
 const review=async(row:AttendanceCorrection,decision:"approved"|"rejected")=>{setBusy(row.id);setError("");try{await patchAuthJson(`/api/accelerators/attendance-corrections/${row.id}`,{decision,comment:comments[row.id]||""},token);await load();}catch(reason){setError(describeApiError(reason,"Не удалось рассмотреть заявку"));}finally{setBusy(null);}};
 return <section className="workspace-card"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl">Заявки на корректировку посещаемости</h1><p className="mt-2 text-sm text-white/50">На проверке: {data?.pending??"—"}</p></div><select aria-label="Статус заявок" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}} className="workspace-input !w-auto"><option value="pending">На проверке</option><option value="approved">Подтверждённые</option><option value="rejected">Отклонённые</option><option value="all">Все заявки</option></select></div>
 {data?.team_attendance&&<p className="mt-4 rounded-xl bg-blue-400/10 p-3 text-sm text-white/65">Командный учёт: подтверждённая отметка применяется ко всей команде.</p>}
 {error&&<p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
 {loading&&!data?<Loader2 className="mx-auto my-10 animate-spin"/>:!data?.items.length?<p className="py-12 text-center text-white/45">Заявок с выбранным статусом нет.</p>:<div className="mt-5 space-y-4">{data.items.map(row=><article key={row.id} className="rounded-2xl border border-white/15 p-4 sm:p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg">{row.full_name}</h2><p className="mt-1 text-xs text-white/45">Аккаунт: {row.account_name}{row.account_email?` · ${row.account_email}`:""}</p></div><span className="text-xs text-white/50">{CORRECTION_STATUS[row.status]}</span></div><p className="mt-4 font-medium">{row.event_title}</p>{row.event_starts_at&&<p className="mt-1 text-xs text-white/45">{eventDateText(row.event_starts_at,data.timezone||"Europe/Moscow")}</p>}<p className="mt-3 text-sm">Был на мероприятии: <strong>{row.was_present?"Да":"Нет"}</strong></p><p className="mt-3 whitespace-pre-wrap break-words text-sm text-white/70">{row.description}</p><div className="mt-3 flex flex-wrap gap-3">{row.attachments.map(file=><a key={file.url} href={file.mime_type.startsWith("image/")?`${file.url}?inline=true`:file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-300 underline"><FileText size={15}/>{file.name}</a>)}</div><p className="mt-3 text-xs text-white/40">Подана {new Date(row.created_at+(/Z|[+-]\d\d:\d\d$/.test(row.created_at)?"":"Z")).toLocaleString("ru-RU")}</p>{row.status==="pending"?<><label className="mt-4 block text-xs text-white/50">Комментарий участнику (необязательно)<textarea rows={2} maxLength={3000} value={comments[row.id]||""} onChange={e=>setComments(current=>({...current,[row.id]:e.target.value}))} className="workspace-input mt-2 resize-y"/></label><div className="mt-4 flex flex-wrap justify-end gap-3"><button disabled={busy!==null} type="button" onClick={()=>void review(row,"rejected")} className="overview-secondary"><X size={15}/>Отклонить</button><button disabled={busy!==null} type="button" onClick={()=>void review(row,"approved")} className="workspace-button">{busy===row.id?<Loader2 className="animate-spin" size={15}/>:<Check size={15}/>}Подтвердить</button></div></>:row.review_comment&&<p className="mt-4 text-sm text-white/65">Комментарий: {row.review_comment}</p>}</article>)}</div>}
 {data&&data.total>30&&<nav aria-label="Страницы заявок" className="mt-5 flex items-center justify-between gap-3"><button className="overview-secondary" disabled={offset===0||loading} onClick={()=>setOffset(value=>Math.max(0,value-30))}>Назад</button><span className="text-sm text-white/50">{offset+1}–{Math.min(offset+30,data.total)} из {data.total}</span><button className="overview-secondary" disabled={offset+30>=data.total||loading} onClick={()=>setOffset(value=>value+30)}>Далее</button></nav>}
 </section>;
}
