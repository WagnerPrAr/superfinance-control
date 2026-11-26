/**
 * Utilitários leves para portabilidade Android (Capacitor WebView / PWA).
 * Mantém 100% de compatibilidade com web padrão (GitHub Pages) sem exigir pacotes nativos em tempo de build web.
 */

export function syncAndroidThemeColor(mood: 'good' | 'bad' | 'neutral'): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const color = mood === 'good' ? '#eff8f4' : mood === 'bad' ? '#fcf2ef' : '#f7f6f2';
  meta.setAttribute('content', color);
}

export function isAndroidRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

/**
 * Registra interceptação segura do botão Voltar do Android (Capacitor / Cordova / WebView)
 * para fechar modais abertos antes de voltar de aba ou sair do app.
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
