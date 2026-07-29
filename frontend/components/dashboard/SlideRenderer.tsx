import DOMPurify from "isomorphic-dompurify";
import { PresentationSlide } from "@/lib/api";

export function SlideRenderer({ slide }: { slide: PresentationSlide }) {
  if (slide.html) {
    const sanitizedHtml = DOMPurify.sanitize(slide.html);
    return (
      <div 
        className="w-full h-[500px] md:h-auto md:aspect-video flex items-stretch justify-stretch relative overflow-hidden rounded-2xl print:h-[100vh] print:rounded-none bg-[#131313]" 
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  const contentArray = Array.isArray(slide.content) ? slide.content : slide.content ? [slide.content] : [];

  switch (slide.type) {
    case "Hero":
      return (
        // Заголовок был bg-clip-text + text-transparent поверх градиента из
        // from-pitchy-violet/to-pitchy-cyan. Этих токенов в @theme нет, градиент
        // не генерировался — и текст оставался полностью прозрачным, то есть
        // невидимым. Возвращаем сплошной цвет из текущей палитры.
        <div className="flex flex-col items-center justify-center h-[420px] sm:h-[500px] w-full bg-gradient-to-br from-[#131313] via-[#1a1a1a] to-[#131313] p-6 sm:p-12 text-center relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
          <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white mb-4 sm:mb-6 relative z-10 text-balance">{slide.title}</h1>
          <h2 className="text-lg sm:text-2xl text-white/80 font-medium mb-5 sm:mb-8 relative z-10">{slide.subtitle}</h2>
          {contentArray.map((text, i) => (
            <p key={i} className="text-white/60 text-base sm:text-lg relative z-10 max-w-2xl">{text}</p>
          ))}
        </div>
      );

    case "Problem":
      return (
        <div className="flex flex-col h-[420px] sm:h-[500px] w-full bg-[#131313] p-6 sm:p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/10 blur-[100px] rounded-full pointer-events-none" />
           <h2 className="text-2xl sm:text-4xl font-bold text-white mb-5 sm:mb-8 border-l-4 border-red-500 pl-4">{slide.title || "Проблема"}</h2>
           <div className="flex flex-col gap-3 sm:gap-6 flex-1 justify-center relative z-10 overflow-y-auto">
             {contentArray.map((text, i) => (
               <div key={i} className="bg-white/5 border border-white/10 p-4 sm:p-6 rounded-xl">
                 <p className="text-base sm:text-xl text-white/80">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );

    case "Solution":
      return (
        <div className="flex flex-col h-[420px] sm:h-[500px] w-full bg-[#131313] p-6 sm:p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />
           <h2 className="text-2xl sm:text-4xl font-bold text-white mb-5 sm:mb-8 border-l-4 border-emerald-500 pl-4">{slide.title || "Решение"}</h2>
           <div className="flex flex-col gap-3 sm:gap-6 flex-1 justify-center relative z-10 overflow-y-auto">
             {contentArray.map((text, i) => (
               <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 p-4 sm:p-6 rounded-xl">
                 <p className="text-base sm:text-xl text-emerald-100">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );

    case "Market":
    case "BusinessModel": {
      const colorClass = slide.type === "Market" ? "border-sky-400" : "border-white/60";
      const bgClass = slide.type === "Market" ? "bg-sky-400/5 border-sky-400/20" : "bg-white/5 border-white/15";

      return (
        <div className="flex flex-col h-[420px] sm:h-[500px] w-full bg-[#131313] p-6 sm:p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <h2 className={`text-2xl sm:text-4xl font-bold text-white mb-5 sm:mb-8 border-l-4 ${colorClass} pl-3 sm:pl-4`}>{slide.title}</h2>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6 flex-1 relative z-10 overflow-y-auto">
             {contentArray.map((text, i) => (
               <div key={i} className={`p-4 sm:p-6 rounded-xl border ${bgClass} flex items-center`}>
                 <p className="text-base sm:text-lg text-white/90">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );
    }

    case "Team":
      return (
        <div className="flex flex-col h-[420px] sm:h-[500px] w-full bg-[#131313] p-6 sm:p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <h2 className="text-2xl sm:text-4xl font-bold text-white mb-5 sm:mb-8 border-l-4 border-blue-500 pl-4">{slide.title || "Команда"}</h2>
           <div className="flex flex-wrap gap-3 sm:gap-6 relative z-10 justify-center items-center flex-1 overflow-y-auto">
             {contentArray.map((text, i) => (
               <div key={i} className="bg-white/5 border border-white/10 p-4 sm:p-6 rounded-xl text-center min-w-[min(100%,250px)]">
                 <div className="w-14 h-14 sm:w-20 sm:h-20 mx-auto bg-white/10 rounded-full mb-3 sm:mb-4 flex items-center justify-center text-2xl">👤</div>
                 <p className="text-lg text-white/80">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );

    case "CallToAction":
      return (
        <div className="flex flex-col items-center justify-center h-[420px] sm:h-[500px] w-full bg-gradient-to-br from-[#2a2a2a] to-[#0d0d0d] p-6 sm:p-12 text-center relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
          <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
          <h2 className="text-3xl sm:text-5xl font-bold text-white mb-5 sm:mb-8 relative z-10 text-balance">{slide.title || "Спасибо за внимание!"}</h2>
          {contentArray.map((text, i) => (
            <p key={i} className="text-lg sm:text-2xl text-white/90 relative z-10 mb-3 sm:mb-4 max-w-3xl">{text}</p>
          ))}
          <div className="mt-6 sm:mt-8 text-white/50 text-xs sm:text-sm font-medium relative z-10 uppercase tracking-widest">
            Сгенерировано с помощью Pitchy
          </div>
        </div>
      );

    default:
      return (
        <div className="flex flex-col h-[420px] sm:h-[500px] w-full bg-[#131313] p-6 sm:p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <h2 className="text-2xl sm:text-4xl font-bold text-white mb-5 sm:mb-8">{slide.title || "Слайд"}</h2>
           <div className="flex flex-col gap-3 sm:gap-4 relative z-10 overflow-y-auto">
             {contentArray.map((text, i) => (
               <p key={i} className="text-base sm:text-xl text-white/70">{text}</p>
             ))}
           </div>
        </div>
      );
  }
}
