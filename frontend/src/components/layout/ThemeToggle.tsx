import { useTheme } from '../../hooks/useTheme';
import { IconMoon, IconSun } from '../ui/Icons';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
    </button>
  );
}
