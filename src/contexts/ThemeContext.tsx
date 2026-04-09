import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { clearSvgCache } from '../utils/chem';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  /** Increments on every theme change. Use as a dependency to force SVG re-render. */
  themeVersion: number;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', toggleTheme: () => {}, themeVersion: 0 });

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try { localStorage.setItem('paretomol-theme', theme); } catch { /* storage unavailable */ }
  clearSvgCache();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('paretomol-theme');
      return stored === 'light' ? 'light' : 'dark';
    } catch { return 'dark'; }
  });
  const [themeVersion, setThemeVersion] = useState(0);

  // Apply on initial mount
  useEffect(() => { applyTheme(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      // Apply synchronously BEFORE React re-renders children
      // so getMolSvg() reads the correct isDark class and CSS variables
      applyTheme(next);
      return next;
    });
    setThemeVersion(v => v + 1);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themeVersion }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
