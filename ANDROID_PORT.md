# Portabilidade Android (Capacitor 7) & Segurança da Agenda

O projeto nativo Android já está gerado e sincronizado em `android/` (`br.com.superfinance.app`, Android SDK 35, Capacitor 7):

- **Plugins nativos integrados:** `@capacitor/app`, `@capacitor/browser`, `@capacitor/filesystem`, `@capacitor/network`, `@capacitor/preferences` e `@capacitor/status-bar`.
- **Segurança no Google Calendar (Conexão em Segundo Plano):**
  - Solicita **autorização explícita** do usuário na aba **Agenda** antes de conectar automaticamente ou criar o calendário financeiro separado (`SuperFinance — Alertas Financeiros`).
  - Usa escopo mínimo `https://www.googleapis.com/auth/calendar.app.created` (não lê nem altera eventos da agenda pessoal).
  - Credenciais e tokens OAuth são cifrados com **AES-GCM** no sandbox privado do app (`Capacitor Preferences`, `android:allowBackup="false"`), nunca gravados em `.txt` ou `.md`.
  - Para fila offline e auditoria em segundo plano, mantém o arquivo sanitizado `superfinance-calendar-sync.md` em `Directory.Data` (sandbox privado do app), contendo somente datas, títulos e status dos alertas.
- **Deep Link OAuth 2.0 PKCE Android:** `br.com.superfinance.app:/oauth2redirect` configurado em `android/app/src/main/AndroidManifest.xml`.

## Comandos de Build & APK

```bash
# Validar testes, build Vite e sincronizar bundle para android/
npm test && npm run cap:sync

# Gerar APK de depuração Android
npm run android:apk
```
