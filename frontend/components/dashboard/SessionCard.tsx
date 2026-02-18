
import { motion } from "framer-motion";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import { Calendar, ChevronRight } from "lucide-react";

interface SessionCardProps {
    session: {
        id: number;
        title: string;
        created_at: string;
        analysis_id?: number;
    };
    onClick: () => void;
}

export function SessionCard({ session, onClick }: SessionCardProps) {
    const formattedDate = dayjs(session.created_at).locale("ru").format("D MMMM YYYY, HH:mm");

    return (
        <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onClick}
            className="glass-panel p-6 cursor-pointer hover:bg-white/5 transition-colors group relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-gradient-to-r from-pitchy-violet/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-2 group-hover:text-pitchy-violet transition-colors">
                        {session.title}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-white/50">
                        <div className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" />
                            <span>{formattedDate}</span>
                        </div>
                        {session.analysis_id ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
                                Анализ готов
                            </span>
                        ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium">
                                В процессе
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-pitchy-violet group-hover:text-white transition-all">
                        <ChevronRight className="w-5 h-5" />
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
