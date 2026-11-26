/**
 * Utilitários leves para portabilidade Android (Capacitor WebView / PWA).
 */

export type ResolvedTheme = 'nordic-light' | 'obsidian-oled' | 'nordic-dark' | 'nordic-material';

export function syncAndroidThemeColor(mood: 'good' | 'bad' | 'neutral', theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;

  const map: Record<ResolvedTheme, Record<'good' | 'bad' | 'neutral', string>> = {
    'nordic-light': { good: '#eef7f3', bad: '#fbf0ed', neutral: '#f2f4f7' },
    'nordic-material': { good: '#ebf5f0', bad: '#faeeeb', neutral: '#eef2f6' },
    'obsidian-oled': { good: '#071410', bad: '#170a09', neutral: '#07090c' },
    'nordic-dark': { good: '#0d1c1b', bad: '#1e1316', neutral: '#10151c' },
  };

  meta.setAttribute('content', map[theme][mood]);
}

export function isAndroidRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

/**
 * Registra interceptação segura do botão Voltar do Android (Capacitor / Cordova / WebView)
 */
export function registerAndroidBackHandler(onBack: () => boolean): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = (ev: Event) => {
    const handled = onBack();
    if (handled && typeof ev.preventDefault === 'function') {
      ev.preventDefault();
    }
  };
  document.addEventListener('backbutton', handler, false);
  return () => document.removeEventListener('backbutton', handler, false);
}
