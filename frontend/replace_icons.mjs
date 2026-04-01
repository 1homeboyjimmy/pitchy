import fs from 'fs';
import path from 'path';

const ICON_MAP = {
  'Loader2': 'Loader',
  'Sparkles': 'Star',
  'Building2': 'Home',
  'Bot': 'Cpu',
  'Lightbulb': 'Zap',
  'Atom': 'Activity',
  'CheckCircle2': 'CheckCircle',
  'BarChart3': 'BarChart2',
  'ChevronDown': 'ChevronDown',
  'ChevronUp': 'ChevronUp',
  'ChevronRight': 'ChevronRight',
  'ChevronLeft': 'ChevronLeft',
  'ArrowUpRight': 'ArrowUpRight',
  'ArrowRight': 'ArrowRight',
  'HelpCircle': 'HelpCircle',
  'AlertTriangle': 'AlertTriangle',
  'Target': 'Crosshair',
  'Zap': 'Zap',
  'Plus': 'Plus',
  'MessageCircle': 'MessageCircle',
  'MessageSquare': 'MessageSquare',
  'Server': 'Server',
  'Key': 'Key',
  'RefreshCw': 'RefreshCw',
  'EyeOff': 'EyeOff',
  'Github': 'GitHub',
  'Settings': 'Settings',
  'Bell': 'Bell',
  'Palette': 'Framer', 
  'Save': 'Save',
  'Crown': 'Award', 
  'Home': 'Home',
  'MapPin': 'MapPin',
  'Clock': 'Clock',
  'LogOut': 'LogOut',
  'CheckIcon': 'Check',
  'GitBranch': 'GitBranch',
  'LayoutDashboard': 'Layout',
  'Send': 'Send',
  'Shield': 'Shield',
  'BookOpen': 'BookOpen',
  'Calendar': 'Calendar',
  'Trash2': 'Trash2',
  'Users': 'Users',
  'CreditCard': 'CreditCard',
  'Tag': 'Tag',
  'BarChart2': 'BarChart2',
  'Calculator': 'Grid',
  'ThumbsUp': 'ThumbsUp',
  'ThumbsDown': 'ThumbsDown',
  'Square': 'Square',
  'FileText': 'FileText',
  'Edit3': 'Edit3',
  'Mail': 'Mail',
  'Lock': 'Lock',
  'Eye': 'Eye',
  'Check': 'Check',
  'X': 'X',
  'User': 'User',
  'Info': 'Info',
  'Menu': 'Menu',
  'Link': 'Link',
  'ExternalLink': 'ExternalLink',
  'LucideIcon': 'Icon'
};

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next') {
        processDirectory(fullPath);
      }
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('lucide-react')) {
        let changed = false;
        
        // 1. Replace imports string
        const importRegex = /import\s+(?:type\s+)?{([^}]+)}\s+from\s+["']lucide-react["'];?/g;
        content = content.replace(importRegex, (match, importsStr) => {
          changed = true;
          let isTypeImport = match.includes('import type');
          let newImports = importsStr.split(',').map(s => {
            const trimmed = s.trim();
            if (!trimmed) return null;
            return ICON_MAP[trimmed] || trimmed; // Fallback to same name
          }).filter(Boolean);
          
          newImports = [...new Set(newImports)];
          
          if (isTypeImport) {
              return `import type { ${newImports.join(', ')} } from "react-feather";`;
          }
          return `import { ${newImports.join(', ')} } from "react-feather";`;
        });
        
        // 2. We must also replace the usage within the file
        if (changed) {
          for (const [oldName, newName] of Object.entries(ICON_MAP)) {
            if (oldName !== newName) {
              const wordRegex = new RegExp(`\\b${oldName}\\b`, 'g');
              content = content.replace(wordRegex, newName);
            }
          }
          fs.writeFileSync(fullPath, content, 'utf8');
          console.log(`Updated ${fullPath}`);
        }
      }
    }
  }
}

processDirectory('.');
