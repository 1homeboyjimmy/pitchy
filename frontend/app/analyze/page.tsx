import Layout from "@/components/Layout";
import { StartupAnalysisForm } from "@/components/StartupAnalysisForm";

export default function Analyze() {
    return (
        <Layout>
            <div className="min-h-[calc(100vh-5rem)] px-4 py-12">
                <div className="max-w-3xl mx-auto">
                    <StartupAnalysisForm />
                </div>
            </div>
        </Layout>
    );
}
