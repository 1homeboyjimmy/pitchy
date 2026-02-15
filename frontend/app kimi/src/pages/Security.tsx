import { motion } from 'framer-motion';
import { Shield, Lock, Server, Key, Fingerprint, FileCheck } from 'lucide-react';
import { GlassCard, PageWrapper } from '../components/shared';

export function Security() {
  const features = [
    {
      icon: Lock,
      title: 'End-to-End Encryption',
      description: 'All data transmitted between your device and our servers is encrypted using TLS 1.3 with perfect forward secrecy.',
    },
    {
      icon: Server,
      title: 'Secure Infrastructure',
      description: 'Our infrastructure is hosted on SOC 2 Type II certified cloud providers with 24/7 security monitoring.',
    },
    {
      icon: Key,
      title: 'API Key Security',
      description: 'API keys are hashed using bcrypt and never stored in plain text. You can revoke keys at any time.',
    },
    {
      icon: Fingerprint,
      title: 'Two-Factor Authentication',
      description: 'Enable 2FA for an additional layer of security on your account using TOTP authenticator apps.',
    },
  ];

  const practices = [
    'Regular third-party security audits',
    'Automated vulnerability scanning',
    'Penetration testing by certified professionals',
    'Employee background checks and security training',
    'Incident response plan with 24/7 coverage',
    'Data backup with geographic redundancy',
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
          <span className="text-sm text-white/70">Security</span>
        </div>
        
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Security at Pitchy.pro
        </h1>
        
        <p className="text-lg text-white/60 max-w-xl mx-auto">
          We take security seriously. Learn how we protect your data and maintain the highest security standards.
        </p>
      </motion.section>

      {/* Security Features */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="mb-12"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature) => (
            <GlassCard key={feature.title} className="p-6">
              <div className="w-12 h-12 rounded-xl bg-pitchy-violet/20 flex items-center justify-center mb-4">
                <feature.icon className="w-6 h-6 text-pitchy-violet" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-white/60">{feature.description}</p>
            </GlassCard>
          ))}
        </div>
      </motion.section>

      {/* Security Practices */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="mb-12"
      >
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <FileCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Our Security Practices</h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {practices.map((practice, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-pitchy-violet mt-2 flex-shrink-0" />
                <span className="text-white/60">{practice}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.section>

      {/* Compliance */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="mb-12"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <GlassCard className="p-6 text-center">
            <div className="text-3xl font-bold text-white mb-2">SOC 2</div>
            <p className="text-sm text-white/50">Type II Certified</p>
          </GlassCard>
          <GlassCard className="p-6 text-center">
            <div className="text-3xl font-bold text-white mb-2">GDPR</div>
            <p className="text-sm text-white/50">Compliant</p>
          </GlassCard>
          <GlassCard className="p-6 text-center">
            <div className="text-3xl font-bold text-white mb-2">CCPA</div>
            <p className="text-sm text-white/50">Compliant</p>
          </GlassCard>
        </div>
      </motion.section>

      {/* Report Issue */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="text-center"
      >
        <GlassCard className="p-8 inline-block">
          <h2 className="text-xl font-bold text-white mb-2">
            Found a security issue?
          </h2>
          <p className="text-white/60 mb-4">
            We appreciate responsible disclosure. Please report vulnerabilities to our security team.
          </p>
          <a
            href="mailto:security@pitchy.pro"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-pitchy-violet text-white font-medium hover:bg-pitchy-violet/90 transition-colors"
          >
            <Shield className="w-4 h-4" />
            Report Security Issue
          </a>
        </GlassCard>
      </motion.section>
    </PageWrapper>
  );
}

export default Security;
