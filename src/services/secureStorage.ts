import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

const MASTER_KEY_STORAGE = 'sf_vault_mk_v1';
const SYNC_MD_FILENAME = 'superfinance-calendar-sync.md';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function rawGet(key: string): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
  } catch {
    // Fallback web storage
  }
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function rawSet(key: string, value: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key, value });
      return;
    }
  } catch {
    // Fallback web storage
  }
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage indisponível
  }
}

async function rawRemove(key: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key });
    }
  } catch {
    // Ignora falha nativa
  }
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignora falha web
  }
}

async function getOrCreateAesKey(): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  let b64Key = await rawGet(MASTER_KEY_STORAGE);
  if (!b64Key) {
    const rawKey = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    b64Key = bytesToBase64(rawKey);
    await rawSet(MASTER_KEY_STORAGE, b64Key);
  }
  const rawBytes = base64ToBytes(b64Key);
  return crypto.subtle.importKey('raw', rawBytes.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function saveSecureJson<T>(key: string, payload: T): Promise<void> {
  const plaintext = JSON.stringify(payload);
  try {
    const aesKey = await getOrCreateAesKey();
    if (aesKey && typeof crypto !== 'undefined') {
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv);
      const encoded = new TextEncoder().encode(plaintext);
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
      const envelope = JSON.stringify({
        v: 1,
        iv: bytesToBase64(iv),
        ct: bytesToBase64(new Uint8Array(cipherBuf)),
      });
      await rawSet(key, envelope);
      return;
    }
  } catch {
    // Fallback seguro apenas no sandbox privado do app
  }
  await rawSet(key, plaintext);
}

export async function loadSecureJson<T>(key: string): Promise<T | null> {
  const raw = await rawGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: number; iv?: string; ct?: string };
    if (parsed && parsed.v === 1 && parsed.iv && parsed.ct) {
      const aesKey = await getOrCreateAesKey();
      if (!aesKey) return null;
      const iv = base64ToBytes(parsed.iv);
      const ct = base64ToBytes(parsed.ct);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        aesKey,
        ct.buffer as ArrayBuffer,
      );
      return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export async function removeSecureItem(key: string): Promise<void> {
  await rawRemove(key);
}

/**
 * Grava o log sanitizado (sem tokens nem segredos) no diretório privado Directory.Data do Android
 * via Capacitor Filesystem, mantendo fallback em memória/Preferences na Web.
 */
export async function writePrivateMarkdownSyncLog(
  markdownContent: string,
): Promise<{ savedToNativeSandbox: boolean; pathLabel: string }> {
  await rawSet('sf_calendar_sync_md_snapshot_v1', markdownContent);

  try {
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({
        path: SYNC_MD_FILENAME,
        data: markdownContent,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return {
        savedToNativeSandbox: true,
        pathLabel: `Android App Sandbox (Directory.Data/${SYNC_MD_FILENAME})`,
      };
    }
  } catch {
    // Continua com snapshot privado em Preferences/localStorage
  }

  return {
    savedToNativeSandbox: false,
    pathLabel: `Armazenamento privado do navegador (${SYNC_MD_FILENAME})`,
  };
}

export function downloadSanitizedMarkdownLog(markdownContent: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = SYNC_MD_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
