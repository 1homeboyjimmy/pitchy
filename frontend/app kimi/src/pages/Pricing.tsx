import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, Zap, Building2 } from 'lucide-react';
import { GlassCard, Button } from '../components/shared';

interface PricingProps {
  onNavigate?: (page: string) => void;
}

const plans = [
  {
    name: 'Free',
    description: 'For individual investors getting started',
    monthlyPrice: 0,
    yearlyPrice: 0,
    icon: Sparkles,
    features: [
      '5 analyses per month',
      'Basic scoring (0-100)',
      'AI chat interface',
      'Email support',
    ],
    cta: 'Get Started',
    popular: false,
  },
  {
    name: 'Pro',
    description: 'For active investors and analysts',
    monthlyPrice: 29,
    yearlyPrice: 290,
    icon: Zap,
    features: [
      'Unlimited analyses',
      'Detailed breakdowns',
      'Compare startups',
      'Export PDF reports',
      'Priority support',
      'API access',
    ],
    cta: 'Start Free Trial',
    popular: true,
  },
  {
    name: 'Enterprise',
    description: 'For VC firms and teams',
    monthlyPrice: null,
    yearlyPrice: null,
    icon: Building2,
    features: [
      'Everything in Pro',
      'Team collaboration',
      'Custom integrations',
      'Dedicated support',
      'SLA guarantee',
      'On-premise option',
    ],
    cta: 'Contact Sales',
    popular: false,
  },
];

export function Pricing({ onNavigate }: PricingProps) {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-6">
            <Sparkles className="w-4 h-4 text-pitchy-violet" />
            <span className="text-sm text-white/70">Pricing</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Simple, transparent pricing
          </h1>
          
          <p className="text-lg text-white/60 max-w-xl mx-auto mb-8">
            Start for free, upgrade when you need more power.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-3 p-1 rounded-xl bg-white/5 border border-white/10">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                !isYearly ? 'bg-pitchy-violet text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly ? 'bg-pitchy-violet text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              Yearly
              <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">
                Save 17%
              </span>
            </button>
          </div>
        </motion.section>

        {/* Pricing Cards */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2 + index * 0.1 }}
            >
              <GlassCard 
                className={`p-6 h-full flex flex-col ${plan.popular ? 'border-pitchy-violet/30' : ''}`}
                glow={plan.popular ? 'violet' : 'none'}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full bg-pitchy-violet text-white text-xs font-medium">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                    plan.popular ? 'bg-pitchy-violet/20' : 'bg-white/5'
                  }`}>
                    <plan.icon className={`w-6 h-6 ${plan.popular ? 'text-pitchy-violet' : 'text-white/60'}`} />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                  <p className="text-sm text-white/50">{plan.description}</p>
                </div>

                <div className="mb-6">
                  {plan.monthlyPrice !== null ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-white font-mono-numbers">
                        ${isYearly ? plan.yearlyPrice : plan.monthlyPrice}
                      </span>
                      <span className="text-white/50">
                        /{isYearly ? 'year' : 'month'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-white">Custom</div>
                  )}
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-white/70">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  variant={plan.popular ? 'primary' : 'glass'}
                  fullWidth
                  onClick={() => {
                    if (plan.name === 'Enterprise') {
                      onNavigate?.('contact');
                    } else if (plan.name === 'Free') {
                      onNavigate?.('signup');
                    } else {
                      onNavigate?.('signup');
                    }
                  }}
                >
                  {plan.cta}
                </Button>
              </GlassCard>
            </motion.div>
          ))}
        </motion.section>

        {/* FAQ Link */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12"
        >
          <p className="text-white/50">
            Have questions?{' '}
            <button
              onClick={() => onNavigate?.('faq')}
              className="text-pitchy-violet hover:text-pitchy-violet-light transition-colors"
            >
              Check our FAQ
            </button>
          </p>
        </motion.section>
      </div>
    </div>
  );
}

export default Pricing;
