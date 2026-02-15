import { motion } from 'framer-motion';
import { FileText, XCircle } from 'lucide-react';
import { GlassCard, PageWrapper } from '../components/shared';

export function Terms() {
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
          <FileText className="w-4 h-4 text-pitchy-violet" />
          <span className="text-sm text-white/70">Terms of Service</span>
        </div>
        
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Terms of Service
        </h1>
        
        <p className="text-lg text-white/60 max-w-xl mx-auto">
          Please read these terms carefully before using Pitchy.pro.
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
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">1. Acceptance of Terms</h2>
            <p className="text-white/60 leading-relaxed">
              By accessing or using Pitchy.pro, you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our services.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">2. Description of Service</h2>
            <p className="text-white/60 leading-relaxed">
              Pitchy.pro provides AI-powered startup analysis and scoring tools. Our service includes 
              startup evaluation, risk assessment, and investment recommendations based on publicly 
              available data and machine learning models.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">3. User Accounts</h2>
            <p className="text-white/60 leading-relaxed">
              You are responsible for maintaining the confidentiality of your account credentials 
              and for all activities that occur under your account. You agree to notify us immediately 
              of any unauthorized use of your account.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">4. Acceptable Use</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              You agree not to:
            </p>
            <ul className="space-y-2">
              {[
                'Use the service for any illegal purpose',
                'Attempt to gain unauthorized access to our systems',
                'Interfere with or disrupt the service',
                'Scrape or extract data from our platform',
                'Share your account credentials with others',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-white/60">
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">5. Intellectual Property</h2>
            <p className="text-white/60 leading-relaxed">
              All content, features, and functionality of Pitchy.pro are owned by us and protected 
              by international copyright, trademark, and other intellectual property laws. You may 
              not reproduce, distribute, or create derivative works without our permission.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">6. Disclaimer of Warranties</h2>
            <p className="text-white/60 leading-relaxed">
              Our AI-generated analyses and recommendations are for informational purposes only 
              and should not be considered as financial or investment advice. We make no warranties 
              about the accuracy, reliability, or completeness of any analysis.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">7. Limitation of Liability</h2>
            <p className="text-white/60 leading-relaxed">
              To the maximum extent permitted by law, Pitchy.pro shall not be liable for any 
              indirect, incidental, special, consequential, or punitive damages arising from your 
              use of the service.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">8. Changes to Terms</h2>
            <p className="text-white/60 leading-relaxed">
              We reserve the right to modify these terms at any time. We will notify users of 
              significant changes via email or through the service. Continued use after changes 
              constitutes acceptance of the new terms.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">9. Governing Law</h2>
            <p className="text-white/60 leading-relaxed">
              These terms shall be governed by and construed in accordance with the laws of 
              the State of Delaware, United States, without regard to conflict of law principles.
            </p>
          </GlassCard>

          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-white mb-4">10. Contact</h2>
            <p className="text-white/60 leading-relaxed">
              For questions about these terms, please contact us at{' '}
              <a href="mailto:legal@pitchy.pro" className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors">
                legal@pitchy.pro
              </a>
            </p>
          </GlassCard>
        </div>
      </motion.section>
    </PageWrapper>
  );
}

export default Terms;
