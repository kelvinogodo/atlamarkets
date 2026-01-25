const mongoose = require('mongoose')

const trader = new mongoose.Schema(
  {
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    nationality: { type: String, default: 'United Kingdom' },
    tradehistory: { type: [Object] },
    profitrate: { type: String, default: '92%' },
    averagereturn: { type: String, default: '90%' },
    followers: { type: String, default: '50345' },
    numberoftrades: { type: String, default: '64535' },
    rrRatio: { type: String, default: '1:7' },
    traderImage: { type: String, default: '' },
    minimumcapital: { type: Number, required: true, default: 5000 },
  }
)
const Trader = mongoose.models.Trader || mongoose.model('Trader', trader)
module.exports = Trader