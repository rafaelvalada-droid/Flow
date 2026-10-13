# Ativar Google, armazenamento e Agenda no UlbraFlow

O código está preparado. A ativação requer um projeto Supabase e um cliente OAuth Google da sua conta. Até configurar, o site continua usando os dados deste navegador. Nenhuma chave fictícia ativa login ou nuvem.

## 1. Criar o banco no Supabase

1. Acesse https://supabase.com/dashboard e crie um projeto.
2. Abra **SQL Editor → New query**. Copie todo o conteúdo de [supabase/flow.sql](../supabase/flow.sql) e execute.
3. Em **Authentication → URL Configuration**, configure:
   - **Site URL:** `https://flow-blue-theta.vercel.app`
   - **Redirect URLs:** `https://flow-blue-theta.vercel.app/`
4. Anote a **Project URL** e a chave **publishable** em **Project Settings → API / API Keys**. A chave `anon` legada também funciona. **Nunca use secret ou service_role no UlbraFlow.**

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

Faça **Redeploy** do último deployment. Variáveis novas só entram em um deployment novo. Com valores incompletos ou inválidos, o UlbraFlow bloqueia a abertura do workspace e mostra o erro de configuração.

## 4. Entrar e recuperar as tarefas anteriores

1. Abra https://flow-blue-theta.vercel.app/ e clique em **Entrar com Google**.
2. A conta nova começa sem tarefas de exemplo ou tarefas de outra pessoa.
3. Clique no botão da conta na barra superior → **Trazer tarefas deste navegador**. Essa ação acrescenta os dados antigos à conta atual e preserva a base anterior. Cronômetros importados ficam pausados. Outra opção é importar um backup JSON em **Dados do UlbraFlow**.
4. Confira **Salvo na nuvem**. Se houver erro, a cópia local fica pendente; use **Tentar salvar agora**. Em conflito entre dispositivos, exporte um backup e escolha **Carregar versão da nuvem**; a cópia anterior também é preservada no navegador.

Os dados de tarefas, notas, subtarefas e sessões ficam no Supabase. Este navegador guarda uma cópia por ID de usuário e a sessão autenticada. Sair remove a sessão e bloqueia a interface; preserva caches e pendências para não perder trabalho. Em computador compartilhado, os caches continuam acessíveis ao proprietário do perfil do navegador. Limpeza de dados do navegador apaga cópias locais e pendências ainda não sincronizadas.

## 5. Conectar Google Agenda

1. Abra **Agenda → Conectar Google Agenda**.
2. Escolha **a mesma conta Google do UlbraFlow** e autorize o acesso.
3. Informe **data de execução** e, se necessário, **horário** no detalhe da tarefa.

O UlbraFlow cria eventos privados no calendário principal enquanto está aberto. A data de execução determina o evento; o prazo final fica separado na descrição. Com horário, a duração usa o ciclo de foco configurado. Sem horário, o evento ocupa o dia inteiro. Editar atualiza o mesmo evento; retirar a data de execução ou excluir a tarefa remove somente o evento identificado como pertencente ao UlbraFlow. Concluir mantém o planejamento/histórico do evento.

**Sincronizar agora** repete a operação com segurança, sem duplicar eventos. O acesso Google é renovado automaticamente conforme [Renovação Google](RENOVACAO-GOOGLE.md). Uma autorização revogada precisa de reconexão. Não há sincronização com a aba fechada. Desconectar encerra a sincronização local e preserva os eventos já criados; para revogar acesso no Google, use as configurações de segurança da conta Google. Alterações feitas diretamente na Agenda não são importadas para o UlbraFlow.

## Gmail e Gestão do Tempo

Atualize a extensão para **1.3**: baixe o ZIP novo, substitua os arquivos da pasta instalada, recarregue a extensão em `chrome://extensions` e recarregue o Gmail. Entre no UlbraFlow antes de capturar. Em modo conectado, a extensão só confirma “salvo” depois da resposta da nuvem.

**Gestão do Tempo** mostra dia, semana e mês, distribuição por área, sessões e tempo por tarefa. **Gerar relatório** baixa CSV ou abre a impressão para salvar PDF. A análise usa as sessões registradas, divide o tempo entre os dias e exclui descansos. Usa o fuso do dispositivo e a área atual da tarefa. Não conserva tempo de tarefas excluídas.

## Validação técnica

`npm run check`, `npm run test:workflow`, `npm run test:app`, `npm run test:cloud`, `npm run test:time` e `npm run test:extension`. Os testes de app/cloud/time precisam do servidor local ativo. Supabase/Google e Gmail/Chrome são simulados nos testes de navegador; não validam consentimento de uma conta real.

Para validar SQL e isolamento em PostgreSQL descartável, sem adicionar dependências ao aplicativo:

```bash
npm install --prefix /tmp/flow-sql-check @electric-sql/pglite@0.5.8 --ignore-scripts --no-audit --no-fund
FLOW_PGLITE_MODULE=/tmp/flow-sql-check/node_modules/@electric-sql/pglite/dist/index.js node tests/schema-policy.mjs
```

Esse teste executa a política e a função reais em PGlite com identidades de teste, conferindo leitura privada, escrita, conflitos e acesso anônimo. Não executa nada em um projeto Supabase real. Após configurar o projeto, valide com duas contas Google: uma conta não deve enxergar as tarefas da outra, e uma nova sessão da mesma conta deve recuperar o trabalho salvo.
