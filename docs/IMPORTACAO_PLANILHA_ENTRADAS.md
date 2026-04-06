Importação automática da planilha de entradas

O backend monitora a pasta:
`backend/uploads/importacao-relatorio`

Ao iniciar o servidor, a planilha mais recente é lida automaticamente. A cada 60 segundos o sistema verifica se houve arquivo novo ou alteração.

Nesta versão a tabela `RelatorioTerceirizado` passou a receber as linhas da planilha em nível de NF, com as colunas operacionais do documento. A tela de `Novo agendamento interno` não lê mais um resumo pré-agrupado; ela agrupa os fornecedores pendentes a partir das linhas importadas no banco.

Fluxo:
1. colocar a planilha `.ods`, `.csv` ou `.json` na pasta monitorada
2. iniciar o backend
3. conferir `GET /api/relatorio-entradas/status`
4. conferir a tabela `RelatorioTerceirizado`
5. abrir `Novo agendamento interno` e validar o fornecedor pendente

Se o banco falhar, o sistema mantém fallback em:
- `backend/data/relatorio-terceirizado-raw.json`
- `backend/data/fornecedores-pendentes.json`
