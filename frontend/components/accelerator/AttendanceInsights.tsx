"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Trophy } from "lucide-react";
import { getAuthJson } from "@/lib/api";

type Group = { label:string; participants:number; present:number; total:number; percent:number|null };
type Team = { id:number; name:string; members:number; track:string; percent:number; present:number; total:number };
type Insights = {
 scope:string; basis:string; past_events:number; percent:number|null; teams:number;
 distribution:{zero:number;below50:number;normal:number;no_data:number};
 participants:{zero:number;below50:number;normal:number;no_data:number};
 visit_distribution?:Array<{visits:number;participants:number}>;
 top_teams:Team[]; by_course:Group[]; by_direction:Group[]; by_track:Group[];
 events:Array<{id:number;title:string;present:number;total:number;percent:number|null}>;
};

export function AttendanceInsights({cohortId,token,refreshKey,onParticipants,onZeroTeams,onTeam,onEvent}:{
 cohortId:number;token:string;refreshKey:number;onParticipants:(filter:"zero"|"below50")=>void;
 onZeroTeams:()=>void;onTeam:(id:number)=>void;onEvent:(id:number)=>void;
}){
 const [data,setData]=useState<Insights|null>(null);const [failed,setFailed]=useState(false);const [retry,setRetry]=useState(0);
 const [group,setGroup]=useState<"by_course"|"by_direction"|"by_track">("by_course");const [expanded,setExpanded]=useState(false);
 useEffect(()=>{let active=true;const controller=new AbortController();setData(null);setFailed(false);
  getAuthJson<Insights>(`/api/accelerators/cohorts/${cohortId}/attendance-insights`,token,controller.signal)
   .then(value=>{if(active)setData(value)}).catch(()=>{if(active)setFailed(true)});
  return()=>{active=false;controller.abort()};
 },[cohortId,token,refreshKey,retry]);
 if(failed)return <section className="overview-panel"><p>Не удалось загрузить аналитику посещаемости.</p><button className="overview-link" onClick={()=>setRetry(x=>x+1)}>Повторить</button></section>;
 if(!data)return <section className="overview-panel flex min-h-40 items-center justify-center gap-3" role="status"><Loader2 className="animate-spin" size={18}/>Загружаем посещаемость…</section>;
 const slices=[{key:"normal",label:"50% и выше",color:"#10b981",count:data.distribution.normal},
  {key:"below50",label:"Ниже 50%, кроме нулевой",color:"#f59e0b",count:data.distribution.below50},
  {key:"zero",label:"Нулевая посещаемость",color:"#64748b",count:data.distribution.zero},
  {key:"no_data",label:"Пока нет данных",color:"#cbd5e1",count:data.distribution.no_data}];
 let position=0;const stops=slices.map(slice=>{const start=position;position+=data.teams?slice.count/data.teams*100:0;return `${slice.color} ${start}% ${position}%`});
 const groups=data[group]||[];const shownGroups=expanded?groups:groups.slice(0,6);
 return <section className="min-w-0 space-y-5" aria-label="Аналитика посещаемости">
  <div className="grid gap-3 sm:grid-cols-2">
   <Stat label="Участников без посещений" value={data.participants.zero} onClick={()=>onParticipants("zero")}/>
   <Stat label="Участников ниже 50%" value={data.participants.zero+data.participants.below50} onClick={()=>onParticipants("below50")}/>
  </div>
  <div className="grid min-w-0 gap-5 xl:grid-cols-2">
   <section className="overview-panel min-w-0"><h2 className="text-lg font-semibold">Посещаемость команд</h2>
    <div className="mt-6 flex flex-wrap items-center gap-6">
     <div role="img" aria-label={`Распределение ${data.teams} команд: ${slices.map(s=>`${s.label} — ${s.count}`).join(", ")}`} className="grid size-44 shrink-0 place-items-center rounded-full p-4" style={{background:data.teams?`conic-gradient(${stops.join(",")})`:"#64748b"}}>
      <div className="grid size-full place-content-center rounded-full bg-[#1c1b1b] text-center"><strong className="text-3xl">{data.percent==null?"—":`${data.percent}%`}</strong><span className="mt-1 text-xs text-white/50">посещаемость</span></div>
     </div>
     <ul className="min-w-[200px] flex-1 space-y-3">{slices.map(slice=><li key={slice.key} className="flex items-center gap-3 text-sm"><span className="size-2.5 shrink-0 rounded-full" style={{background:slice.color}}/><span className="min-w-0 flex-1 text-white/65">{slice.label}</span><strong>{slice.count}</strong><span className="w-12 text-right text-xs text-white/45">{data.teams?Math.round(slice.count/data.teams*100):0}%</span></li>)}</ul>
    </div>
    <button className="overview-link" onClick={onZeroTeams}>Команды без посещений · {data.distribution.zero}<ArrowRight size={15}/></button>
    <VisitDistribution rows={data.visit_distribution || []}/>
   </section>
   <section className="overview-panel min-w-0"><h2 className="flex items-center gap-2 text-lg font-semibold"><Trophy size={19} className="text-amber-300"/>Топ-5 команд по посещаемости</h2>
    <ol className="mt-4 space-y-1">{data.top_teams.map((team,index)=><li key={team.id}><button onClick={()=>onTeam(team.id)} className="flex w-full min-w-0 items-center gap-3 rounded-xl py-3 text-left hover:bg-white/5"><span className="w-5 shrink-0 text-sm text-white/40">{index+1}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm">{team.name}</span><span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/8"><span className="block h-full rounded-full bg-emerald-400" style={{width:`${Math.min(100,team.percent)}%`}}/></span></span><strong className="shrink-0 text-sm">{team.percent}%</strong><ArrowRight className="shrink-0 text-white/35" size={14}/></button></li>)}</ol>
    {!data.top_teams.length&&<p className="py-8 text-sm text-white/45">Рейтинг появится после первых отметок посещения.</p>}
   </section>
  </div>
  <div className="grid min-w-0 gap-5 xl:grid-cols-2">
   <section className="overview-panel min-w-0"><h2 className="text-lg font-semibold">Кто посещает программу</h2>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Сравнение посещаемости">{([["by_course","По курсам"],["by_direction","По уровню образования"],["by_track","По трекам"]] as const).map(([key,label])=><button key={key} aria-pressed={group===key} onClick={()=>{setGroup(key);setExpanded(false)}} className={`rounded-lg border px-3 py-2 text-xs ${group===key?"border-blue-400/40 bg-blue-400/10":"border-white/10 text-white/50"}`}>{label}</button>)}</div>
    <div className="mt-5 space-y-4">{shownGroups.map(row=><div key={row.label}><div className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{row.label}<small className="ml-2 text-white/40">{row.participants} уч.</small></span><strong className="shrink-0">{row.percent==null?"—":`${row.percent}%`}</strong></div><Bar percent={row.percent}/></div>)}</div>
    {groups.length>6&&<button className="overview-link" onClick={()=>setExpanded(value=>!value)}>{expanded?"Свернуть":`Все группы · ${groups.length}`}</button>}

   </section>
   <section className="overview-panel min-w-0"><h2 className="text-lg font-semibold">Посещаемость по мероприятиям</h2><p className="mt-1 text-xs text-white/45">Последние шесть · {data.scope==="team"?"команды":"участники"}</p>
    <div className="mt-5 space-y-3">{data.events.slice(-6).map(event=><button key={event.id} onClick={()=>onEvent(event.id)} className="block w-full text-left"><span className="flex justify-between gap-3 text-sm"><span className="min-w-0 break-words">{event.title}</span><span className="shrink-0 text-white/60">{event.present}/{event.total} · {event.percent==null?"—":`${event.percent}%`}</span></span><Bar percent={event.percent}/></button>)}</div>
    {!data.events.length&&<p className="py-6 text-sm text-white/45">Пока нет завершившихся мероприятий.</p>}
   </section>
  </div>
 </section>;
}
function Bar({percent}:{percent:number|null}){return <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-blue-400" style={{width:`${Math.max(0,Math.min(100,percent||0))}%`}}/></div>}
function Stat({label,value,icon,onClick}:{label:string;value:number;icon?:React.ReactNode;onClick?:()=>void}){
 const content=<><span className="flex items-center justify-between text-white/55"><span className="text-xs">{label}</span>{icon||<ArrowRight size={17}/>}</span><strong className="mt-3 block text-3xl">{value}</strong>{onClick&&<span className="mt-2 block text-xs text-blue-400">Посмотреть участников</span>}</>;
 return onClick?<button className="overview-panel min-w-0 text-left hover:!border-white/25" onClick={onClick}>{content}</button>:<div className="overview-panel min-w-0">{content}</div>;
}

const VISIT_COLORS = ["#64748b", "#fb923c", "#fbbf24", "#a3e635", "#34d399", "#22d3ee", "#60a5fa", "#a78bfa", "#e879f9", "#f472b6", "#2dd4bf"];
function VisitDistribution({rows}:{rows:Array<{visits:number;participants:number}>}) {
 const total=rows.reduce((sum,row)=>sum+row.participants,0);
 let position=0;
 const slices=rows.map(row=>{const start=position;position+=total?row.participants/total*100:0;return {...row,color:VISIT_COLORS[row.visits%VISIT_COLORS.length],start,end:position}});
 return <div className="mt-5 border-t border-white/10 pt-5"><h3 className="text-base font-semibold">Сколько мероприятий посетили участники</h3>
  <div className="mt-4 flex flex-wrap items-center gap-5">
   <div role="img" aria-label={`Число посещений: ${rows.map(row=>`${row.visits} — ${row.participants} участников`).join(", ")}`} className="grid size-36 shrink-0 place-items-center rounded-full p-3" style={{background:total?`conic-gradient(${slices.map(row=>`${row.color} ${row.start}% ${row.end}%`).join(",")})`:"#64748b"}}>
    <div className="grid size-full place-content-center rounded-full bg-[#1c1b1b] text-center"><strong className="text-2xl">{total}</strong><span className="mt-1 text-xs text-white/50">участников</span></div>
   </div>
   <ul className="grid min-w-[190px] flex-1 grid-cols-2 gap-x-5 gap-y-2">{slices.map(row=><li key={row.visits} className="flex items-center gap-2 text-xs"><span className="size-2 shrink-0 rounded-full" style={{background:row.color}}/><span className="min-w-0 flex-1 text-white/60">{row.visits} посещ.</span><strong>{row.participants}</strong></li>)}</ul>
  </div>
 </div>;
}
