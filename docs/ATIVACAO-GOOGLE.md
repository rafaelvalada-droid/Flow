# Ativar Google, armazenamento e Agenda no UlbraFlow

O código está preparado. A ativação requer um projeto Supabase e um cliente OAuth Google da sua conta. Até configurar, o site continua usando os dados deste navegador. Nenhuma chave fictícia ativa login ou nuvem.

## 1. Criar o banco no Supabase

1. Acesse https://supabase.com/dashboard e crie um projeto.
2. Abra **SQL Editor → New query**. Copie todo o conteúdo de [supabase/flow.sql](../supabase/flow.sql) e execute. O arquivo pode ser executado de novo com segurança; faça isso também em projetos antigos para criar a cota diária da IA (`flow_ai_quota_hit`).
3. Em **Authentication → URL Configuration**, configure:
   - **Site URL:** `https://flow-blue-theta.vercel.app`
   - **Redirect URLs:** `https://flow-blue-theta.vercel.app/`
4. Anote a **Project URL** e a chave **publishable** em **Project Settings → API / API Keys**. A chave `anon` legada também funciona. **Nunca use secret ou service_role no UlbraFlow.**

5. Em **Authentication → Sign In / Providers**, desative o provedor **Email** e **Allow anonymous sign-ins**. Mantenha somente o Google. Com cadastro por e-mail ativo, qualquer pessoa poderia criar uma conta no seu projeto. Se apenas pessoas já cadastradas usarão o UlbraFlow, depois do primeiro login delas desative também **Allow new users to sign up**.

Cada conta autenticada tem uma linha própria em `public.flow_workspaces`. A política de leitura usa `auth.uid()`; a função de salvamento deriva o dono da sessão, sem receber um ID de usuário do navegador. Revisões impedem que uma aba substitua silenciosamente o trabalho salvo por outra.

## 2. Configurar o Google

1. Em https://console.cloud.google.com, crie ou selecione um projeto.
2. Ative **Google Calendar API** em **APIs e serviços → Biblioteca**.
3. Em **Google Auth Platform**, configure a tela de consentimento. Se o aplicativo estiver em teste, inclua seu e-mail em **Test users**. Use o escopo `https://www.googleapis.com/auth/calendar.events` para Agenda; o UlbraFlow só o solicita quando você clicar em conectar a Agenda.
4. Em **Clients / Credenciais**, crie um cliente OAuth do tipo **Web application**.
5. Configure a origem JavaScript autorizada `https://flow-blue-theta.vercel.app` e a URI de redirecionamento autorizada que aparece no provedor Google do Supabase:
   `https://SEU-PROJETO.supabase.co/auth/v1/callback`
6. No Supabase, abra **Authentication → Sign In / Providers → Google**, ative o provedor e informe **Client ID** e **Client Secret** do Google. Salve.

O Client Secret fica no provedor Supabase. Não coloque esse segredo no GitHub, no frontend ou em mensagens de chat. Quando a aplicação sair do modo de teste, a política de publicação/verificação OAuth do Google pode exigir a configuração adicional apresentada pelo próprio Google.

## 3. Ativar na Vercel

Abra o projeto do UlbraFlow em **Settings → Environment Variables** e configure para Production:

| Nome | Valor |
| --- | --- |
| `SUPABASE_URL` | Project URL do seu projeto |
| `SUPABASE_PUBLISHABLE_KEY` | Chave publishable (não secret/service_role) |
| `FLOW_REQUIRE_AUTH` | `true` |
| `FLOW_ALLOWED_EMAILS` | Recomendado. E-mails e/ou domínios separados por vírgula, como `chefe@exemplo.com,@ulbra.br` |
| `FLOW_AI_DAILY_LIMIT` | Opcional. Usos da IA por conta e por dia; padrão `300` |

A IA (`/api/gmail-review`) e a renovação Google (`/api/google-token`) só atendem contas que entraram com Google. Com `FLOW_ALLOWED_EMAILS`, atendem apenas os e-mails listados ou os domínios iniciados por `@` (maiúsculas não importam; `@ulbra.br` não inclui subdomínios). Sem a variável, qualquer conta Google do projeto pode usar a IA, limitada pela cota diária. Excedida a cota, a IA responde “limite de usos da IA hoje” até a meia-noite de Brasília. Enquanto o SQL novo não for executado, a cota fica desligada e o log da função registra o aviso `flow_ai_quota_hit não existe`.

Faça **Redeploy** do último deployment. Variáveis novas só entram em um deployment novo. Com valores incompletos ou inválidos, o UlbraFlow bloqueia a abertura do workspace e mostra o erro de configuração.

## 4. Entrar e recuperar as tarefas anteriores

