import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, User, Sparkles, Github, Chrome, ArrowRight, Check } from 'lucide-react';
import { GlassCard, Button } from '../components/shared';

interface SignUpProps {
  onNavigate?: (page: string) => void;
  onSignUpSuccess?: () => void;
}

export function SignUp({ onNavigate }: SignUpProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) return;
    setIsLoading(true);
    // Simulate signup
    setTimeout(() => {
      setIsLoading(false);
      onNavigate?.('dashboard');
    }, 1500);
  };

  return (
    <div className="min-h-screen pt-20 pb-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-pitchy-violet to-pitchy-cyan mb-4 shadow-glow-primary">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-2 text-white/50">Start analyzing startups with AI</p>
        </motion.div>

        {/* Sign Up Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <GlassCard className="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all"
                    required
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 focus:ring-2 focus:ring-pitchy-violet/20 transition-all"
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-white/40">At least 8 characters</p>
              </div>

              {/* Terms */}
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setAgreed(!agreed)}
                  className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                    agreed
                      ? 'bg-pitchy-violet border-pitchy-violet'
                      : 'border-white/20 hover:border-white/40'
                  }`}
                >
                  {agreed && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
                <p className="text-sm text-white/50">
                  I agree to the{' '}
                  <button
                    type="button"
                    onClick={() => onNavigate?.('terms')}
                    className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors"
                  >
                    Terms of Service
                  </button>{' '}
                  and{' '}
                  <button
                    type="button"
                    onClick={() => onNavigate?.('privacy')}
                    className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors"
                  >
                    Privacy Policy
                  </button>
                </p>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                fullWidth
                loading={isLoading}
                disabled={!agreed}
                icon={<ArrowRight className="w-4 h-4" />}
                iconPosition="right"
              >
                Create Account
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[rgba(26,26,36,0.65)] text-white/40">Or sign up with</span>
              </div>
            </div>

            {/* Social Login */}
            <div className="grid grid-cols-2 gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all"
              >
                <Github className="w-5 h-5" />
                <span className="text-sm">GitHub</span>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all"
              >
                <Chrome className="w-5 h-5" />
                <span className="text-sm">Google</span>
              </motion.button>
            </div>
          </GlassCard>
        </motion.div>

        {/* Login link */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 text-center text-sm text-white/50"
        >
          Already have an account?{' '}
          <button
            onClick={() => onNavigate?.('login')}
            className="text-pitchy-violet hover:text-pitchy-violet-light font-medium transition-colors"
          >
            Sign in
          </button>
        </motion.p>
      </div>
    </div>
  );
}

export default SignUp;
