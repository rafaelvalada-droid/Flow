# Entrada unificada: Gmail e registros manuais

## Ativação
1. Google Cloud: no projeto do cliente OAuth que o Supabase usa, ative **Gmail API** em APIs e serviços → Biblioteca. É o projeto da conexão Google do UlbraFlow, não necessariamente o projeto Apps Script.
2. Vercel → projeto do UlbraFlow → Environment Variables: adicione **GEMINI_API_KEY**, tipo **Secret**, ambiente **Production**. Cole a chave da API Gemini. Salve e faça Redeploy. Opcional: GEMINI_REVIEW_MODEL (padrão gemini-2.5-flash).
3. No UlbraFlow: Entrada → Conectar leitura do Gmail. Autorize a mesma conta do UlbraFlow. O escopo gmail.modify permite leitura, arquivamento e envio. A organização pode controlar essa autorização. Não forneça a chave Gemini ao navegador nem ao Apps Script.

A análise nova usa a sessão Google/Supabase verificada e não precisa de FLOW_AI_ACCESS_TOKEN. O assistente antigo nas descrições mantém seu mecanismo de acesso separado.

## Comportamento
- Entrada reúne a caixa de entrada Gmail e registros manuais sem classificação completa.
- Adicionar entrada registra uma demanda sem e-mail. Área e prazo classificam a demanda.
- A abertura da Entrada busca a primeira página de 25 conversas; há Carregar mais. As mensagens aparecem progressivamente com até quatro leituras em paralelo.
- Enquanto a Entrada está visível, há atualização a cada 30 segundos e ao voltar à aba. O UlbraFlow fechado não acompanha eventos de Gmail. Não há garantia de entrega instantânea; rede, autorização e cotas podem atrasar a leitura.
- A classificação Gemini acontece após a busca, sem bloquear a exibição dos e-mails. A primeira passagem analisa mensagens pendentes sequencialmente; próximas passagens usam o resultado salvo até chegar uma nova mensagem. Conversas já incluídas na mesma mensagem (extensão 1.5, celular ou Entrada) não são reanalisadas.
- A lista lê só metadados (remetente, assunto, data e trecho). O corpo das últimas três mensagens, no máximo 12 mil caracteres e sem anexos, é baixado apenas para analisar uma mensagem ainda sem revisão ou ao abrir Responder. Abrir o app com tudo revisado não baixa corpos. O texto respeita o charset declarado (ISO-8859-1, Windows-1252), com UTF-8 como reserva. Só esse texto, assunto e nomes/IDs de áreas vão ao Gemini. Corpos ficam em memória.
- Retenção no workspace privado: o resumo e a classificação ficam enquanto a revisão está pendente, por até 30 dias. Ao incluir ou ignorar, a revisão passa a guardar apenas ID da mensagem, estado e data; o selo “Analisado com Gemini” fica na tarefa. O histórico mantém cerca de 500 revisões recentes, sempre preservando as conversas visíveis na caixa de entrada.
- Resumo, título, área, alerta e prazo são sugestões. Um prazo só aparece com evidência literal e deve ser confirmado pelo usuário.
- A confirmação grava a tarefa primeiro. Arquivar no Gmail após salvar vem marcado e pode ser desmarcado. Só remove o rótulo INBOX depois de a nuvem confirmar; mantém o e-mail em Todos os e-mails. Falha de nuvem preserva a revisão e não arquiva.
- Antes de arquivar, a conversa é conferida no Gmail. Se chegou uma mensagem nova depois da revisada, nada é arquivado e o aviso pede a revisão da resposta. Caso contrário, o rótulo INBOX sai apenas das mensagens conferidas (users.messages.batchModify): uma resposta que chegue durante o arquivamento continua na caixa de entrada.
- Novas respostas de uma conversa já vinculada atualizam a demanda existente após revisão; não duplicam tarefas. A conversa é reconhecida pelo ID da Gmail API (`gmailThreadId`), gravado também pela extensão Chrome 1.5 e pelo complemento do celular. Respostas enviadas pelo próprio usuário não são tratadas como novas mensagens de entrada quando identificadas com SENT.
- A cor é escolhida por endereço de remetente e aplicada a todos os cartões desse remetente, inclusive mensagens futuras.
- Responder abre um formulário explícito de envio, com destinatário, texto e anexos até 10 MB no total. MIME UTF-8 inclui threadId, In-Reply-To e References. Não envia automaticamente nem inclui anexos na análise de IA.
- A leitura renova automaticamente o acesso Google no servidor, preservando a conexão entre aberturas. Configure as credenciais conforme [Renovação Google](RENOVACAO-GOOGLE.md). Autorizações antigas precisam de uma reconexão para obter o refresh token. Não há notificações Pub/Sub nesta versão.

## Validação
`npm run test:gmail-review` exercita autenticação da análise, saída Gemini, Entrada manual, cache, confirmação, nova resposta sem duplicação, cores, envio com anexo, arquivamento e bloqueio de arquivamento quando a nuvem falha. `node --test tests/gmail-inbox.test.mjs` cobre leitura por metadados, corpo sob demanda, retenção das revisões, workspace atual durante a análise, charset e arquivamento com resposta nova. Serviços Google/Gemini são simulados. Validação real ainda exige configuração, consentimento e um e-mail de teste.

## Rascunho de resposta e estabilidade

Cada e-mail indica se a análise Gemini já foi feita. Demandas aprovadas guardam a indicação de análise. Atualizações mantêm a posição da leitura, o foco e a seleção do texto dos campos, e não movem conversas existentes durante o carregamento.

Em Responder, escreva a ideia ou use Ditar ideia (SpeechRecognition do navegador, em pt-BR). O áudio não é salvo pelo UlbraFlow; o serviço de reconhecimento do navegador pode processá-lo. O navegador precisa suportar ditado e autorizar o microfone. Reescrever com Gemini gera texto editável; só Enviar resposta envia pelo Gmail. A reescrita usa a mesma GEMINI_API_KEY e a autorização verificada da análise. Os testes usam reconhecimento de voz simulado; o microfone real requer validação no dispositivo do usuário.
