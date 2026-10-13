# Incluir no UlbraFlow — complemento Gmail para Android

Implementação preparada. A ativação na conta Google exige os passos abaixo. A extensão Chrome existente continua independente.

## 1. Preparar Supabase
No SQL Editor do mesmo projeto do UlbraFlow, execute `supabase/gmail-addon.sql` depois do `supabase/flow.sql` já instalado. Não use a chave service_role.

O banco guarda apenas SHA-256 da chave de conexão. O complemento envia a chave para `flow_gmail_capture_v2`, que calcula o SHA-256 no próprio banco: o hash guardado não serve como credencial. Conexões vencidas são apagadas ao criar uma chave e a cada validação bem-sucedida. A conexão dura 90 dias e pode apenas listar as áreas e acrescentar tarefas; não pode ler o conteúdo das tarefas existentes, excluí-las nem sobrescrever o workspace. A gravação trava a linha, incrementa a revisão e evita duplicação da mesma conversa, venha ela do celular, da extensão Chrome 1.5 ou da revisão da Entrada (`gmailThreadId`). Um UlbraFlow aberto com alterações antigas verá o conflito existente e deverá carregar a versão da nuvem, preservando seus dados pendentes.

### Atualização da chave (v2) e transição
1. Execute novamente `supabase/gmail-addon.sql` (é re-executável). Ele cria `flow_gmail_capture_v2` e mantém `flow_gmail_capture` (que recebe o hash) para complementos ainda não atualizados.
2. Substitua o `Code.gs` do projeto Apps Script por esta versão e salve. Em implantação de teste, a próxima abertura já usa o código novo; em publicação do Marketplace, crie uma nova versão em **Implantar → Gerenciar implantações** e atualize a configuração do app no SDK Google Workspace Marketplace.
3. Confirme no Gmail que Conectar e Salvar no UlbraFlow funcionam. As chaves atuais continuam válidas; não é preciso gerar outra.
4. Depois que todas as instalações estiverem atualizadas, remova a função antiga no SQL Editor:
   `drop function if exists public.flow_gmail_capture(text,text,jsonb);`
   Enquanto ela existir, quem obtiver o hash guardado ainda consegue capturar.

## 2. Criar projeto Apps Script
1. Abra https://script.google.com/ com a conta que usa o Gmail.
2. Crie um projeto chamado **Incluir no UlbraFlow**.
3. Cole `Code.gs` no editor.
4. Em Configurações do projeto, habilite a exibição de `appsscript.json`.
5. Substitua seu manifesto pelo arquivo `appsscript.json` desta pasta.
6. Associe a um projeto Google Cloud padrão nas configurações. Configure o consentimento OAuth e os usuários de teste conforme as regras da organização.
7. Em **Implantar → Testar implantações**, selecione **Google Workspace Add-on**, instale e autorize o complemento na conta de teste.
8. Valide no Gmail web primeiro. Para distribuição e disponibilidade no Gmail Android, configure o SDK Google Workspace Marketplace no projeto Cloud e publique uma aplicação privada da organização ou a distribuição permitida pelo administrador. Uma implantação de teste não equivale a uma publicação disponível para todos os usuários/dispositivos.

A conta @ulbra.br pode exigir aprovação do administrador para instalar ou publicar. Não é necessário criar uma API key do Gmail; o Google pede autorização OAuth das permissões do complemento. Não publique a chave de conexão na configuração do Marketplace.

## 3. Conectar ao UlbraFlow
1. No UlbraFlow, entre com Google, aguarde **Salvo na nuvem** e abra **Entrada → Conectar celular**.
2. Copie a chave recém-gerada. Ela é mostrada uma vez e substitui a conexão anterior.
3. Na página inicial do complemento Gmail, cole essa chave e toque em **Conectar**.
4. No Gmail Android, abra um e-mail e procure o ícone do complemento no fim da mensagem (a localização depende da versão do Gmail).
5. Escolha título, área e prazo em **AAAA-MM-DD**. Toque em **Salvar no UlbraFlow**.
6. Abra/atualize o UlbraFlow para carregar a tarefa da nuvem.

**Desconectar celular** no UlbraFlow revoga a chave. Desconectar apenas no complemento apaga a cópia local. A chave fica em User Properties, privada para cada usuário do complemento.

## Limites e validação
O complemento lê apenas os metadados da mensagem atual (assunto/remetente/identificação), sem ler o corpo ou enviar mensagens. Os IDs do evento (`thread-f:<decimal>`, `msg-f:<decimal>`) são convertidos para o hexadecimal minúsculo da Gmail API; IDs hexadecimais são aceitos como estão. O link usa authuser e `#all/<id>` para abrir a conversa na conta correta. Não agenda eventos automaticamente: informe a data de execução depois no UlbraFlow.

Os testes Node usam adaptadores de Apps Script e HTTP (`npm run test:gmail-addon`). `tests/gmail-addon-sql.mjs` executa este SQL em PostgreSQL descartável (PGlite), como descrito em `docs/ATIVACAO-GOOGLE.md`, com `FLOW_PGLITE_MODULE` apontando para o PGlite instalado fora do projeto. Eles não substituem a execução do SQL em PostgreSQL, a autorização OAuth ou um teste real no Gmail Android. Antes de liberar para a organização, confirme instalação no Android, conta correta, áreas, prazo, idempotência, revogação e conflito com uma aba UlbraFlow aberta.
