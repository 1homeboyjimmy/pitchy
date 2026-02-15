import Layout from "@/components/Layout";
import { HeroSection } from "@/components/sections/HeroSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";

export default function Home() {
  return (
    <Layout>
      <HeroSection />
      <FeaturesSection />
    </Layout>
  );
}
