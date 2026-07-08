// Roda o reset pontual do RelatorioTerceirizado direto no servidor, sem
// precisar de login/token/curl.
//
// Uso (a partir da pasta backend/):
//   node scripts/limpar-relatorio-e-reimportar.js
//
// O que faz (nessa ordem):
//   1. Sincroniza RelatorioTerceirizado com os agendamentos existentes
//      (vincula os ativos, desvincula os cancelados/reprovados/no-show).
//   2. Remove só as notas sem NENHUM agendamento relacionado (nem ativo, nem
//      histórico de cancelado/reprovado/no-show) — preserva as demais.
//   3. Reimporta na hora o arquivo mais recente encontrado na pasta
//      monitorada (backend/uploads/importacao-relatorio).

import { limparPendentesEReimportar } from '../src/utils/relatorio-entradas.js';
import { closeMysqlPool } from '../src/utils/mysql-direct.js';

async function main() {
  console.log('Iniciando reset do RelatorioTerceirizado...\n');

  const { sincronizacao, totalRemovidas, totalPreservadasComHistorico, reimportacao } =
    await limparPendentesEReimportar({ actor: { nome: 'script-manual' } });

  console.log('== Sincronização com agendamentos ==');
  console.log(`  Agendamentos no total: ${sincronizacao.totalAgendamentos}`);
  console.log(`  Vinculados (ativos):   ${sincronizacao.totalVinculados}`);
  console.log(`  Desvinculados:         ${sincronizacao.totalDesvinculados}`);
  if (sincronizacao.notasNaoEncontradas.length) {
    console.log(`  Notas não encontradas no RelatorioTerceirizado: ${sincronizacao.notasNaoEncontradas.length}`);
    for (const nota of sincronizacao.notasNaoEncontradas) {
      console.log(`    - agendamento ${nota.agendamentoId} (${nota.protocolo || 's/protocolo'}) | fornecedor "${nota.fornecedor}" | NF ${nota.numeroNf}${nota.serie ? ` / Série ${nota.serie}` : ''}`);
    }
  }
  if (sincronizacao.erros.length) {
    console.log(`  Erros: ${sincronizacao.erros.length}`);
    for (const erro of sincronizacao.erros) {
      console.log(`    - agendamento ${erro.agendamentoId}: ${erro.message}`);
    }
  }

  console.log('\n== Limpeza ==');
  console.log(`  Notas removidas (sem nenhum agendamento relacionado): ${totalRemovidas}`);
  console.log(`  Notas preservadas (têm histórico de cancelado/reprovado/no-show): ${totalPreservadasComHistorico}`);

  console.log('\n== Reimportação ==');
  if (reimportacao) {
    console.log(`  Arquivo: ${reimportacao.fileName}`);
    console.log(`  Linhas lidas: ${reimportacao.totalLinhasLidas} | válidas: ${reimportacao.totalLinhasValidas}`);
    console.log(`  Fornecedores: ${reimportacao.totalFornecedores} | Notas: ${reimportacao.totalNotas}`);
    console.log(`  Persistido em: ${reimportacao.persistedIn}`);
  } else {
    console.log('  Nenhum arquivo encontrado na pasta monitorada para reimportar.');
  }

  console.log('\nConcluído com sucesso.');
}

main()
  .catch((error) => {
    console.error('\nFalha ao rodar o reset:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
