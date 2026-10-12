# Entrada unificada: Gmail e registros manuais

## Ativação
1. Google Cloud: no projeto do cliente OAuth que o Supabase usa, ative **Gmail API** em APIs e serviços → Biblioteca. É o projeto da conexão Google do Ulbraflow, não necessariamente o projeto Apps Script.
2. Vercel → projeto do Ulbraflow → Environment Variables: adicione **GEMINI_API_KEY**, tipo **Secret**, ambiente **Production**. Cole a chave da API Gemini. Salve e faça Redeploy. Opcional: GEMINI_REVIEW_MODEL (padrão gemini-2.5-flash).
3. No Ulbraflow: Entrada → Conectar leitura do Gmail. Autorize a mesma conta do Ulbraflow. O escopo gmail.modify permite leitura, arquivamento e envio. A organização pode controlar essa autorização. Não forneça a chave Gemini ao navegador nem ao Apps Script.

A análise nova usa a sessão Google/Supabase verificada e não precisa de FLOW_AI_ACCESS_TOKEN. O assistente antigo nas descrições mantém seu mecanismo de acesso separado.

## Comportamento
- Entrada reúne a caixa de entrada Gmail e registros manuais sem classificação completa.
- Adicionar entrada registra uma demanda sem e-mail. Área e prazo classificam a demanda.
- A abertura da Entrada busca a primeira página de 25 conversas; há Carregar mais. As mensagens aparecem progressivamente com até quatro leituras em paralelo.
- Enquanto a Entrada está visível, há atualização a cada 30 segundos e ao voltar à aba. O Ulbraflow fechado não acompanha eventos de Gmail. Não há garantia de entrega instantânea; rede, autorização e cotas podem atrasar a leitura.
- A classificação Gemini acontece após a busca, sem bloquear a exibição dos e-mails. A primeira passagem analisa mensagens pendentes sequencialmente; próximas passagens usam o resultado salvo até chegar uma nova mensagem.
- Lê metadados e corpo das últimas três mensagens, no máximo 12 mil caracteres, sem anexos. Só envia esse texto, assunto e nomes/IDs de áreas ao Gemini. Corpos ficam em memória; resumo e classificação ficam no workspace privado.
- Resumo, título, área, alerta e prazo são sugestões. Um prazo só aparece com evidência literal e deve ser confirmado pelo usuário.
- A confirmação grava a tarefa primeiro. Arquivar no Gmail após salvar vem marcado e pode ser desmarcado. Só remove o rótulo INBOX depois de a nuvem confirmar; mantém o e-mail em Todos os e-mails. Falha de nuvem preserva a revisão e não arquiva.
- Novas respostas de uma conversa já vinculada atualizam a demanda existente após revisão; não duplicam tarefas. Respostas enviadas pelo próprio usuário não são tratadas como novas mensagens de entrada quando identificadas com SENT.
- A cor é escolhida por endereço de remetente e aplicada a todos os cartões desse remetente, inclusive mensagens futuras.
- Responder abre um formulário explícito de envio, com destinatário, texto e anexos até 10 MB no total. MIME UTF-8 inclui threadId, In-Reply-To e References. Não envia automaticamente nem inclui anexos na análise de IA.
- A leitura usa provider_token Google, que pode expirar. Nesse caso, reconecte o Gmail. Não há renovação Google em servidor ou notificações Pub/Sub nesta versão.

## Validação
`npm run test:gmail-review` exercita autenticação da análise, saída Gemini, Entrada manual, cache, confirmação, nova resposta sem duplicação, cores, envio com anexo, arquivamento e bloqueio de arquivamento quando a nuvem falha. Serviços Google/Gemini são simulados. Validação real ainda exige configuração, consentimento e um e-mail de teste.

## Rascunho de resposta e estabilidade

Cada e-mail indica se a análise Gemini já foi feita. Demandas aprovadas guardam a indicação de análise. Atualizações mantêm a posição da leitura, o foco e a seleção do texto dos campos, e não movem conversas existentes durante o carregamento.

Em Responder, escreva a ideia ou use Ditar ideia (SpeechRecognition do navegador, em pt-BR). O áudio não é salvo pelo Ulbraflow; o serviço de reconhecimento do navegador pode processá-lo. O navegador precisa suportar ditado e autorizar o microfone. Reescrever com Gemini gera texto editável; só Enviar resposta envia pelo Gmail. A reescrita usa a mesma GEMINI_API_KEY e a autorização verificada da análise. Os testes usam reconhecimento de voz simulado; o microfone real requer validação no dispositivo do usuário.
