import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();

// Resolve uploads directory relative to this file's location (dist/routes/ → ../../uploads)
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// Ensure the directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
    cb(null, unique);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('نوع الملف غير مدعوم — يُقبل jpg/png/webp فقط'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
});

// POST /api/uploads/image
router.post(
  '/image',
  requireAuth,
  requirePermission('products.create'),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: `خطأ في الرفع: ${err.message}` });
        return;
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      next();
    });
  },
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'لم يتم إرسال ملف' });
      return;
    }
    res.json({ url: `/uploads/${req.file.filename}` });
  }
);

export default router;
