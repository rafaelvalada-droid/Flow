# Renovação automática do Gmail e da Agenda

O UlbraFlow solicita acesso offline e renova o token Google antes de expirar ou após uma resposta HTTP 401. Gmail e Agenda compartilham a renovação, mas mantêm suas conexões separadas. Falhas temporárias não apagam as conexões. O servidor verifica a sessão Supabase e a identidade Google antes de devolver o novo acesso.

## Configuração na Vercel

No projeto Flow, abra **Settings → Environment Variables**, selecione **Production** e cadastre como **Secret**:

- `GOOGLE_CLIENT_ID`: o Client ID do mesmo cliente OAuth web usado em **Supabase → Authentication → Sign In / Providers → Google**.
- `GOOGLE_CLIENT_SECRET`: o Client Secret desse mesmo cliente OAuth.

Esses valores vêm de **Google Cloud → Google Auth Platform → Clients**. Não são a chave Gemini. Não envie o secret por chat nem o coloque em arquivos do repositório. Depois de salvar, faça **Redeploy** da implantação de produção.

Não é necessário mudar SQL, criar tabelas ou adicionar uma chave Supabase de serviço. `/api/auth-config` informa apenas `googleRefreshConfigured`, sem expor as credenciais.

## Autorizações existentes

Depois da configuração, reconecte uma vez o Gmail e a Agenda que já estavam autorizados para obter o acesso offline. As próximas aberturas reutilizam a sessão e renovam o acesso automaticamente, sem nova tela de consentimento na expiração normal.

Revogação da autorização, regras da organização ou expiração do refresh token podem exigir nova conexão. Em aplicativos OAuth externos no modo Testing, o Google normalmente limita refresh tokens com estes escopos a sete dias; confira o status de publicação no Google Auth Platform.

## Verificação

`npm run test:google-refresh` verifica identidade, expiração, concorrência Gmail/Agenda, reabertura, sessão Supabase, falhas temporárias e revogação com respostas simuladas. Os testes não usam contas Google reais.
