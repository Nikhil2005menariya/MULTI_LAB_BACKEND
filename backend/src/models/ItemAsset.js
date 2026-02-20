const mongoose = require('mongoose');
const itemAssetSchema = new mongoose.Schema({
  lab_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lab',
    required: true,
    index: true
  },

  item_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
    index: true
  },

  asset_tag: {
    type: String,
    required: true,
    unique: true
  },

  serial_no: String,

  vendor: {
    type: String,
    required: true
  },

  purchase_date: {
    type: Date,
    default: Date.now
  },

  invoice_number: String,

  status: {
    type: String,
    enum: ['available', 'issued', 'damaged', 'retired'],
    default: 'available',
    index: true
  },

  condition: {
    type: String,
    enum: ['good', 'faulty', 'broken'],
    default: 'good'
  },

  location: String,

  last_transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }
}, { timestamps: true });

itemAssetSchema.index({ lab_id: 1, status: 1 });

module.exports = mongoose.model('ItemAsset', itemAssetSchema);