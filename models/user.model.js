const mongoose = require('mongoose')

const user = new mongoose.Schema(
  {
    firstname: { type: String, default: '' },
    lastname: { type: String, default: '' },
    username: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    funded: { type: Number },
    capital: { type: Number, default: 0 },
    trades: { type: [Object] },
    transaction: { type: [Object] },
    withdraw: { type: [Object] },
    deposit: { type: [Object], default: [] },
    rememberme: { type: Boolean },
    verified: { type: Boolean, default: false },
    referral: { type: String, unique: true },
    refBonus: { type: Number },
    referred: { type: [Object], default: [] },
    upline: { type: String, default: '' },
    phonenumber: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    zipcode: { type: String, default: '' },
    address: { type: String, default: '' },
    profilepicture: { type: String, default: '' },
    totalprofit: { type: Number, default: 0 },
    periodicProfit: { type: Number, default: 0 },
    totaldeposit: { type: Number, default: 0 },
    totalwithdraw: { type: Number, default: 0 },
    promo: { type: Boolean, default: false },
    withdrawDuration: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    proofs: { type: [], default: [] },
    trader: { type: String },
    server: { type: String },
    rank: { type: String, default: 'silver' },
    withdrawAmount: { type: Number, default: 0 },
    // KYC Fields
    middlename: { type: String, default: '' },
    dateOfBirth: { type: String, default: '' },
    nationality: { type: String, default: '' },
    // Address fields already exist: address, city (state), zipcode, country
    city: { type: String, default: '' },
    // Financial Information
    employmentStatus: { type: String, default: '' }, // employed, self-employed, unemployed, retired, student
    occupation: { type: String, default: '' },
    annualIncome: { type: String, default: '' }, // income range
    sourceOfFunds: { type: String, default: '' }, // salary, business, investment, inheritance, etc
    investmentExperience: { type: String, default: '' }, // beginner, intermediate, advanced
    // Identity Verification
    idType: { type: String, default: '' }, // passport, drivers_license, national_id
    idNumber: { type: String, default: '' },
    idExpiry: { type: String, default: '' },
    idDocumentFront: { type: String, default: '' }, // cloudinary URL
    idDocumentBack: { type: String, default: '' }, // cloudinary URL
    proofOfAddress: { type: String, default: '' }, // cloudinary URL
    selfiePhoto: { type: String, default: '' }, // cloudinary URL
    // KYC Status Tracking
    kycStatus: { type: String, default: 'not_submitted' }, // not_submitted, processing, approved, rejected
    kycSubmittedDate: { type: String, default: '' },
    kycApprovedDate: { type: String, default: '' },
    kycRejectionReason: { type: String, default: '' }
  }
)
const User = mongoose.models.User || mongoose.model('User', user)
module.exports = User