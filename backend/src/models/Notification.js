const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'approval', 
        'overdue', 
        'reminder', 
        'reminder_3d', 
        'reminder_2d', 
        'reminder_1d',
        'auto_reject_not_approved',
        'auto_reject_not_picked_up'
      ],
      required: true
    },

    recipient_email: {
      type: String,
      required: true
    },

    transaction_id: String,

    status: {
      type: String,
      enum: ['sent', 'failed'],
      default: 'sent'
    },

    sent_at: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
