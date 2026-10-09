# Flow — especificação funcional 1.2

## Propósito

Receber demandas de várias frentes, classificá-las por destino e urgência, organizar a execução em uma esteira comum e dedicar atenção a uma única tarefa por vez.

## Classificação antes da execução

As duas perguntas são **“Para onde vai?”** (área) e **“Para quando?”** (data/prazo). Carga Horária, Folha Docente, Contratos PJ, CPA e Ouvidoria são exemplos de áreas. É possível criar novas áreas.

Uma demanda sem área existente ou data válida permanece na **Entrada / A classificar**, mesmo que já tenha uma das respostas. A captura não atribui automaticamente a primeira área ou um prazo arbitrário. A classificação é condição para entrar em foco.

O prazo determina a urgência: atrasada, hoje, amanhã ou programada. A prioridade manual antiga é preservada nos dados, mas não governa a interface nem a ordenação. A execução planejada e o horário são opcionais e continuam separados do prazo final.

## Esteira única

Todas as tarefas, de qualquer área, compartilham **A classificar → A fazer → Em andamento → Aguardando → Concluídas**. Aguardando é uma situação operacional, não uma etapa obrigatória. A área acompanha a tarefa sem criar um fluxo independente. O filtro por área apenas restringe a visualização.

As tarefas são ordenadas pela data mais próxima em cada coluna. Mover etapa permite encaminhar ou reabrir uma demanda; o detalhe reúne contexto, subtarefas, histórico e vínculo ao Gmail. Em andamento pode ter várias demandas iniciadas ou pausadas; apenas uma pode estar em foco ativo.

## Foco e Pomodoro

- Padrão de 25 minutos de foco e 5 de descanso; foco configurável de 1 a 180 minutos, pausa de 1 a 60 minutos.
- Iniciar uma tarefa encerra a sessão ativa de outra tarefa. Iniciar a mesma tarefa já ativa não cria sessão duplicada.
- Pausar encerra a sessão de trabalho, preserva o restante do ciclo e não conta tempo pausado. Retomar cria outra sessão usando o tempo restante.
- O fim do foco encerra a sessão exatamente no timestamp previsto e incrementa o número de ciclos completos da tarefa.
- O descanso começa automaticamente, sem registrar trabalho. É possível pausá-lo, retomá-lo ou escolher começar o próximo ciclo.
- Ao terminar a pausa, a interface fica pronta; trabalho só recomeça mediante ação do usuário.
- Fechar/reabrir a aba mantém o ciclo. Se foco e pausa já terminaram, a reconciliação registra apenas o foco previsto e não inicia sessões enquanto o usuário está ausente.
- Alterações no ritmo valem para o próximo período; o período atual mantém sua duração.
- Concluir ou excluir uma tarefa encerra seu foco. Reabrir não elimina históricos anteriores.
- O relógio do dispositivo é a referência nesta versão local. Notificações do sistema e sincronização com servidor não estão implementadas.

## Dados e compatibilidade

Armazenamento local na chave `flow.workspace.v1`, com versão de backup 1 preservada. A propriedade `projects` e o campo `task.project` representam as áreas na interface, mantendo IDs e vínculos antigos.

Tarefas mantêm título, descrição, situação, execução planejada, prazo, subtarefas, sessões e metadados Gmail. O campo adicional `focusCycles` guarda ciclos completos. `preferences.focusMinutes` e `preferences.breakMinutes` guardam o ritmo. `focus` guarda tarefa, fase (`work`, `break`, `ready`), término, tempo restante e duração.

A migração preserva áreas, tarefas, notas e sessões; acrescenta padrões de foco quando ausentes. Um cronômetro antigo ativo mantém sua sessão e recebe um ciclo contado a partir da migração. As novas áreas de exemplo não são inseridas automaticamente em bases existentes.

## Gmail

A extensão Chrome 1.2 adiciona **Incluir no Flow** ao lado do assunto. A caixa permite ajustar o título e responder área e data. A tarefa salva entra na esteira comum com o assunto, remetente visível e link da conversa.

A extensão usa uma aba do Flow no mesmo perfil e domínio configurado, preservando a navegação no Gmail. Não lê o corpo da mensagem nem envia respostas. Retentativas da mesma captura não duplicam tarefas. Áreas removidas e datas inválidas são recusadas. Capturas de versões anteriores sem data permanecem compatíveis e ficam a classificar.

A instalação real é feita pelo usuário no Chrome desktop. O teste automatizado na nuvem usa Gmail simulado e adaptador para `chrome.*`, pois o Chromium gerenciado bloqueia extensões sem compactação.

## Identidade e navegação

O símbolo de caminhos convergindo para um ponto reúne fluxo operacional e atenção concentrada. Azul `#295F9B`, marinho `#182B48`, verde `#159B8B` e superfícies claras.

Navegação: Entrada, Esteira, Foco, Áreas, Agenda, Gmail e Alertas. Detalhe de tarefa é uma visão acessada a partir das demandas.

## Integrações e etapas futuras

Gemini opcional melhora descrição, prepara resposta e sugere subtarefas mediante clique e revisão; a chave permanece no servidor. Agenda exporta `.ics`, sem sincronização automática. Alertas salvam preferências, sem envio ativo.

Login, banco de dados, sincronização entre dispositivos, Google OAuth, notificações e automação institucional permanecem etapas futuras. A modelagem SQL em `docs/schema-postgresql-futuro.sql` não está conectada à versão local.
