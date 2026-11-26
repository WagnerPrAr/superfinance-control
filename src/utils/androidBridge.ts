import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Utilitários nativos para portabilidade Android (Capacitor 7 + PWA fallback).
 */

export type ResolvedTheme = 'nordic-light' | 'obsidian-oled' | 'nordic-dark' | 'nordic-material';

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function isAndroidRuntime(): boolean {
  if (isNativeAndroid()) return true;
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

export function syncAndroidThemeColor(mood: 'good' | 'bad' | 'neutral', theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="theme-color"]');

  const map: Record<ResolvedTheme, Record<'good' | 'bad' | 'neutral', string>> = {
    'nordic-light': { good: '#eef7f3', bad: '#fbf0ed', neutral: '#f2f4f7' },
    'nordic-material': { good: '#ebf5f0', bad: '#faeeeb', neutral: '#eef2f6' },
    'obsidian-oled': { good: '#071410', bad: '#170a09', neutral: '#07090c' },
    'nordic-dark': { good: '#0d1c1b', bad: '#1e1316', neutral: '#10151c' },
  };

  const color = map[theme][mood];
  if (meta) {
    meta.setAttribute('content', color);
  }

  if (isNativeAndroid()) {
    const isLight = theme === 'nordic-light' || theme === 'nordic-material';
    void StatusBar.setBackgroundColor({ color }).catch(() => {});
    void StatusBar.setStyle({ style: isLight ? Style.Light : Style.Dark }).catch(() => {});
  }
}

/**
 * Registra interceptação segura do botão físico Voltar do Android (Capacitor + fallback WebView)
 */
export function registerAndroidBackHandler(onBack: () => boolean): () => void {
  let capHandle: { remove: () => Promise<void> } | null = null;
  let disposed = false;

  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('backButton', ({ canGoBack }) => {
      const handled = onBack();
      if (!handled && !canGoBack) {
        void CapApp.minimizeApp().catch(() => {});
      }
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
      } else {
        capHandle = listener;
      }
    });
  }

  if (typeof document === 'undefined') {
    return () => {
      disposed = true;
      void capHandle?.remove();
    };
  }

  const handler = (ev: Event) => {
    const handled = onBack();
    if (handled && typeof ev.preventDefault === 'function') {
      ev.preventDefault();
    }
  };
  document.addEventListener('backbutton', handler, false);
  return () => {
    disposed = true;
    void capHandle?.remove();
    document.removeEventListener('backbutton', handler, false);
  };
}

/**
 * Escuta eventos de segundo plano / retorno ao app / retorno de rede para sincronização automática.
 */
export function registerBackgroundSyncListeners(onTrigger: () => void): () => void {
  let disposed = false;
  let appStateHandle: { remove: () => Promise<void> } | null = null;
  let netHandle: { remove: () => Promise<void> } | null = null;

  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) onTrigger();
    }).then((h) => {
      if (disposed) void h.remove();
      else appStateHandle = h;
    });

    void Network.addListener('networkStatusChange', (status) => {
      if (status.connected) onTrigger();
    }).then((h) => {
      if (disposed) void h.remove();
      else netHandle = h;
    });
  }

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      onTrigger();
    }
  };
  const onOnline = () => onTrigger();

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }

  return () => {
    disposed = true;
    void appStateHandle?.remove();
    void netHandle?.remove();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
    }
  };
}
