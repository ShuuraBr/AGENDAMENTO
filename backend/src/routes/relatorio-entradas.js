import { Router } from 'express';
import { authRequired, requireProfiles } from '../middlewares/auth.js';
import {
  countRelatorioRowsInDatabase,
  getImportDirectory,
  getRelatorioImportStatusDetailed,
  importRelatorioSpreadsheet,
  listSupportedImportFiles,
  relatorioSpreadsheetUpload,
  scanImportFolderAndProcess,
  syncLatestRelatorioFromFolder
} from '../utils/relatorio-entradas.js';

const router = Router();
router.use(authRequired);

router.get('/status', requireProfiles('ADMIN', 'GESTOR', 'OPERADOR'), async (_req, res) => {
  const files = listSupportedImportFiles().map((item) => ({
    nome: item.name,
    tamanho: item.size,
    modificadoEm: new Date(item.mtimeMs).toISOString()
  }));

  let totalLinhasNoBanco = 0;
  try {
    totalLinhasNoBanco = await countRelatorioRowsInDatabase();
  } catch (error) {
    console.error('Falha ao contar linhas do relatório no status:', error?.message || error);
  }

  res.json({
    ok: true,
    pastaMonitorada: getImportDirectory(),
    ultimoProcessamento: getRelatorioImportStatus(),
    arquivosDetectados: files,
    totalLinhasNoBanco

  });
});

router.post('/importar', requireProfiles('ADMIN', 'GESTOR'), relatorioSpreadsheetUpload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file?.path) return res.status(400).json({ message: 'Envie a planilha no campo arquivo.' });
    const summary = await importRelatorioSpreadsheet({
      filePath: req.file.path,
      originalName: req.file.originalname,
      actor: req.user,
      source: 'upload',
      ip: req.ip
    });
    res.status(201).json(summary);
  } catch (error) {
    res.status(400).json({ message: error?.message || 'Falha ao importar planilha.' });
  }
});

router.post('/processar-pasta', requireProfiles('ADMIN', 'GESTOR'), async (req, res) => {
  try {
    const result = await syncLatestRelatorioFromFolder({
      forceWhenDatabaseEmpty: true,
      source: 'manual.processar-pasta',
      actor: req.user,
      ip: req.ip
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error?.message || 'Falha ao processar a pasta monitorada.' });
  }
});

export default router;
