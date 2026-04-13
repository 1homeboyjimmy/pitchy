import { PresentationSlide } from "@/lib/api";

export function SlideRenderer({ slide }: { slide: PresentationSlide }) {
  if (slide.html) {
    return (
      <div 
        className="w-full h-[500px] md:h-auto md:aspect-video flex items-stretch justify-stretch relative overflow-hidden rounded-2xl print:h-[100vh] print:rounded-none bg-[#131313]" 
        dangerouslySetInnerHTML={{ __html: slide.html }}
      />
    );
  }

  const contentArray = Array.isArray(slide.content) ? slide.content : slide.content ? [slide.content] : [];

  switch (slide.type) {
    case "Hero":
      return (
        <div className="flex flex-col items-center justify-center h-[500px] w-full bg-gradient-to-br from-[#131313] via-[#1a1025] to-[#131313] p-12 text-center relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
          <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
          <h1 className="text-5xl md:text-6xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pitchy-violet to-pitchy-cyan mb-6 relative z-10">{slide.title}</h1>
          <h2 className="text-2xl text-white/80 font-medium mb-8 relative z-10">{slide.subtitle}</h2>
          {contentArray.map((text, i) => (
            <p key={i} className="text-white/60 text-lg relative z-10 max-w-2xl">{text}</p>
          ))}
        </div>
      );

    case "Problem":
      return (
        <div className="flex flex-col h-[500px] w-full bg-[#131313] p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/10 blur-[100px] rounded-full pointer-events-none" />
           <h2 className="text-4xl font-bold text-white mb-8 border-l-4 border-red-500 pl-4">{slide.title || "Проблема"}</h2>
           <div className="flex flex-col gap-6 flex-1 justify-center relative z-10">
             {contentArray.map((text, i) => (
               <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-xl">
                 <p className="text-xl text-white/80">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );

    case "Solution":
      return (
        <div className="flex flex-col h-[500px] w-full bg-[#131313] p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />
           <h2 className="text-4xl font-bold text-white mb-8 border-l-4 border-emerald-500 pl-4">{slide.title || "Решение"}</h2>
           <div className="flex flex-col gap-6 flex-1 justify-center relative z-10">
             {contentArray.map((text, i) => (
               <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-xl">
                 <p className="text-xl text-emerald-100">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );

    case "Market":
    case "BusinessModel": {
      const colorClass = slide.type === "Market" ? "border-pitchy-cyan" : "border-pitchy-violet";
      const bgClass = slide.type === "Market" ? "bg-pitchy-cyan/5 border-pitchy-cyan/20" : "bg-pitchy-violet/5 border-pitchy-violet/20";
      
      return (
        <div className="flex flex-col h-[500px] w-full bg-[#131313] p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <h2 className={`text-4xl font-bold text-white mb-8 border-l-4 ${colorClass} pl-4`}>{slide.title}</h2>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 relative z-10">
             {contentArray.map((text, i) => (
               <div key={i} className={`p-6 rounded-xl border ${bgClass} flex items-center`}>
                 <p className="text-lg text-white/90">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );
    }

    case "Team":
      return (
        <div className="flex flex-col h-[500px] w-full bg-[#131313] p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <h2 className="text-4xl font-bold text-white mb-8 border-l-4 border-blue-500 pl-4">{slide.title || "Команда"}</h2>
           <div className="flex flex-wrap gap-6 relative z-10 justify-center items-center flex-1">
             {contentArray.map((text, i) => (
               <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-xl text-center min-w-[250px]">
                 <div className="w-20 h-20 mx-auto bg-white/10 rounded-full mb-4 flex items-center justify-center text-2xl">👤</div>
                 <p className="text-lg text-white/80">{text}</p>
               </div>
             ))}
           </div>
        </div>
      );

    case "CallToAction":
      return (
        <div className="flex flex-col items-center justify-center h-[500px] w-full bg-gradient-to-br from-pitchy-violet to-purple-800 p-12 text-center relative overflow-hidden rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
          <div className="absolute inset-0 bg-noise opacity-30 pointer-events-none" />
          <h2 className="text-5xl font-bold text-white mb-8 relative z-10">{slide.title || "Спасибо за внимание!"}</h2>
          {contentArray.map((text, i) => (
            <p key={i} className="text-2xl text-white/90 relative z-10 mb-4 max-w-3xl">{text}</p>
          ))}
          <div className="mt-8 text-white/50 text-sm font-medium relative z-10 uppercase tracking-widest">
            Сгенерировано с помощью Pitchy
          </div>
        </div>
      );

    default:
      return (
        <div className="flex flex-col h-[500px] w-full bg-[#131313] p-12 relative overflow-hidden border border-white/10 rounded-2xl print:h-[100vh] print:rounded-none print:border-none">
           <h2 className="text-4xl font-bold text-white mb-8">{slide.title || "Слайд"}</h2>
           <div className="flex flex-col gap-4 relative z-10">
             {contentArray.map((text, i) => (
               <p key={i} className="text-xl text-white/70">{text}</p>
             ))}
           </div>
        </div>
      );
  }
}
