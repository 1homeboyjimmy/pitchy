import Link from "next/link";

export type ProjectDescription = {
  description?: string;
  problem?: string;
  solution?: string;
  target_audience?: string;
};

export function ProjectSummary({ project, detailed = false }: {
  project: ProjectDescription & { id: number };
  detailed?: boolean;
}) {
  const fields = detailed
    ? [["Описание", project.description], ["Проблема", project.problem],
       ["Решение", project.solution], ["Целевая аудитория", project.target_audience]]
    : [["Описание", project.description]];
  return <div className="mt-4 space-y-3">
    {fields.filter(([, value]) => value?.trim()).map(([label, value]) =>
      <div key={label}><p className="text-xs text-white/40">{label}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/65">{value}</p></div>)}
    {!fields.some(([, value]) => value?.trim()) && <p className="text-sm text-white/40">Описание проекта пока не заполнено.</p>}
    {detailed && <Link href={`/passport/${project.id}`} className="inline-block text-sm text-blue-200 underline">Открыть паспорт проекта</Link>}
    {!detailed && <Link href={`/dashboard?tab=tree&project=${project.id}`} className="ml-4 inline-block text-sm text-blue-200 underline">Открыть разбивку проекта</Link>}
  </div>;
}
