const mongoose = require('mongoose')

const quoteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['motivation', 'success', 'life', 'leadership', 'wisdom'],
      default: 'motivation',
    },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
)

module.exports = mongoose.model('Quote', quoteSchema)
