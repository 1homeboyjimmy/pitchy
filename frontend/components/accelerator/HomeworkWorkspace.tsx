"use client";

import { useState } from "react";
import { HomeworkManager } from "./HomeworkManager";
import { HomeworkReviewQueue } from "./HomeworkReviewQueue";

type Resident = { membership_id: number; name: string; email: string; status: string };

export function HomeworkWorkspace({ cohortId, token, residents, isAdmin, pitchyEnabled, focusId }: { cohortId: number; token: string; residents: Resident[]; isAdmin: boolean; pitchyEnabled: boolean; focusId?: number }) {
  const [view, setView] = useState<"review" | "assignments">(focusId ? "assignments" : "review");
  return <div>
    <header className="border-b border-white/8 pb-5"><p className="text-xs text-white/35">Обзор потока&nbsp; / &nbsp;Программа&nbsp; / &nbsp;Домашние задания</p><h1 className="mt-3 text-3xl font-semibold">Домашние задания</h1><p className="mt-1 text-sm text-white/45">Проверка работ и управление заданиями потока</p></header>
    <div className="mb-5 flex border-b border-white/10"><button type="button" onClick={() => setView("review")} className={`border-b-2 px-4 py-3 text-sm ${view === "review" ? "border-white text-white" : "border-transparent text-white/45"}`}>На проверке</button><button type="button" onClick={() => setView("assignments")} className={`border-b-2 px-4 py-3 text-sm ${view === "assignments" ? "border-white text-white" : "border-transparent text-white/45"}`}>Все задания</button></div>
    {view === "review" ? <HomeworkReviewQueue cohortId={cohortId} token={token} initialAssignmentId={focusId} /> : <HomeworkManager focusId={focusId} cohortId={cohortId} token={token} residents={residents} isAdmin={isAdmin} pitchyEnabled={pitchyEnabled} />}
  </div>;
}
