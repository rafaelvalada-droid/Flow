# Revisão do UlbraFlow — 13 de outubro de 2026

Revisão de segurança, gargalos e confiabilidade em cinco frentes: autenticação/nuvem/funções, interface (`app.js`), integrações Gmail (extensão, complemento e leitura da Entrada), regras de domínio (tarefas, foco, Agenda, relatórios) e desempenho. Os achados mais graves foram conferidos diretamente no código; os de desempenho foram medidos no Chromium com dados sintéticos e serviços Supabase/Gmail/Gemini simulados. Não foram usados e-mails reais nem credenciais de produção.

## Medições

Cenário sintético: 8 tarefas e 30 conversas por dia útil, Agenda conectada.

| Medida | Valor |
| --- | ---: |
| Crescimento do workspace com Gmail | ≈ 0,78 MB por mês |
| Tempo até o limite de 2 MB da nuvem | ≈ 2,5 meses (≈ 6 meses sem Gmail) |
| Parte do workspace ocupada por análises Gmail (3 meses) | 59 % |
| Envios completos ao digitar 96 caracteres (workspace de 0,8 MB) | 21 envios, 16,4 MB |
| Envios completos ao analisar 25 e-mails | 25 envios, 19,5 MB |
| Custo por tecla na descrição (0,8 MB / 2,3 MB / 4,6 MB) | 11 / 20 / 61 ms |
| Mesma medida com CPU 4× mais lenta (2,3 MB) | 102 ms |
| Abertura sem novidades no Gmail | 27 chamadas, 25 conversas completas, Entrada em 2,9 s |
| Logo do cabeçalho | 384 × 384 px, 120 KB, exibido a 32 px |

## Achados

### Segurança

| Gravidade | Achado | Onde |
| --- | --- | --- |
| Alta | XSS armazenado: nome de área/projeto, `focusCycles`, alertas e minutos de foco entravam no HTML sem escape; um backup importado ou um nome de área executava código com acesso à sessão e ao token Gmail. Reproduzido. | `app.js` (`pageHead`, Foco, Alertas) |
| Alta | A rota do Gemini aceitava qualquer sessão Supabase, sem lista de contas nem cota; com cadastro por e-mail ativo, terceiros poderiam consumir a chave. | `api/gmail-review.mjs` |
| Média | Desconectar Gmail/Agenda não apagava nem revogava o token Google; não havia CSP nem bloqueio de enquadramento. | `cloud.js`, `vercel.json` |
| Baixa | O hash do token do complemento funcionava como a própria credencial; tokens vencidos não eram apagados. | `gmail-addon/Code.gs`, `supabase/gmail-addon.sql` |
| Baixa | Servidor local servia `//.git/config`, `//.env.example` e `//docs/…` (conferido). | `server.mjs` |
| Baixa | A Vercel publicava testes, documentação, SQL e uma função auxiliar sem rota. | `vercel.json`, `api/project-plan.mjs` |

### Perda de dados e confiabilidade

| Gravidade | Achado |
| --- | --- |
| Alta | Análises do Gmail nunca eram apagadas; o workspace atingiria 2 MB e todo salvamento falharia com a mensagem enganosa "Verifique a conexão". |
| Alta | Importar um backup malformado salvava os dados antes de validar; o app deixava de abrir em todos os dispositivos. Reproduzido. |
| Alta | Capturas pelo complemento do celular incrementavam a revisão; a aba da extensão entrava em conflito e "Carregar nuvem" escondia a captura numa cópia de segurança. |
| Média | Duas abas em modo nuvem sempre geravam conflito. Reproduzido. |
| Média | Cópias `.backup:` nunca eram apagadas; com a cota do navegador cheia, a alteração não ia nem para o cache nem para a nuvem. |
| Média | Tarefa cujo evento foi apagado não voltava à Agenda; o erro interrompia a sincronização de todas as tarefas seguintes. |
| Média | Eventos órfãos após restaurar backup; arquivamento podia esconder resposta nova; capturas duplicadas entre extensão, Entrada e complemento; conflito falso após salvamento lento. |
| Baixa | Dados malformados impediam a abertura; cronômetro antigo migrado como meses de trabalho; importação de outro navegador perdia projetos; e-mails ISO-8859-1 com acentos quebrados; contagem dupla em fusos com mudança de horário à meia-noite. |

### Testes

Os testes de navegador `test:app` e `test:extension` estavam quebrados desde que a esteira passou a abrir com o filtro "Hoje". Não havia `npm test` nem execução automática antes do deploy; a escrita na Agenda não tinha testes.

## O que já estava bem feito

- RLS com escrita apenas por função `security definer`, `search_path` vazio e revisão atômica.
- Login PKCE correto; renovação Google confere a identidade; segredo do cliente só no servidor.
- Extensão aceita mensagens apenas de si mesma, insere textos com `textContent` em shadow DOM e pede permissões mínimas.
- CSV protegido contra fórmulas; cronômetro de foco preciso e sem redesenhar a tela a cada segundo; jsPDF e fontes carregados só ao gerar PDF.
- A Agenda nunca altera eventos que não pertencem ao UlbraFlow.
