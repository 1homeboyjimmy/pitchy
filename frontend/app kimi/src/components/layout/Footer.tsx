import { motion } from 'framer-motion';
import { Sparkles, Twitter, Github, Linkedin, Mail } from 'lucide-react';

interface FooterProps {
  onNavigate?: (page: string) => void;
}

const footerLinks = {
  product: [
    { label: 'Features', page: 'landing' },
    { label: 'Pricing', page: 'pricing' },
    { label: 'API', page: 'settings' },
    { label: 'Analytics', page: 'analytics' },
  ],
  company: [
    { label: 'About', page: 'about' },
    { label: 'Blog', page: 'about' },
    { label: 'Careers', page: 'contact' },
    { label: 'Contact', page: 'contact' },
  ],
  resources: [
    { label: 'Documentation', page: 'faq' },
    { label: 'Help Center', page: 'faq' },
    { label: 'Community', page: 'about' },
    { label: 'Status', page: 'security' },
  ],
  legal: [
    { label: 'Privacy', page: 'privacy' },
    { label: 'Terms', page: 'terms' },
    { label: 'Security', page: 'security' },
  ],
};

const socialLinks = [
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
  { icon: Mail, href: '#', label: 'Email' },
];

export function Footer({ onNavigate }: FooterProps) {
  return (
    <footer className="relative border-t border-white/8">
      {/* Gradient top border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-pitchy-violet/50 to-transparent" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex items-center gap-2 mb-4"
            >
              <div className="relative w-8 h-8 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-pitchy-violet to-pitchy-cyan rounded-lg opacity-80" />
                <Sparkles className="w-4 h-4 text-white relative z-10" />
              </div>
              <span className="text-lg font-bold text-white tracking-tight">
                Pitchy<span className="text-pitchy-violet">.pro</span>
              </span>
            </motion.div>
            
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-sm text-white/50 mb-6 max-w-xs"
            >
              AI-powered startup analysis for modern investors and founders. 
              Evaluate any company in seconds.
            </motion.p>

            {/* Social Links */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-3"
            >
              {socialLinks.map((social) => (
                <motion.a
                  key={social.label}
                  href={social.href}
                  whileHover={{ scale: 1.1, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                  aria-label={social.label}
                >
                  <social.icon className="w-4 h-4" />
                </motion.a>
              ))}
            </motion.div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links], categoryIndex) => (
            <motion.div
              key={category}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 * (categoryIndex + 1) }}
            >
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
                {category}
              </h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <button
                      onClick={() => onNavigate?.(link.page)}
                      className="text-sm text-white/50 hover:text-white transition-colors"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Bottom Bar */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="mt-12 pt-8 border-t border-white/8 flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <p className="text-sm text-white/40">
            © {new Date().getFullYear()} Pitchy.pro. All rights reserved.
          </p>
          
          <div className="flex items-center gap-6">
            <button 
              onClick={() => onNavigate?.('privacy')}
              className="text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Privacy Policy
            </button>
            <button 
              onClick={() => onNavigate?.('terms')}
              className="text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Terms of Service
            </button>
            <button 
              onClick={() => onNavigate?.('security')}
              className="text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Security
            </button>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}

export default Footer;
