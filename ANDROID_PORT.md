# Portar SuperFinance para Android (Capacitor)

O projeto foi preparado e otimizado exclusivamente para mobile **Android**:
- Build Vite com `base: './'` compatível com o WebView local do Capacitor (`dist/`).
- `capacitor.config.ts` configurado (`br.com.superfinance.app`).
- `public/manifest.webmanifest` + meta tags Android (`viewport-fit=cover`, `theme-color` dinâmica).
- Alvos de toque mínimos de `48px` (Material Design 3), `touch-action: manipulation`, `overscroll-behavior-y: contain` e interceptação do botão físico **Voltar** do Android em `src/utils/androidBridge.ts`.

## Passos para gerar o projeto Android / APK

```bash
# 1. Instalar Capacitor CLI e runtime Android
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Gerar build de produção validado
npm test && npm run build

# 3. Criar a pasta android/ e sincronizar o bundle
npx cap add android
npx cap sync android

# 4. Abrir no Android Studio para gerar APK/AAB ou rodar no emulador/aparelho
npx cap open android
```
