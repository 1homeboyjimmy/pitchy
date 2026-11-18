import { CalendarDays } from "lucide-react";
import { utcDate, eventTimeText } from "@/lib/acceleratorDates";

type ScheduleStage = {
  id: number;
  title: string;
  description?: string | null;
  unlock_at?: string | null;
  materials: Array<{ id: number; title: string; url?: string | null; content?: string | null }>;
  timeline: Array<{ key: string; kind: string; id: number; title: string; sort_at?: string | null }>;
};

export function ResidentSchedule({ stages, timezone, error }: {
  stages: ScheduleStage[];
  timezone: string;
  error: string;
  onOpenEvent: (id: number) => void;
}) {
  return <section>
    <h1 className="text-3xl font-semibold">Материалы программы</h1>
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/20 p-3 text-red-200">{error}</p>}
    <div className="mt-6 space-y-4">{stages.filter(stage => stage.materials.length > 0 || !!stage.description).map((stage) => {
      const events = stage.timeline.filter((item) => item.kind === "event");
      const startsAt = events[0]?.sort_at || stage.unlock_at;
      return <article key={stage.id} className="rounded-xl border border-white/15 p-5">
        {startsAt && <p className="mb-2 flex items-center gap-2 text-sm text-white/55"><CalendarDays size={16} />{utcDate(startsAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: timezone })} · {eventTimeText(startsAt, timezone)}</p>}
        <h2 className="text-xl font-medium">{stage.title}</h2>
        {stage.description && <p className="mt-3 whitespace-pre-wrap text-sm text-white/65">{stage.description}</p>}
        {stage.materials.map((material) => <div key={material.id} className="mt-3 text-sm">
          {material.url ? <a href={material.url} target="_blank" rel="noreferrer" className="text-white/85 underline underline-offset-4">{material.title}</a> : <p className="font-medium">{material.title}</p>}
          {material.content && <p className="mt-1 whitespace-pre-wrap text-white/65">{material.content}</p>}
        </div>)}

      </article>;
    })}</div>
    {!stages.length && !error && <p className="mt-8 text-white/55">Организатор ещё не опубликовал расписание.</p>}
  </section>;
}
