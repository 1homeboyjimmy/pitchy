import { ImageResponse } from 'next/og';

export const runtime = 'edge';

// Image metadata
export const alt = 'Pitchy.pro — ИИ-Copilot для бизнеса';
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          backgroundColor: '#0a0818',
          backgroundImage: 'radial-gradient(circle at 100% 100%, #3b0764 0%, #0a0818 60%)',
          padding: '80px 100px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '32px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              backgroundColor: '#a855f7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '20px',
              boxShadow: '0 0 40px rgba(168, 85, 247, 0.4)',
            }}
          >
            <span style={{ fontSize: '40px', color: 'white', fontWeight: 'bold' }}>P</span>
          </div>
          <span style={{ fontSize: '48px', fontWeight: 'bold', color: 'white', letterSpacing: '-0.02em' }}>
            Pitchy
          </span>
        </div>

        <h1
          style={{
            fontSize: '84px',
            fontWeight: '900',
            color: 'white',
            lineHeight: 1.1,
            marginBottom: '48px',
            letterSpacing: '-0.03em',
          }}
        >
          ИИ-Copilot
          <br />
          <span style={{ color: '#a855f7' }}>для бизнеса</span>
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '6px', backgroundColor: '#a855f7', marginRight: '20px', boxShadow: '0 0 10px #a855f7' }} />
            <span style={{ fontSize: '36px', color: '#cbd5e1', fontWeight: '500' }}>Виртуальный партнер 24/7 для валидации гипотез</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '6px', backgroundColor: '#22d3ee', marginRight: '20px', boxShadow: '0 0 10px #22d3ee' }} />
            <span style={{ fontSize: '36px', color: '#cbd5e1', fontWeight: '500' }}>Мгновенная оценка рисков и Индекс готовности</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '6px', backgroundColor: '#10b981', marginRight: '20px', boxShadow: '0 0 10px #10b981' }} />
            <span style={{ fontSize: '36px', color: '#cbd5e1', fontWeight: '500' }}>Анализ рынка, конкурентов и расчет экономики</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
