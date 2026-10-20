const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const prisma = require('../config/db')
const { MAX_FILES } = require('../middleware/upload')

const UPLOAD_ROOT = path.join(__dirname, '../../uploads')

function requestDir(requestId) {
  return path.join(UPLOAD_ROOT, 'requests', String(requestId))
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function extFromName(name = '') {
  const ext = path.extname(name).replace(/^\./, '').toLowerCase()
  return ext.slice(0, 20) || null
}

/**
 * Persist multer memory files for a customer request and create DB rows.
 * @param {string} requestId
 * @param {Express.Multer.File[]} files
 */
async function saveRequestAttachments(requestId, files = []) {
  const list = Array.isArray(files) ? files.filter(Boolean) : []
  if (!list.length) return []

  const existing = await prisma.requestAttachment.count({ where: { requestId } })
  const remaining = Math.max(0, MAX_FILES - existing)
  if (remaining <= 0) {
    const err = new Error(`Maximum of ${MAX_FILES} attachments allowed`)
    err.status = 400
    throw err
  }

  const toSave = list.slice(0, remaining)
  const dir = requestDir(requestId)
  ensureDir(dir)

  const created = []
  for (const file of toSave) {
    const ext = extFromName(file.originalname)
    const storedName = `${randomUUID()}${ext ? `.${ext}` : ''}`
    const absPath = path.join(dir, storedName)
    fs.writeFileSync(absPath, file.buffer)

    const row = await prisma.requestAttachment.create({
      data: {
        requestId,
        originalName: String(file.originalname || storedName).slice(0, 255),
        storedName,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size || file.buffer?.length || 0,
        ext,
      },
    })
    created.push(row)
  }

  return created
}

function absolutePathFor(attachment) {
  return path.join(requestDir(attachment.requestId), attachment.storedName)
}

function publicAttachmentShape(attachment) {
  return {
    id: attachment.id,
    requestId: attachment.requestId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ext: attachment.ext,
    createdAt: attachment.createdAt,
    downloadPath: `/api/requests/${attachment.requestId}/attachments/${attachment.id}/download`,
  }
}

module.exports = {
  UPLOAD_ROOT,
  requestDir,
  saveRequestAttachments,
  absolutePathFor,
  publicAttachmentShape,
}
