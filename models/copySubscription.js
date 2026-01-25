const mongoose = require('mongoose');

const copySubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  traderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trader', required: true },
  allocatedAmount: { type: Number, required: true }, // Initial capital locked for this copy
  currentEquity: { type: Number, required: true },   // Current value including P&L
  status: { type: String, enum: ['active', 'paused', 'stopped'], default: 'active' },
  startDate: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
});

const CopySubscription = mongoose.models.CopySubscription || mongoose.model('CopySubscription', copySubscriptionSchema);
module.exports = CopySubscription;
