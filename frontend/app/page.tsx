import Layout from "@/components/Layout";
import { HeroSection } from "@/components/sections/HeroSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { HomeFAQSection } from "@/components/sections/HomeFAQSection";
import { DefinitionSection } from "@/components/sections/DefinitionSection";
import { Metadata } from 'next';

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Pitchy.pro",
  "url": "https://pitchy.pro",
  "logo": "https://pitchy.pro/og-image.png",
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "auth@pitchy.pro",
    "contactType": "customer support"
  }
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "url": "https://pitchy.pro",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://pitchy.pro/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Что такое Pitchy.pro?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Pitchy.pro — это платформа для оценки стартапов на базе искусственного интеллекта. Мы помогаем инвесторам и фаундерам валидировать идеи, рассчитывать юнит-экономику и автоматически собирать инвестиционные отчеты."
      }
    },
    {
      "@type": "Question",
      "name": "Что такое AI-скоринг стартапов?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "AI-скоринг стартапов от Pitchy.pro — это процесс автоматической оценки бизнес-идеи, команды и рыночных перспектив с использованием больших языковых моделей (LLM) для предсказания инвестиционной привлекательности проекта по шкале от 0 до 100."
      }
    },
    {
      "@type": "Question",
      "name": "Какие данные использует ваш ИИ?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Наш ИИ использует публично доступные данные: рыночные тренды, информацию о команде, данные о продукте и метрики роста. Мы не используем конфиденциальную информацию."
      }
    },
    {
      "@type": "Question",
      "name": "Насколько точны результаты ИИ-анализа?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Наш ИИ предоставляет объективную оценку на основе доступных данных. Это сверхбыстрый инструмент для первичного скрининга стартапов, который не заменяет полноценный due diligence, но значительно ускоряет процесс принятия инвестиционных решений."
      }
    }
  ]
};

export default function Home() {
  return (
    <Layout>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <HeroSection />
      <DefinitionSection />
      <FeaturesSection />
      <HomeFAQSection />
    </Layout>
  );
}
