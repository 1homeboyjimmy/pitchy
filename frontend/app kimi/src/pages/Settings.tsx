import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Shield, 
  Sliders, 
  Key, 
  Globe, 
  Moon, 
  Check,
  Copy,
  Eye,
  EyeOff
} from 'lucide-react';
import { GlassCard, Button } from '../components/shared';
import { PageWrapper } from '../components/shared';

const tabs = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'preferences', label: 'Preferences', icon: Sliders },
  { id: 'api', label: 'API Keys', icon: Key },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [language, setLanguage] = useState('en');
  const [theme, setTheme] = useState('dark');
  const [notifications, setNotifications] = useState({
    email: true,
    analysis: true,
    updates: false,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const apiKey = 'pk_live_51H8x2mK3L9pQr7sT9vW2xYzA1bC4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5z';

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PageWrapper>
      {/* Header */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-8"
      >
        <h1 className="text-3xl sm:text-4xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-white/50">Manage your account and preferences</p>
      </motion.section>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar Tabs */}
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="lg:w-64 flex-shrink-0"
        >
          <div className="space-y-1">
            {tabs.map((tab) => (
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                whileHover={{ scale: 1.02, x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${
                  activeTab === tab.id
                    ? 'bg-pitchy-violet/20 text-white border border-pitchy-violet/30'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
              </motion.button>
            ))}
          </div>
        </motion.aside>

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex-1"
        >
          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold text-white mb-6">Profile Information</h2>
              
              <div className="space-y-5">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-pitchy-violet to-pitchy-cyan flex items-center justify-center text-2xl font-bold text-white">
                    JD
                  </div>
                  <div>
                    <Button variant="glass" size="sm">Change Avatar</Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">Full Name</label>
                    <input
                      type="text"
                      defaultValue="John Doe"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-pitchy-violet/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">Email</label>
                    <input
                      type="email"
                      defaultValue="john@example.com"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-pitchy-violet/50 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">Bio</label>
                  <textarea
                    rows={3}
                    placeholder="Tell us about yourself..."
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 transition-all resize-none"
                  />
                </div>

                <div className="pt-4">
                  <Button>Save Changes</Button>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold text-white mb-6">Security Settings</h2>
              
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-white mb-3">Change Password</h3>
                  <div className="space-y-3">
                    <input
                      type="password"
                      placeholder="Current password"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 transition-all"
                    />
                    <input
                      type="password"
                      placeholder="New password"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 transition-all"
                    />
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-pitchy-violet/50 transition-all"
                    />
                  </div>
                  <div className="mt-3">
                    <Button size="sm">Update Password</Button>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-sm font-medium text-white mb-3">Two-Factor Authentication</h3>
                  <div className="flex items-center justify-between p-4 rounded-xl bg-white/5">
                    <div>
                      <p className="text-white">Authenticator App</p>
                      <p className="text-sm text-white/50">Not enabled</p>
                    </div>
                    <Button variant="glass" size="sm">Enable</Button>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-sm font-medium text-white mb-3">Sessions</h3>
                  <div className="p-4 rounded-xl bg-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white">Current Session</p>
                        <p className="text-sm text-white/50">Chrome on macOS • IP 192.168.1.1</p>
                      </div>
                      <span className="px-2 py-1 rounded-full text-xs bg-emerald-500/20 text-emerald-400">
                        Active
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold text-white mb-6">Preferences</h2>
              
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-white mb-3">Language</h3>
                  <div className="flex gap-2">
                    {[
                      { id: 'en', label: 'English' },
                      { id: 'ru', label: 'Русский' },
                    ].map((lang) => (
                      <button
                        key={lang.id}
                        onClick={() => setLanguage(lang.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                          language === lang.id
                            ? 'bg-pitchy-violet text-white'
                            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-sm font-medium text-white mb-3">Theme</h3>
                  <div className="flex gap-2">
                    {[
                      { id: 'dark', label: 'Dark', icon: Moon },
                      { id: 'light', label: 'Light', icon: Globe },
                    ].map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                          theme === t.id
                            ? 'bg-pitchy-violet text-white'
                            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <t.icon className="w-4 h-4" />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-sm font-medium text-white mb-3">Notifications</h3>
                  <div className="space-y-3">
                    {[
                      { id: 'email', label: 'Email notifications' },
                      { id: 'analysis', label: 'Analysis completed' },
                      { id: 'updates', label: 'Product updates' },
                    ].map((item) => (
                      <div key={item.id} className="flex items-center justify-between">
                        <span className="text-white/70">{item.label}</span>
                        <button
                          onClick={() => setNotifications(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof notifications] }))}
                          className={`w-11 h-6 rounded-full transition-all relative ${
                            notifications[item.id as keyof typeof notifications] ? 'bg-pitchy-violet' : 'bg-white/20'
                          }`}
                        >
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                            notifications[item.id as keyof typeof notifications] ? 'left-6' : 'left-1'
                          }`} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          )}

          {/* API Keys Tab */}
          {activeTab === 'api' && (
            <GlassCard className="p-6">
              <h2 className="text-xl font-semibold text-white mb-6">API Keys</h2>
              
              <div className="space-y-6">
                <div>
                  <p className="text-white/60 mb-4">
                    Use this key to access the Pitchy.pro API. Keep it secure and never share it publicly.
                  </p>
                  
                  <div className="relative">
                    <div className="flex items-center gap-2 p-4 rounded-xl bg-white/5 border border-white/10 font-mono text-sm">
                      <span className="text-white/70 truncate flex-1">
                        {showApiKey ? apiKey : 'pk_live_••••••••••••••••••••••••••••••••'}
                      </span>
                      <button
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4 text-white/50" /> : <Eye className="w-4 h-4 text-white/50" />}
                      </button>
                      <button
                        onClick={handleCopy}
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-white/50" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h3 className="text-sm font-medium text-white mb-3">Rate Limits</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-white/5">
                      <p className="text-2xl font-bold text-white font-mono-numbers">100</p>
                      <p className="text-sm text-white/50">Requests per minute</p>
                    </div>
                    <div className="p-4 rounded-xl bg-white/5">
                      <p className="text-2xl font-bold text-white font-mono-numbers">10K</p>
                      <p className="text-sm text-white/50">Requests per day</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <Button variant="ghost" className="text-red-400 hover:text-red-300">
                    Revoke API Key
                  </Button>
                </div>
              </div>
            </GlassCard>
          )}
        </motion.div>
      </div>
    </PageWrapper>
  );
}

export default Settings;
