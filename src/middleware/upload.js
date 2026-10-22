const multer = require('multer')

const MAX_FILES = 3
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('File type not allowed. Use images, PDF, Word, or MP4/MOV.'))
  }
  return cb(null, true)
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter,
})

/** Optional multi-file field `files` (max 3). */
const uploadRequestFiles = upload.array('files', MAX_FILES)

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Single profile image (logo) field `image`, max 5 MB, images only. */
const uploadProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error('File type not allowed. Use a JPG, PNG, GIF, or WebP image.'))
    }
    return cb(null, true)
  },
}).single('image')

module.exports = {
  MAX_FILES,
  MAX_FILE_BYTES,
  ALLOWED_MIME,
  uploadRequestFiles,
  uploadProfileImage,
}
