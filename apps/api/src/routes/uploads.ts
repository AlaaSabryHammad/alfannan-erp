import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { requireAuth, requirePermission } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Resolve uploads directory relative to this file's location (dist/routes/ → ../../uploads)
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// Ensure the directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// The extension comes from the (validated) content type — never from the client's file name — so a
// file called "x.html" can never be stored and served as HTML.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    // unguessable name: other companies' files cannot be enumerated
    cb(null, `${crypto.randomBytes(16).toString('hex')}${EXT_BY_MIME[file.mimetype] ?? '.bin'}`);
  },
});

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.mimetype in EXT_BY_MIME) {
    cb(null, true);
  } else {
    cb(new Error('نوع الملف غير مدعوم — يُقبل jpg/png/webp فقط'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 }, // 3 MB, one file
});

/** The declared content type is attacker-controlled — check the actual bytes. */
function matchesImageSignature(file: string, mimetype: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (mimetype === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (mimetype === 'image/png') {
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimetype === 'image/webp') {
      return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// POST /api/uploads/image
router.post(
  '/image',
  requireAuth,
  requirePermission('products.create'),
  rateLimit({ name: 'upload', windowMs: 10 * 60 * 1000, max: 120, message: 'رفع ملفات كثير — حاول لاحقًا' }),
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
    if (!matchesImageSignature(req.file.path, req.file.mimetype)) {
      fs.unlink(req.file.path, () => undefined);
      res.status(400).json({ error: 'محتوى الملف لا يطابق نوع الصورة المعلن' });
      return;
    }
    res.json({ url: `/uploads/${req.file.filename}` });
  }
);

export default router;
