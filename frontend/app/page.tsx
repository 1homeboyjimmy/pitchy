import Layout from "@/components/Layout";
import { HeroSection } from "@/components/sections/HeroSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { HistorySection } from "@/components/sections/HistorySection";

export default function Home() {
  return (
    <Layout>
      <HeroSection />
      <HistorySection />
      <FeaturesSection />
    </Layout>
  );
}
