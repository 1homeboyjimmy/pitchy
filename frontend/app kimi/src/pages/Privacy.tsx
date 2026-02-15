import { motion } from 'framer-motion';
import { Shield, Lock, Eye, Database, Trash2 } from 'lucide-react';
import { GlassCard, PageWrapper } from '../components/shared';

export function Privacy() {
  const sections = [
    {
      icon: Eye,
      title: 'Information We Collect',
      content: `We collect information you provide directly to us, such as when you create an account, use our services, or contact us. This includes your name, email address, and any startup analyses you perform.

We also automatically collect certain information about your device and how you interact with our services, including IP address, browser type, and usage data.`,
    },
    {
      icon: Lock,
      title: 'How We Protect Your Data',
      content: `We use industry-standard encryption (TLS 1.3) for all data transmission. Your data is stored in secure, SOC 2 compliant data centers with 24/7 monitoring.

Access to your data is restricted to authorized personnel only, and all employees undergo background checks and security training.`,
    },
    {
      icon: Database,
      title: 'Data Usage',
      content: `We use your data to provide and improve our services, personalize your experience, and communicate with you about updates and features.

We do not sell your personal information to third parties. We may share anonymized, aggregated data for research and analytics purposes.`,
    },
    {
      icon: Trash2,
      title: 'Data Retention & Deletion',
      content: `We retain your data for as long as your account is active or as needed to provide services. You can request deletion of your account and associated data at any time.

Upon deletion request, we will remove your data within 30 days, except where retention is required by law.`,
    },
  ];

  return (
    <PageWrapper>
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-12"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-6">
          <Shield className="w-4 h-4 text-pitchy-violet" />
          <span className="text-sm text-white/70">Privacy Policy</span>
        </div>
        
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Privacy Policy
        </h1>
        
        <p className="text-lg text-white/60 max-w-xl mx-auto">
          Your privacy is important to us. This policy explains how we collect, use, and protect your data.
        </p>
        
        <p className="text-sm text-white/40 mt-4">
          Last updated: January 2025
        </p>
      </motion.section>

      {/* Content */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="max-w-3xl mx-auto"
      >
        <div className="space-y-6">
          {sections.map((section) => (
            <GlassCard key={section.title} className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-pitchy-violet/20 flex items-center justify-center flex-shrink-0">
                  <section.icon className="w-5 h-5 text-pitchy-violet" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white mb-2">{section.title}</h2>
                  <div className="text-white/60 whitespace-pre-line leading-relaxed">
                    {section.content}
                  </div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>

        {/* Contact */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 text-center"
        >
          <p className="text-white/50">
            Questions about privacy?{' '}
            <a href="mailto:privacy@pitchy.pro" className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors">
              Contact our privacy team
            </a>
          </p>
        </motion.div>
      </motion.section>
    </PageWrapper>
  );
}

export default Privacy;
