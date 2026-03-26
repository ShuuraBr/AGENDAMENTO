import { Router } from 'express';
import {
  list,
  getById,
  create,
  previewApproval,
  approve,
  cancel,
  checkin,
  startUnload,
  finishUnload,
  uploadDocument,
  listDocuments,
  generateVoucher,
  dispatchVoucher,
} from './agendamentos.controller.js';
import { uploadDocumento } from './upload.middleware.js';

const router = Router();

router.get('/', list);
router.get('/:id', getById);
router.get('/:id/documentos', listDocuments);
router.get('/:id/voucher.pdf', generateVoucher);
router.post('/preview-approval', previewApproval);
router.post('/', create);
router.post('/:id/aprovar', approve);
router.post('/:id/cancelar', cancel);
router.post('/:id/checkin', checkin);
router.post('/:id/iniciar-descarga', startUnload);
router.post('/:id/finalizar-descarga', finishUnload);
router.post('/:id/documentos', uploadDocumento.single('arquivo'), uploadDocument);
router.post('/:id/enviar-voucher', dispatchVoucher);

export default router;
