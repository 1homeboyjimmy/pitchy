import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, MessageSquare, Send, Twitter, Linkedin, Github } from 'lucide-react';
import { GlassCard, Button, PageWrapper } from '../components/shared';

export function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Simulate submission
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
    }, 1500);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

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
          <MessageSquare className="w-4 h-4 text-pitchy-violet" />
          <span className="text-sm text-white/70">Contact</span>
        </div>
        
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Get in touch
        </h1>
        
        <p className="text-lg text-white/60 max-w-xl mx-auto">
          Have questions or feedback? We'd love to hear from you.
        </p>
      </motion.section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {/* Contact Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="lg:col-span-2"
        >
          <GlassCard className="p-6 sm:p-8">
            {submitted ? (
              <div className="text-center py-12">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                  className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4"
                >
                  <Send className="w-8 h-8 text-emerald-400" />
                </motion.div>
                <h3 className="text-xl font-bold text-white mb-2">Message sent!</h3>
                <p className="text-white/60">We'll get back to you within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      Name
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="Your name"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="you@example.com"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Subject
                  </label>
                  <select
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all appearance-none"
                    required
                  >
                    <option value="" className="bg-pitchy-bg">Select a topic</option>
                    <option value="general" className="bg-pitchy-bg">General Inquiry</option>
                    <option value="support" className="bg-pitchy-bg">Technical Support</option>
                    <option value="sales" className="bg-pitchy-bg">Sales & Enterprise</option>
                    <option value="partnership" className="bg-pitchy-bg">Partnership</option>
                    <option value="feedback" className="bg-pitchy-bg">Feedback</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Message
                  </label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="How can we help?"
                    rows={5}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all resize-none"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  fullWidth
                  loading={isSubmitting}
                  icon={<Send className="w-4 h-4" />}
                  iconPosition="right"
                >
                  Send Message
                </Button>
              </form>
            )}
          </GlassCard>
        </motion.div>

        {/* Contact Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="space-y-4"
        >
          <GlassCard className="p-6">
            <Mail className="w-6 h-6 text-pitchy-violet mb-3" />
            <h3 className="font-medium text-white mb-1">Email us</h3>
            <p className="text-sm text-white/60 mb-2">For general inquiries</p>
            <a 
              href="mailto:hello@pitchy.pro" 
              className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors"
            >
              hello@pitchy.pro
            </a>
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="font-medium text-white mb-3">Follow us</h3>
            <div className="flex gap-3">
              <motion.a
                href="#"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
              >
                <Twitter className="w-5 h-5" />
              </motion.a>
              <motion.a
                href="#"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
              >
                <Linkedin className="w-5 h-5" />
              </motion.a>
              <motion.a
                href="#"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
              >
                <Github className="w-5 h-5" />
              </motion.a>
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="font-medium text-white mb-2">Response time</h3>
            <p className="text-sm text-white/60">
              We typically respond within 24 hours during business days.
            </p>
          </GlassCard>
        </motion.div>
      </div>
    </PageWrapper>
  );
}

export default Contact;
