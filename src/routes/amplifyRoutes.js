import { Router } from 'express';
import { exportAmplifyRekapExcel, getAmplifyRekap } from '../controller/amplifyController.js';
import { getAmplifyKhususRekap } from '../controller/amplifyKhususController.js';

const router = Router();

router.get('/rekap', getAmplifyRekap);
router.get('/rekap/excel', exportAmplifyRekapExcel);
router.get('/rekap-khusus', getAmplifyKhususRekap);
export default router;
