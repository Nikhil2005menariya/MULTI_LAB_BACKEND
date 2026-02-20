const mongoose = require('mongoose');

const itemAssetSchema = new mongoose.Schema({
  item_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },

  asset_tag: {
    type: String,
    required: true,
    unique: true
  },

  serial_no: String,

  /* 🔥 NEW — vendor per asset */
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
    default: 'available'
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

module.exports = mongoose.model('ItemAsset', itemAssetSchema);