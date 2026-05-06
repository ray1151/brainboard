import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-brand-hover transition-colors group relative"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
            {theme === 'dark' ? (
                <Sun className="w-5 h-5 text-brand-subtext group-hover:text-brand-primary transition-colors" />
            ) : (
                <Moon className="w-5 h-5 text-brand-subtext group-hover:text-brand-primary transition-colors" />
            )}
            <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] bg-brand-surface px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-brand-border shadow-lg">
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </span>
        </button>
    );
}
