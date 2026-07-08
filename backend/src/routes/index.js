import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import cadastrosRoutes from "./cadastros.js";
import agendamentosRoutes from "./agendamentos.js";
import notificacoesRoutes from "./notificacoes.js";
import publicRoutes from "./public.js";
import webhookRoutes from "./webhook.js";
import { pingDatabase } from "../utils/db-fallback.js";
import { verifyMailTransport } from "../utils/email.js";
import { getUploadDirectoriesHealth } from "../utils/upload-policy.js";
import { getLogFilesHealth } from "../utils/telemetry.js";
import { authRequired, requirePermission } from "../middlewares/auth.js";
import { dispararRelatorioDiario, verificarEEnviarOptins } from "../utils/relatorio-supervisores.js";
import {
  sincronizarRelatorioComAgendamentos,
  diagnosticarDuplicidadeRelatorio,
  limparPendentesEReimportar
} from "../utils/relatorio-entradas.js";

const router = Router();

// Public health check – no sensitive information
router.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Detailed health checks require authentication
router.get("/health/db", authRequired, async (_req, res) => {
  try {
    await pingDatabase();
    res.json({ ok: true, message: "Banco online" });
  } catch (error) {
    console.error("Erro em /health/db:", error);
    res.status(500).json({ ok: false, message: "Falha no banco" });
  }
});
router.get("/health/smtp", authRequired, async (_req, res) => {
  try {
    const smtp = await verifyMailTransport();
    res.status(smtp.ok ? 200 : 503).json({
      ok: smtp.ok,
      configured: smtp.configured,
      message: smtp.message,
    });
  } catch (error) {
    console.error("Erro em /health/smtp:", error);
    res.status(500).json({ ok: false, message: "Falha ao consultar SMTP." });
  }
});
router.get("/health/uploads", authRequired, (_req, res) => {
  try {
    const uploads = getUploadDirectoriesHealth();
    const logs = getLogFilesHealth();
    const safeUploads = uploads.map((u) => ({
      label: u.label,
      exists: u.exists,
      writable: u.writable,
    }));
    const safeLogs = logs.map((l) => ({
      file: l.file,
      exists: l.exists,
    }));
    res.json({ ok: true, uploads: safeUploads, logs: safeLogs });
  } catch (error) {
    console.error("Erro em /health/uploads:", error);
    res.status(500).json({ ok: false, message: "Falha ao consultar uploads." });
  }
});
router.get("/health/notifications", authRequired, async (_req, res) => {
  try {
    const smtp = await verifyMailTransport();
    const uploads = getUploadDirectoriesHealth();
    const ok = !!smtp.ok && uploads.every((item) => item.exists && item.writable && item.readable);
    res.status(ok ? 200 : 503).json({
      ok,
      smtpOk: smtp.ok,
      uploadsOk: uploads.every((item) => item.exists && item.writable),
    });
  } catch (error) {
    console.error("Erro em /health/notifications:", error);
    res.status(500).json({ ok: false, message: "Falha ao consultar integrações de notificação." });
  }
});
// Disparo manual do relatório de supervisores (requer login)
router.post("/admin/relatorio-supervisores/disparar", authRequired, async (_req, res) => {
  try {
    await dispararRelatorioDiario();
    res.json({ ok: true, message: "Relatório disparado." });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// Status do opt-in dos supervisores + reenvio da confirmação para pendentes
router.get("/admin/relatorio-supervisores/status", authRequired, async (_req, res) => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(__dirname, "../../data/supervisores-optin.json");
    const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

router.post("/admin/relatorio-supervisores/reenviar-optin", authRequired, async (_req, res) => {
  try {
    await verificarEEnviarOptins();
    res.json({ ok: true, message: "Opt-in verificado/reenviado." });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// Backfill manual: sincroniza RelatorioTerceirizado com os agendamentos já existentes no
// banco (vincula agendamentoId + Status='Agendado' para os ativos; limpa o vínculo dos
// cancelados/reprovados/no-show). Útil para corrigir notas que ficaram desatualizadas
// antes da reconciliação automática entrar em vigor.
router.post("/admin/relatorio-terceirizado/sincronizar-agendamentos", authRequired, requirePermission("relatorio.terceirizado.manage"), async (_req, res) => {
  try {
    const { totalAgendamentos, totalVinculados, totalDesvinculados, notasNaoEncontradas, erros } = await sincronizarRelatorioComAgendamentos();

    const partes = [`${totalVinculados} agendamento(s) vinculado(s)`, `${totalDesvinculados} desvinculado(s)`];
    if (notasNaoEncontradas.length) partes.push(`${notasNaoEncontradas.length} nota(s) não encontrada(s) no RelatorioTerceirizado (confira "notasNaoEncontradas" — provável divergência de texto no fornecedor ou no número da NF)`);
    if (erros.length) partes.push(`${erros.length} agendamento(s) com erro (confira "erros")`);

    res.json({
      ok: erros.length === 0,
      totalAgendamentos,
      totalVinculados,
      totalDesvinculados,
      totalNotasNaoEncontradas: notasNaoEncontradas.length,
      notasNaoEncontradas,
      erros,
      message: `Sincronização concluída: ${partes.join(", ")}.`
    });
  } catch (error) {
    console.error("Erro em /admin/relatorio-terceirizado/sincronizar-agendamentos:", error);
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// Reset completo: sincroniza com os agendamentos existentes, apaga só as
// notas sem NENHUM agendamento relacionado (nem ativo, nem histórico de
// cancelado/reprovado/no-show — inclusive as manuais ainda não vindas do ERP)
// e força a reimportação imediata do arquivo mais recente encontrado na pasta
// monitorada — não espera o vigia automático nem depende do arquivo ter
// mudado desde a última importação.
router.post("/admin/relatorio-terceirizado/limpar-e-reimportar", authRequired, requirePermission("relatorio.terceirizado.manage"), async (req, res) => {
  try {
    const { sincronizacao, totalRemovidas, totalPreservadasComHistorico, reimportacao } = await limparPendentesEReimportar({ actor: req.user });

    res.json({
      ok: true,
      sincronizacao,
      totalRemovidas,
      totalPreservadasComHistorico,
      reimportacao,
      message: `${sincronizacao.totalVinculados} agendamento(s) vinculado(s), ${totalRemovidas} nota(s) sem nenhum agendamento relacionado removida(s), ${totalPreservadasComHistorico} preservada(s) por ter histórico (cancelado/reprovado/no-show)${reimportacao ? `, arquivo "${reimportacao.fileName}" reimportado (${reimportacao.totalLinhasValidas} linha(s) válida(s))` : ', nenhum arquivo encontrado na pasta monitorada para reimportar'}.`
    });
  } catch (error) {
    console.error("Erro em /admin/relatorio-terceirizado/limpar-e-reimportar:", error);
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// Diagnóstico somente leitura: mostra se o volume de notas pendentes é backlog
// real (muitas NF distintas) ou duplicatas que sobraram sem reconciliar
// (várias linhas para a mesma NF+fornecedor+série).
router.get("/admin/relatorio-terceirizado/diagnostico", authRequired, requirePermission("relatorio.terceirizado.view"), async (_req, res) => {
  try {
    const diagnostico = await diagnosticarDuplicidadeRelatorio();
    res.json({ ok: true, ...diagnostico });
  } catch (error) {
    console.error("Erro em /admin/relatorio-terceirizado/diagnostico:", error);
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cadastros", cadastrosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/notificacoes", notificacoesRoutes);
router.use("/public", publicRoutes);
router.use("/webhook", webhookRoutes);

export default router;