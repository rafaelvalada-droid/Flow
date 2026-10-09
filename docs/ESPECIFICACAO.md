# Flow — Especificação funcional (versão 1.0)

## Propósito
Organizar demandas de trabalho oriundas de e-mails, atividades manuais ou reuniões, agrupadas por projeto; permitir planejamento, execução cronometrada, retorno ao e-mail de origem e assistência de escrita com Gemini.

## Identidade visual
- Nome: **Flow**.
- Cor primária: `#3268DC`.
- Navegação: barra lateral azul-marinho `#182B48`.
- Superfícies: branco `#FFFFFF` e fundo `#F6F8FC`.
- Cinco visões de trabalho — **Tarefas, Projetos, Agenda, Gmail, Alertas**. Não confundir com diferentes temas visuais nem com BI.

## Entidades
- **Projeto:** nome, cor, membros (futuramente), datas e preferências.
- **Tarefa:** título, descrição, projeto, status, prioridade, data de execução, horário, prazo final, vínculo ao Gmail, datas de criação/conclusão.
- **Subtarefa:** texto, ordem, concluída.
- **Sessão de trabalho:** início, fim, segundos acumulados; uma por intervalo de execução.
- **Vínculo Gmail:** assunto, remetente, endereço/ID da conversa; acesso depende da conta Google conectada.
- **Evento de agenda:** ID de evento no Google e vínculo com tarefa (fase posterior).
- **Regra de alerta:** tipo, antecedência, canal e destinatário (fase posterior).
- **Texto Gemini:** modo, rascunho original, resultado, aprovação; chamada somente mediante ação explícita.

## Regras do cronômetro
1. Um usuário deve ter no máximo um cronômetro ativo por vez; ao iniciar outro, o anterior é pausado.
2. O tempo é calculado por timestamps e continua consistente mesmo ao fechar e reabrir a aba.
3. Pausar encerra a sessão corrente; retomar cria uma nova sessão.
4. Concluir pausa a sessão ativa, marca o status e registra o horário de conclusão.
5. Reabrir a tarefa não apaga tempos passados.
6. A implementação local usa hora do dispositivo; futuramente o servidor será a referência para integridade e sincronização.

## Fluxo de e-mail
1. Usuário abre uma conversa no Gmail e clica em **Incluir no Flow**, ao lado do assunto (extensão Chrome instalada).
2. A extensão lê assunto/remetente quando disponíveis e a URL da conversa.
3. Uma caixa no próprio Gmail permite ajustar o título, escolher uma lista (projeto) e salvar a tarefa com o link capturado.
4. A extensão grava na base do Flow do mesmo perfil do Chrome por uma aba de apoio, sem tirar o usuário do Gmail. Execução e prazo podem ser definidos depois no Flow.
5. Ao trabalhar na tarefa, pode iniciar o cronômetro e abrir a conversa Gmail em outra aba.
6. A resposta continua manual no Gmail na versão 1; o Flow não envia mensagens sem autorização expressa.

## Gemini
- Melhorar descrição, redigir resposta, sugerir subtarefas.
- A resposta pode ser revisada, aprovada, copiada ou descartada.
- Nunca afirmar conclusão, inventar respostas do setor ou prazos não registrados.
- Chamada de servidor; chave Gemini nunca é exposta no navegador.
- API Interactions com `store: false`, evitando armazenamento opcional de histórico de interações pelo serviço.

## V1 local
- HTML/CSS/JavaScript sem dependências e `localStorage`.
- Exportação/importação JSON para backup.
- Exportação manual `.ics` por tarefa para Google Agenda.
- API Gemini opcional e protegida por segredo distinto da chave Gemini.
- Extensão Chrome Manifest V3.

## Etapa institucional (ainda não implementada)
- Autenticação Google OAuth / login corporativo.
- Banco PostgreSQL por usuário com controle de acesso, backup e trilhas de auditoria.
- Google Calendar API com criação, atualização, cancelamento e deduplicação de eventos.
- Integração Gmail via OAuth se for necessário ler/enviar rascunhos; revisar escopos e exigências de verificação.
- Notificações automáticas, filas/cron e gerenciamento de fuso horário.
- Políticas de proteção de dados, retenção, autorização e logs antes de usar dados acadêmicos reais.
