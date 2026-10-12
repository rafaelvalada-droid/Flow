# Revisão do Ulbraflow — 12 de outubro de 2026

Foram revisados Entrada/Gmail, classificação e rascunhos Gemini, tarefas, áreas/projetos, esteira, foco, Agenda, sincronização, PDF, instalação no Android e captura pelas extensões. Esta revisão inclui correções no código e testes de regressão. Não usa e-mails reais nem credenciais de produção.

## Medições

Cenário de Gmail: Chromium, tela de 390 × 844, 25 conversas, respostas simuladas com atraso de 100 ms no Gmail e 60 ms na classificação. Os tempos incluem o carregamento local da interface; não representam a latência do Google em produção.

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Chamadas Gmail em atualização sem novidades | 27 | 1 |
| Conversas completas baixadas sem novidades | 25 | 0 |
| Início da primeira classificação | 3,3 s | 0,8 s |
| Lote completo classificado | 6,2 s | 2,7 s |
| Substituições de toda a tela durante o lote | 54 | 0 |

Quando apenas uma conversa muda, o teste incremental confirma que só essa conversa é baixada novamente e analisada. Histórico expirado ou muito grande usa leitura completa como alternativa. As páginas já carregadas são mantidas na atualização.

Cenário da esteira: mil tarefas locais, desktop 1440 × 1000. Elementos da página: aproximadamente 19.180 antes e 6.180 depois. A abertura foi de cerca de 498 ms para 363 ms em amostras locais; tempo varia com a carga da máquina. A redução de elementos é estável: os controles e detalhes são criados ao abrir cada cartão, preservando as mil tarefas e as contagens.

## Correções entregues

- Gmail usa `historyId` e histórico de alterações para evitar leituras redundantes. O conteúdo permanece apenas na memória da conta atual.
- A classificação começa assim que chega a primeira conversa e inclui novas mensagens na mesma fila, sem aumentar a concorrência de chamadas ao Gemini.
- Atualizações preservam cartões sem alterações, texto digitado, foco, cursor e posição de rolagem. Eventos próximos são agrupados por quadro de renderização.
- Desconectar a Agenda preserva a conexão do Gmail. O token compartilhado continua protegido pela sessão da conta.
- A Agenda não sincroniza novamente por alterações sem relação com os eventos. Uma edição feita durante uma chamada lenta fica agendada para a próxima sincronização, incluindo mudanças no prazo.
- Desconectar/resetar a leitura impede resultados antigos de serem salvos. Aprovar ou ignorar uma mensagem durante a análise não pode ser desfeito pela resposta tardia do Gemini.
- Uma sugestão Gemini de tarefa fica vinculada à tarefa e ao modo que originaram a chamada; não aparece em outro detalhe aberto enquanto a chamada estava pendente.
- A análise tem limite total de 50 segundos no servidor, inclusive nas tentativas de compatibilidade de modelo/API. A função dispõe de 60 segundos na Vercel; o navegador espera até 60 segundos.
- O assistente de tarefas aceita os dois formatos de texto da Interactions API e tem limites explícitos no navegador e na Vercel.
- O protocolo Gemini descoberto permanece em memória por cinco minutos mesmo quando a chamada seguinte encontra uma cota, evitando repetir uma chamada incompatível. Esse cache não é compartilhado entre instâncias da Vercel.
- PDF reutiliza fontes e imagens já carregadas na aba e permite tentar novamente quando um recurso falha. Fontes continuam carregadas apenas ao gerar PDF.
- O workspace é serializado uma vez ao persistir, reutilizando o texto na fila da nuvem. Dados idênticos pendentes não reiniciam o envio.
- Esteira agrupa tarefas em uma passagem e monta detalhes dos cartões sob demanda.
- O favicon usa o ícone pequeno já preparado, em vez de carregar novamente a imagem grande da marca.
- Node está fixado na linha 24, validada neste ambiente, para evitar mudanças automáticas de versão principal.
- Nome Ulbraflow e destaques dourados foram concluídos no site, manifesto, PDF e pacotes de captura; identificadores de dados, domínios e funções internas continuam compatíveis.

## Pontos para a próxima evolução

| Prioridade | Limite atual | Evolução recomendada |
| --- | --- | --- |
| Alta | E-mails são consultados a cada 30 segundos enquanto a Entrada está visível; não há processamento com o app fechado. | Gmail `watch`/Pub/Sub, histórico incremental no servidor e renovação da assinatura. Requer OAuth com renovação segura, configuração Google Cloud e processamento em servidor. |
| Alta | Gmail e Agenda usam token Google da sessão; quando expira, exigem reconexão. | Armazenar e renovar credenciais Google no servidor com controle por usuário e revogação. Renovar a sessão Supabase não renova o token Google. |
| Alta conforme crescimento | Todo o workspace é um JSON; o SQL limita o documento a 2 MB e protege concorrência por revisão. | Separar tarefas, sessões e revisões de e-mail em tabelas com RLS, índices e paginação. Planejar migração que preserve IDs e histórico. |
| Média | Gemini ainda pode retornar 429 conforme a cota; a fila pausa e mantém as análises já concluídas. | Fila com limite de chamadas conforme o modelo/projeto e tratamento de `Retry-After`. Medir primeiro os limites reais da chave. |
| Média | A imagem atual da marca tem cerca de 659 KB; a esteira ainda cria um cartão para cada tarefa. | Preparar a versão leve do logo escolhido e, com milhares de tarefas, paginação/virtualização. |
| Média | Conflitos entre dispositivos são informados e exigem revisão; não há mesclagem automática ou atualização remota contínua. | Sincronizar entidades individuais e considerar Supabase Realtime após a migração de dados. |
| Funcional | Preferências de alertas são salvas, mas o envio automático ainda não está ativo. | Agendamento no servidor, canal de envio e estado de entrega. |
| Funcional | O assistente no detalhe usa senha adicional; rascunhos na Entrada usam a conta autenticada. | Unificar o assistente sob a autenticação da conta, preservando a revisão antes de aplicar/enviar. |

## Validação

Passaram: verificação sintática; testes de regras, catálogo, tempo, autenticação, Agenda e assistente; captura Apps Script; testes de navegador para tarefas/foco, áreas/projetos, nuvem, Gmail, desempenho incremental, PDF, instalação PWA e extensão com adaptador Chrome.

Os testes confirmam preservação de IDs, migração de dados antigos, conflitos sem sobrescrita, salvamento confirmado antes de arquivar, respostas com anexos e ausência de duplicação. O PDF foi extraído com `pdftotext` e testado com 75 tarefas longas. A instalação foi verificada pelos critérios do Chromium e pela tela pública sem conexão.

Não foram medidos nesta revisão: latência do Google/Supabase com a conta real, faturamento/cotas da chave de produção, microfone físico, instalação nativa do complemento no Android, distribuição Google Workspace nem carregamento nativo da extensão no Chrome do usuário. Estes itens exigem a conta/aparelho e não devem ser confundidos com os serviços simulados.
