import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, ChevronDown, MessageSquare } from 'lucide-react';
import { GlassCard, PageWrapper } from '../components/shared';

interface FAQProps {
  onNavigate?: (page: string) => void;
}

const faqs = [
  {
    question: 'How does the AI analyze startups?',
    answer: 'Our AI processes multiple data sources including public filings, market data, team backgrounds, product metrics, and competitive landscape. It uses machine learning models trained on thousands of startup outcomes to generate predictive scores across 5 key dimensions: Market, Team, Product, Traction, and Financials.',
  },
  {
    question: 'How accurate is the scoring system?',
    answer: 'Our models achieve 85-90% accuracy in predicting startup success based on historical validation. The 100-point scale provides granular insight, with scores above 75 indicating strong investment potential and scores below 50 suggesting high risk.',
  },
  {
    question: 'Can I analyze any startup?',
    answer: 'Yes, you can analyze any startup by entering its name or website URL. Our AI will gather publicly available information and generate a comprehensive report. For private companies with limited public data, the analysis may focus more on market opportunity and team background.',
  },
  {
    question: 'Is my data secure?',
    answer: 'Absolutely. We use enterprise-grade encryption for all data storage and transmission. Your analyses are private and never shared with third parties. We comply with GDPR and other privacy regulations.',
  },
  {
    question: 'What\'s included in the free plan?',
    answer: 'The free plan includes 5 startup analyses per month, basic scoring, and access to our AI chat interface. Premium plans unlock unlimited analyses, detailed reports, comparison tools, API access, and team collaboration features.',
  },
  {
    question: 'Can I export or share analyses?',
    answer: 'Yes, premium users can export analyses as PDF reports and share them with team members. You can also compare multiple startups side-by-side and track score changes over time.',
  },
  {
    question: 'How often should I re-analyze a startup?',
    answer: 'We recommend re-analyzing quarterly for active investment targets, or whenever significant news emerges (funding rounds, leadership changes, product launches). Our system can also alert you to important updates.',
  },
  {
    question: 'Do you offer API access?',
    answer: 'Yes, our Enterprise plan includes full API access for integrating startup scoring into your existing workflows, CRM systems, or investment platforms. Contact us for API documentation and pricing.',
  },
];

function FAQItem({ question, answer, isOpen, onClick }: { 
  question: string; 
  answer: string; 
  isOpen: boolean; 
  onClick: () => void;
}) {
  return (
    <GlassCard 
      className={`overflow-hidden ${isOpen ? 'border-pitchy-violet/30' : ''}`}
      hover={false}
    >
      <button
        onClick={onClick}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <span className="font-medium text-white pr-4">{question}</span>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0"
        >
          <ChevronDown className="w-5 h-5 text-white/50" />
        </motion.div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-5 pb-5 border-t border-white/10 pt-4">
              <p className="text-white/60 leading-relaxed">{answer}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

export function FAQ({ onNavigate }: FAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

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
          <HelpCircle className="w-4 h-4 text-pitchy-violet" />
          <span className="text-sm text-white/70">FAQ</span>
        </div>
        
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Frequently asked questions
        </h1>
        
        <p className="text-lg text-white/60 max-w-xl mx-auto">
          Everything you need to know about Pitchy.pro and AI-powered startup analysis.
        </p>
      </motion.section>

      {/* FAQ List */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="max-w-3xl mx-auto mb-16"
      >
        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === index}
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
            />
          ))}
        </div>
      </motion.section>

      {/* Contact CTA */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="text-center"
      >
        <GlassCard className="p-8 inline-block">
          <MessageSquare className="w-10 h-10 text-pitchy-violet mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">
            Still have questions?
          </h2>
          <p className="text-white/60 mb-4">
            Can't find the answer you're looking for? Reach out to our team.
          </p>
          <motion.button
            onClick={() => onNavigate?.('contact')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-6 py-2.5 rounded-xl bg-pitchy-violet text-white font-medium hover:bg-pitchy-violet/90 transition-colors"
          >
            Contact Support
          </motion.button>
        </GlassCard>
      </motion.section>
    </PageWrapper>
  );
}

export default FAQ;
