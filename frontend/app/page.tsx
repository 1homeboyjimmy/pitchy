import Layout from "@/components/Layout";
import { HeroSection } from "@/components/sections/HeroSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";


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
      <HeroSection />
      <FeaturesSection />
    </Layout>
  );
}
