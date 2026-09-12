import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => sessionStorage.getItem('pdfusion_theme') || 'studio');

  useEffect(() => {
    document.documentElement.classList.toggle('theme-blossom', theme === 'blossom');
    sessionStorage.setItem('pdfusion_theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'studio' ? 'blossom' : 'studio'));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
