# Flow — especificação funcional 1.3

## Propósito

Receber demandas de várias frentes, classificá-las por destino e urgência, organizar a execução em uma esteira comum e dedicar atenção a uma única tarefa por vez.

## Classificação antes da execução

As duas perguntas são **“Para onde vai?”** (área) e **“Para quando?”** (data/prazo). O catálogo solicitado é: Ubra IA; Oferta de turmas; Carga horária docente; Incidências em folha; Contratos docentes PJ; Folha docente; Plano docente; Operação lato sensu BreCIA; Pendências de pagamento PJ; Ubra S.A.; Suporte operacional; CPA Ubrecia; Capacitação. O singular/plural de contrato docente PJ representa uma única classificação.

Uma demanda sem área existente ou data válida permanece na **Entrada / A classificar**, mesmo que já tenha uma das respostas. A captura não atribui automaticamente a primeira área ou um prazo arbitrário. A classificação é condição para entrar em foco.

O prazo determina a urgência: atrasada, hoje, amanhã ou programada. A prioridade manual antiga é preservada nos dados, mas não governa a interface nem a ordenação. A execução planejada e o horário são opcionais e continuam separados do prazo final.

## Esteira única

Todas as tarefas, de qualquer área, compartilham **A classificar → A fazer → Em andamento → Aguardando → Concluídas**. Aguardando é uma situação operacional, não uma etapa obrigatória. A área acompanha a tarefa sem criar um fluxo independente. O filtro por área apenas restringe a visualização.

Uma linha conecta as etapas da esquerda para a direita. Avançar move para a próxima etapa sem iniciar o cronômetro. As tarefas são ordenadas pela data mais próxima em cada coluna. Mover etapa permite encaminhar ou reabrir uma demanda; o detalhe reúne contexto, subtarefas, histórico e vínculo ao Gmail. Em andamento pode ter várias demandas iniciadas ou pausadas; apenas uma pode estar em foco ativo.

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
- O relógio do dispositivo é a referência. Notificações do sistema não estão implementadas; o workspace autenticado é sincronizado com o Supabase.

## Dados e compatibilidade

Sem configuração Google, armazenamento local na chave `flow.workspace.v1`. Com Google/Supabase configurados, armazenamento privado por conta e cache na chave `flow.workspace.v1:<user-id>`. A versão de backup 1 é preservada. A importação da base local é explícita; contas novas não recebem tarefas alheias. A propriedade `projects` e o campo `task.project` representam as áreas na interface, mantendo IDs e vínculos antigos.

Tarefas mantêm título, descrição, situação, execução planejada, prazo, subtarefas, sessões e metadados Gmail. O campo adicional `focusCycles` guarda ciclos completos. `preferences.focusMinutes` e `preferences.breakMinutes` guardam o ritmo. `focus` guarda tarefa, fase (`work`, `break`, `ready`), término, tempo restante e duração.

A migração preserva áreas, tarefas, notas e sessões; acrescenta padrões de foco quando ausentes. Um cronômetro antigo ativo mantém sua sessão e recebe um ciclo contado a partir da migração. O catálogo é aplicado uma vez também às bases existentes, com o marcador `classificationCatalogVersion`. Áreas equivalentes conservam IDs, cores e vínculos. A Ouvidoria de exemplo, retirada das novas classificações, permanece em `archivedProjects` para resolver nomes, filtros e execução de tarefas anteriores. Áreas personalizadas não são removidas. Recarregamentos posteriores não restauram áreas deliberadamente retiradas.

## Gmail

A extensão Chrome 1.3 adiciona **Incluir no Flow** ao lado do assunto. A caixa permite ajustar o título e responder área e data. A tarefa salva entra na esteira comum com o assunto, remetente visível e link da conversa.

A extensão usa uma aba do Flow no mesmo perfil e domínio configurado, preservando a navegação no Gmail. Não lê o corpo da mensagem nem envia respostas. Retentativas da mesma captura não duplicam tarefas. Áreas removidas e datas inválidas são recusadas. Capturas de versões anteriores sem data permanecem compatíveis e ficam a classificar.

A instalação real é feita pelo usuário no Chrome desktop. O teste automatizado na nuvem usa Gmail simulado e adaptador para `chrome.*`, pois o Chromium gerenciado bloqueia extensões sem compactação.

## Identidade e navegação

O símbolo de caminhos convergindo para um ponto reúne fluxo operacional e atenção concentrada. Azul `#295F9B`, marinho `#182B48`, verde `#159B8B` e superfícies claras.

Navegação: Entrada, Esteira, Foco, Áreas, Agenda, Gmail, Alertas e Gestão do Tempo. Detalhe de tarefa é uma visão acessada a partir das demandas.

## Gestão do Tempo e relatórios

Dia, semana e mês, com navegação de períodos. Totais de trabalho efetivo, tarefas trabalhadas e área com maior dedicação; gráficos por hora/dia e distribuição por área; tabela de tempo por tarefa e sessões. Sessões são recortadas por período e divididas ao atravessar a meia-noite. Descansos ficam fora. A classificação atual e o fuso do dispositivo governam a análise. Tarefas excluídas não aparecem nos totais. Relatório CSV inclui duração legível e segundos; impressão permite salvar PDF.

## Acesso, dados e Agenda

Entrar com Google usa OAuth PKCE e identidade verificada pelo Supabase. O SQL em `supabase/flow.sql` contém RLS e uma função que deriva o dono da sessão. Revisões impedem sobreposição silenciosa entre dispositivos; falhas mantêm dados pendentes. A configuração está em [ATIVACAO-GOOGLE.md](ATIVACAO-GOOGLE.md). Esses serviços exigem ativação externa, não são simulados na aplicação.

Google Agenda pede consentimento separado. Cria/atualiza eventos privados no calendário principal pela data de execução; prazo final separado na descrição. Sem horário é dia inteiro; com horário usa a duração do foco. Retirar data ou excluir remove somente eventos próprios do Flow. Sincroniza com a aba aberta; expiração exige reconexão. A exportação .ics continua disponível.

A extensão 1.3 seleciona a base da conta ativa e espera confirmação de nuvem antes de afirmar sucesso. Sem autenticação ativa em um ambiente que exige Google, orienta entrar no Flow.

Gemini permanece opcional, com chave no servidor, acionamento por clique e revisão. Alertas salvam preferências sem envio ativo. A interface usa cinza claro no conjunto e destaques grafite com letras brancas, inclusive no acesso, na esteira, no foco, na agenda e na Gestão do Tempo. As cores das áreas ficam preservadas nos dados; a apresentação usa indicadores neutros. A impressão/PDF usa fundo claro e texto escuro. O slogan foi retirado, e a marca Ulbra está no acesso e na barra superior.
