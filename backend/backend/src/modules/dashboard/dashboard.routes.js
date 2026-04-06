import { Router } from 'express'; import { operational } from './dashboard.controller.js'; const router=Router(); router.get('/operacional',operational); export default router;