1. Abra https://flow-blue-theta.vercel.app/ e clique em **Entrar com Google**.
2. A conta nova começa sem tarefas de exemplo ou tarefas de outra pessoa.
3. Clique no botão da conta na barra superior → **Trazer tarefas deste navegador**. Essa ação acrescenta os dados antigos à conta atual e preserva a base anterior. Cronômetros importados ficam pausados. Outra opção é importar um backup JSON em **Dados do UlbraFlow**.
4. Confira **Salvo na nuvem**. Se houver erro, a cópia local fica pendente; use **Tentar salvar agora**. Quando outro dispositivo, outra aba ou o complemento do celular salvam antes, o UlbraFlow mescla as alterações automaticamente se elas não mexem no mesmo campo. Se mexem, aparece **Conflito de alterações**: exporte um backup e escolha **Carregar versão da nuvem**. A cópia anterior fica preservada neste navegador (somente a mais recente). O workspace na nuvem tem limite de 2 MB.

Os dados de tarefas, notas, subtarefas e sessões ficam no Supabase. Este navegador guarda uma cópia por ID de usuário e a sessão autenticada. Sair remove a sessão e bloqueia a interface; preserva caches e pendências para não perder trabalho. Em computador compartilhado, os caches continuam acessíveis ao proprietário do perfil do navegador. Limpeza de dados do navegador apaga cópias locais e pendências ainda não sincronizadas.

## 5. Conectar Google Agenda

1. Abra **Agenda → Conectar Google Agenda**.
2. Escolha **a mesma conta Google do UlbraFlow** e autorize o acesso.
3. Informe **data de execução** e, se necessário, **horário** no detalhe da tarefa.

O UlbraFlow cria eventos privados no calendário principal enquanto está aberto. A data de execução determina o evento; o prazo final fica separado na descrição. Com horário, a duração usa o ciclo de foco configurado. Sem horário, o evento ocupa o dia inteiro. Editar atualiza o mesmo evento; retirar a data de execução ou excluir a tarefa remove somente o evento identificado como pertencente ao UlbraFlow. Concluir mantém o planejamento/histórico do evento.

**Sincronizar agora** repete a operação com segurança, sem duplicar eventos. O acesso Google é renovado automaticamente conforme [Renovação Google](RENOVACAO-GOOGLE.md). Uma autorização revogada precisa de reconexão. Não há sincronização com a aba fechada. Desconectar encerra a sincronização local e preserva os eventos já criados. Ao desconectar a última integração (Gmail ou Agenda) e ao sair da conta, o UlbraFlow apaga os tokens Google do navegador e revoga a autorização no Google; reconectar pede o consentimento de novo. A revogação vale para a autorização da conta Google inteira, então Gmail e Agenda de outros aparelhos também pedirão reconexão. Alterações feitas diretamente na Agenda não são importadas para o UlbraFlow.

## Gmail e Gestão do Tempo

Atualize a extensão para **1.5**: baixe o ZIP novo, substitua os arquivos da pasta instalada, recarregue a extensão em `chrome://extensions` e recarregue o Gmail. Entre no UlbraFlow antes de capturar. Em modo conectado, a extensão só confirma “salvo” depois da resposta da nuvem.

**Gestão do Tempo** mostra dia, semana e mês, distribuição por área, sessões e tempo por tarefa. **Gerar relatório** baixa CSV ou abre a impressão para salvar PDF. A análise usa as sessões registradas, divide o tempo entre os dias e exclui descansos. Usa o fuso do dispositivo e a área atual da tarefa. Não conserva tempo de tarefas excluídas.

## Segurança da publicação

`vercel.json` envia Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (microfone só para o próprio site, usado no ditado) e HSTS. A política só permite scripts do próprio site e conexões com `*.supabase.co`, Gmail, Google Agenda e o endpoint de revogação do Google. Se o Supabase usar um domínio próprio, acrescente-o em `connect-src`. `.vercelignore` publica apenas o que o app usa: testes, documentação, SQL, código do complemento e da extensão (distribuídos pelos ZIPs de `downloads/`) e o servidor local ficam fora. `/api/auth-config` fica em cache na CDN por 1 hora; um novo deploy limpa o cache.

## Validação técnica

`npm run check`, `npm run test:workflow`, `npm run test:app`, `npm run test:cloud`, `npm run test:time` e `npm run test:extension`. Os testes de app/cloud/time precisam do servidor local ativo. Supabase/Google e Gmail/Chrome são simulados nos testes de navegador; não validam consentimento de uma conta real.

Para validar SQL e isolamento em PostgreSQL descartável, sem adicionar dependências ao aplicativo:

```bash
npm install --prefix /tmp/flow-sql-check @electric-sql/pglite@0.5.8 --ignore-scripts --no-audit --no-fund
FLOW_PGLITE_MODULE=/tmp/flow-sql-check/node_modules/@electric-sql/pglite/dist/index.js node tests/schema-policy.mjs
```

Esse teste executa a política e as funções reais em PGlite com identidades de teste, conferindo leitura privada, escrita, conflitos, acesso anônimo e a cota diária da IA. Não executa nada em um projeto Supabase real. Após configurar o projeto, valide com duas contas Google: uma conta não deve enxergar as tarefas da outra, e uma nova sessão da mesma conta deve recuperar o trabalho salvo.
