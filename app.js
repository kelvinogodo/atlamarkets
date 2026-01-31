const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const mongoose = require('mongoose')
const User = require('./models/user.model')
const Admin = require('./models/admin')
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Token = require('./models/token')
const Trader = require('./models/trader')
const CopySubscription = require('./models/copySubscription')
dotenv.config()

const app = express()

const jwtSecret = process.env.JWT_SECRET;


app.use(cors())
app.use(express.json())

const ATLAS_URI = process.env.ATLAS_URI;

if (!ATLAS_URI) {
  throw new Error("Please define the ATLAS_URI environment variable in Vercel");
}

/* Global cache so we don’t reconnect every time */
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(ATLAS_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }).then((mongoose) => mongoose);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
connectDB()

app.post('/api/verify', async (req, res) => {
  const {
    id
  } = req.body
  const user = await User.findOne({ _id: id })

  console.log(user)
  try {
    if (user.verified) {
      await User.updateOne({ _id: id }, {
        verified: false
      })
      res.json({
        status: 200, verified: user
      })
    }
    else {
      await User.updateOne({ _id: id }, {
        verified: true
      })
      res.json({
        status: 201, verified: user
      })
    }
  } catch (error) {
    res.json({ status: 400, message: `error ${error}` })
  }
})

app.post('/api/copytrade', async (req, res) => {
  const token = req.headers['x-access-token']
  const { traderId, amount } = req.body

  if (!amount || amount <= 0) {
    return res.json({ status: 400, message: 'Invalid copy amount' })
  }

  try {
    const decode = jwt.verify(token, jwtSecret)
    const email = decode.email
    const user = await User.findOne({ email: email })

    // Check if user has sufficient funds
    if (user.funded < amount) {
      return res.json({ status: 400, message: 'Insufficient funds' })
    }

    // Check if already copying this trader
    const existingSub = await CopySubscription.findOne({
      userId: user._id,
      traderId: traderId,
      status: 'active'
    });

    if (existingSub) {
      // Option: Add funds to existing subscription (Complexity: High, avoiding for now)
      return res.json({ status: 400, message: 'Already copying this trader' })
    }

    // Deduct funds and create subscription
    await User.updateOne(
      { email: email },
      { $inc: { funded: -amount } } // Deduct from available balance
    );

    const newSubscription = await CopySubscription.create({
      userId: user._id,
      traderId: traderId,
      allocatedAmount: amount,
      currentEquity: amount, // Starts equal to allocated
      status: 'active'
    });

    // Update legacy field for backward compatibility if needed, though strictly we should move away from it
    // await User.updateOne({ email: user.email }, { trader: traderId });

    res.json({ status: 200, message: 'Trader successfully copied', subscription: newSubscription })

  } catch (error) {
    console.error(error)
    res.json({ status: 400, message: `error ${error}` })
  }
})
app.post('/api/stopcopytrade', async (req, res) => {
  const token = req.headers['x-access-token']
  const { traderId } = req.body

  try {
    const decode = jwt.verify(token, jwtSecret)
    const email = decode.email
    const user = await User.findOne({ email: email })

    const subscription = await CopySubscription.findOne({
      userId: user._id,
      traderId: traderId,
      status: 'active'
    });

    if (!subscription) {
      return res.json({ status: 400, message: 'Not currently copying this trader' })
    }

    // Return current equity to user funds
    const refundAmount = subscription.currentEquity;

    await User.updateOne(
      { email: email },
      { $inc: { funded: refundAmount } }
    );

    // Mark subscription as stopped
    subscription.status = 'stopped';
    subscription.lastUpdated = Date.now();
    await subscription.save();

    // Clear legacy field
    // await User.updateOne({ email: user.email }, { trader: '' });

    res.json({ status: 200, message: 'Copy stopped. Funds returned to balance.', refunded: refundAmount })

  } catch (error) {
    console.error(error)
    res.json({ status: 400, message: `error ${error}` })
  }
})

app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ status: 'error', message: 'User not found' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ status: 'error', message: 'Invalid OTP' });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ status: 'error', message: 'OTP expired' });
    }

    // OTP Valid
    user.verified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Generate Verification Token (same as existing flow)
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'secret1258',
      { expiresIn: '1h' }
    );

    // Send Welcome Email (moved here for Live accounts)
    // For simplicity, we can rely on the frontend to send the welcome email after successful login/verification 
    // OR send it here. The existing flow sends emails from Frontend after registration.
    // We will return the token so the frontend can proceed to dashboard.

    return res.status(200).json({ status: 'ok', token, message: 'Account verified successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// register route 
app.post(
  '/api/register',
  async (req, res) => {
    // Only email and password are strictly required now
    const {
      firstName, lastName, userName, password, email, referralLink, server, phonenumber, deviceName, country,
      accountCategory, currency, middleName, dateOfBirth, city, zipcode, address,
      employmentStatus, occupation, annualIncome, sourceOfFunds, investmentExperience,
      idType, idNumber, idExpiry, idDocumentFront, idDocumentBack, proofOfAddress, selfiePhoto
    } = req.body;
    const now = new Date();

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and Password are required' });
    }

    try {
      // Check if the user already exists
      const existingUser = await User.findOne({ email: email });
      if (existingUser) {
        return res.status(409).json({ status: 'error', message: 'Email already exists' });
      }

      // Generate defaults if missing
      const finalFirstName = firstName || 'Trader';
      const finalLastName = lastName || '';
      // If username is missing, generate one from email part + random string to ensure uniqueness
      const finalUserName = userName || (email.split('@')[0] + Math.floor(Math.random() * 1000));

      const referringUser = await User.findOne({ username: referralLink });
      if (referringUser) {
        await User.updateOne(
          { username: referralLink },
          {
            $push: {
              referred: {
                firstname: finalFirstName,
                lastname: finalLastName,
                email: email,
                date: now.toLocaleString(),
                refBonus: 15,
              },
            },
            refBonus: referringUser.refBonus + 500,
            totalProfit: referringUser.totalProfit + 15,
            funded: referringUser.funded + 15,
            capital: referringUser.capital + 15
          }
        );
      }

      // Generate Trading Credentials
      const tradingLogin = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 digit number
      const tradingPassword = Math.random().toString(36).slice(-8).toUpperCase(); // 8 char alphanumeric
      const tradingServer = server || "Atlas-Demo";

      // OTP Logic for LIVE accounts
      let otp = undefined;
      let otpExpires = undefined;
      const isLive = accountCategory === 'LIVE';

      if (isLive) {
        otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      }

      // Create a new user
      const newUser = await User.create({
        firstname: finalFirstName,
        lastname: finalLastName,
        middlename: middleName || '',
        username: finalUserName,
        email,
        phonenumber: phonenumber || '',
        password: password,
        funded: 0,
        investment: [],
        transaction: [],
        withdraw: [],
        rememberme: false,
        referral: crypto.randomBytes(32).toString('hex'),
        refBonus: 0,
        referred: [],
        periodicProfit: 0,
        upline: referralLink || null,
        trades: [],
        server: server || "server1",
        accountCategory: accountCategory || 'LIVE',
        currency: currency || 'USD',
        tradingLogin: tradingLogin,
        tradingPassword: tradingPassword,
        tradingServer: tradingServer,

        // KYC Personal
        dateOfBirth: dateOfBirth || '',
        city: city || '',
        zipcode: zipcode || '',
        address: address || '',
        country: country || '',

        // KYC Financial
        employmentStatus: employmentStatus || '',
        occupation: occupation || '',
        annualIncome: annualIncome || '',
        sourceOfFunds: sourceOfFunds || '',
        investmentExperience: investmentExperience || '',

        // KYC Identity
        idType: idType || '',
        idNumber: idNumber || '',
        idExpiry: idExpiry || '',
        idDocumentFront: idDocumentFront || '',
        idDocumentBack: idDocumentBack || '',
        proofOfAddress: proofOfAddress || '',
        selfiePhoto: selfiePhoto || '',
        kycStatus: isLive ? 'processing' : 'not_submitted', // Auto-set to processing if live signup
        kycSubmittedDate: isLive ? new Date().toISOString() : '',

        otp: otp,
        otpExpires: otpExpires,
        verified: !isLive // Demo accounts auto-verified
      });

      // Email Logic using EmailJS directly from Backend
      if (isLive && otp) {
        try {
          const emailData = {
            service_id: 'service_7ww480m',
            template_id: 'template_bwdvkix', // We need a template that supports 'otp' param or just use 'message'
            user_id: 'xPN9E_hADOXl3h5RZ',
            template_params: {
              'name': finalFirstName,
              'email': email,
              // 'verificationLink': otp, // Using verificationLink param to show OTP for now, or we should assume template has a generic message field?
              // The frontend code used: 'verificationLink': `${result.verificationLink}`. 
              // Let's assume the template prints 'verificationLink'. We will pass "Your OTP code is: " + otp
              'message': `Your verification code is: ${otp}`,
              'reply_to': `support@atlasprimemarket.com`,
              'subject': `Atlasprimemarket OTP`
            }
          };

          await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(emailData),
          });
        } catch (emailErr) {
          console.error("Failed to send OTP email", emailErr);
          // Non-blocking, but problematic.
        }

        return res.status(200).json({
          status: 'ok',
          requireOtp: true,
          email: email,
          message: 'OTP sent to your email'
        });
      }

      // Existing Flow for DEMO or if logic falls back
      const token = jwt.sign(
        { id: newUser._id, email: newUser.email },
        process.env.JWT_SECRET || 'secret1258',
        { expiresIn: '1h' }
      );

      const user = await User.findOne({ email: email })
      const VerificationCode = await Token.create({
        userId: user._id, token: token
      })

      const verificationLink = `https://www.atlasprimemarket.com/${user._id}/verify/${token}`

      // Prepare response data
      const response = {
        status: 'ok',
        email: newUser.email,
        name: newUser.firstname,
        token,
        verificationLink: verificationLink,
        adminSubject: 'User Signup Alert',
        message: `A new user with the following details just signed up:\nName: ${finalFirstName} ${finalLastName}\nEmail: ${email} \nlocation: ${country} \ndevice: ${deviceName}`,
        subject: 'Successful User Referral Alert',
      };

      if (referringUser) {
        response.referringUserEmail = referringUser.email;
        response.referringUserName = referringUser.firstname;
        response.referringUserMessage = `A new user with the name ${finalFirstName} ${finalLastName} just signed up with your referral link. You will now earn 10% of every deposit this user makes. Keep referring to earn more.`;
      } else {
        response.referringUser = null;
      }

      return res.status(201).json(response);
    } catch (error) {
      console.error('Error during user registration:', error);
      return res.status(500).json({ status: 'error', message: 'Server error. Please try again later.' });
    }
  }
);

app.get('/:id/refer', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.id })
    if (!user) {
      return res.json({ status: 400 })
    }
    res.json({ status: 200, referredUser: req.params.id })
  } catch (error) {
    console.log(error)
    res.json({ status: `internal server error ${error}` })
  }
})


app.get('/api/getData', async (req, res) => {
  const token = req.headers['x-access-token'];
  try {
    // Ensure token is provided
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }

    // Verify token and decode user details
    const decoded = jwt.verify(token, jwtSecret); // Replace 'secret1258' with an environment variable for better security
    const email = decoded.email;

    // Fetch user data
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Respond with user details
    res.status(200).json({
      status: 'ok',
      firstname: user.firstname,
      lastname: user.lastname,
      username: user.username,
      email: user.email,
      funded: user.funded,
      invest: user.investment,
      transaction: user.transaction,
      withdraw: user.withdraw,
      refBonus: user.refBonus,
      referred: user.referred,
      referral: user.referral,
      phonenumber: user.phonenumber,
      state: user.state,
      zipcode: user.zipcode,
      address: user.address,
      profilepicture: user.profilepicture,
      country: user.country,
      totalprofit: user.totalprofit,
      totaldeposit: user.totaldeposit,
      totalwithdraw: user.totalwithdraw,
      deposit: user.deposit,
      promo: user.promo,
      periodicProfit: user.periodicProfit,
      trader: user.trader,
      rank: user.rank,
      server: user.server,
      trades: user.trades,
      verified: user.verified,
      tradingLogin: user.tradingLogin,
      tradingPassword: user.tradingPassword,
      tradingServer: user.tradingServer,
      subscriptions: await CopySubscription.find({ userId: user._id, status: 'active' })
    });
  } catch (error) {
    console.error('Error fetching user data:', error.message);

    // Differentiate between invalid token and server error
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ status: 'error', message: 'Token expired' });
    }

    // Handle other server errors
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});



app.post('/api/updateUserData', async (req, res) => {
  const token = req.headers['x-access-token'];

  try {
    const decode = jwt.verify(token, jwtSecret);
    const email = decode.email;
    const user = await User.findOne({ email: email });

    if (!user) {
      return res.json({ status: 400, message: "User not found" });
    }

    // Prepare an object to hold only changed fields
    let updatedFields = {};

    // Loop through request body and compare with existing user data
    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined && req.body[key] !== user[key]) {
        updatedFields[key] = req.body[key];
      }
    });

    // Ensure email remains unchanged
    delete updatedFields.email;

    // Update only if there are changes
    if (Object.keys(updatedFields).length > 0) {
      await User.updateOne({ email: user.email }, { $set: updatedFields });
      return res.json({ status: 200, message: "Profile updated successfully" });
    }

    return res.json({ status: 400, message: "No changes were made" });

  } catch (error) {
    console.error(error);
    return res.json({ status: 500, message: "Internal server error" });
  }
});




app.post('/api/fundwallet', async (req, res) => {
  try {
    const email = req.body.email
    const incomingAmount = req.body.amount
    const user = await User.findOne({ email: email })
    await User.updateOne(
      { email: email }, {
      $set: {
        funded: incomingAmount + user.funded,
        capital: user.capital + incomingAmount,
        totaldeposit: user.totaldeposit + incomingAmount
      }
    }
    )
    const upline = await User.findOne({ username: user.upline })
    if (upline) {
      await User.updateOne({ username: user.upline }, {
        $set: {
          refBonus: 10 / 100 * incomingAmount,
          totalprofit: upline.totalprofit + (10 / 100 * incomingAmount),
          capital: upline.capital + (10 / 100 * incomingAmount),
          funded: upline.funded + (10 / 100 * incomingAmount),
        }
      })
    }

    await User.updateOne(
      { email: email },
      {
        $push: {
          deposit: {
            date: new Date().toLocaleString(),
            amount: incomingAmount,
            id: crypto.randomBytes(32).toString("hex"),
            balance: incomingAmount + user.funded
          }
        }, transaction: {
          type: 'Deposit',
          amount: incomingAmount,
          date: new Date().toLocaleString(),
          balance: incomingAmount + user.funded,
          id: crypto.randomBytes(32).toString("hex"),
        }
      }
    )

    if (upline) {
      res.json({
        status: 'ok',
        funded: req.body.amount,
        name: user.firstname,
        email: user.email,
        message: `your account has been credited with $${incomingAmount} USD. you can proceed to choosing your preferred investment plan to start earning. Thanks.`,
        subject: 'Deposit Successful',
        uplineName: upline.firstname,
        uplineEmail: upline.email,
        uplineSubject: `Earned Referral Commission`,
        uplineMessage: `Congratulations! You just earned $${10 / 100 * incomingAmount} in commission from ${user.firstname} ${user.lastname}'s deposit of $${incomingAmount}.`
      })
    }
    else {
      res.json({
        status: 'ok',
        funded: req.body.amount,
        name: user.firstname,
        email: user.email,
        message: `your account has been credited with $${incomingAmount} USD. you can proceed to choosing your preferred investment plan to start earning. Thanks.`,
        subject: 'Deposit Successful',
        upline: null
      })
    }

  } catch (error) {
    console.log(error)
    res.json({ status: 'error' })
  }
})

app.post('/api/debitwallet', async (req, res) => {
  const email = req.body.email
  console.log(email)
  const user = await User.findOne({ email: email })
  if (req.body.amount <= user.funded) {
    try {
      const incomingAmount = req.body.amount

      await User.updateOne(
        { email: email }, {
        $set: {
          funded: user.funded - incomingAmount,
          capital: user.capital - incomingAmount,
        }
      }
      )

      await User.updateOne(
        { email: email },
        {
          $push: {
            deposit: {
              date: new Date().toLocaleString(),
              amount: incomingAmount,
              id: crypto.randomBytes(32).toString("hex"),
              balance: user.funded - incomingAmount
            }
          }, transaction: {
            type: 'debit',
            amount: incomingAmount,
            date: new Date().toLocaleString(),
            balance: user.funded - incomingAmount,
            id: crypto.randomBytes(32).toString("hex"),
          }
        }
      )


      res.json({
        status: 'ok',
        funded: req.body.amount,
        name: user.firstname,
        email: user.email,
        message: `your account has been debited with $${incomingAmount} USD, Thanks.`,
        subject: 'Debit Alert',
        upline: null
      })

    } catch (error) {
      console.log(error)
      res.json({ status: 'error' })
    }
  }
  else {
    res.json({
      status: 'error',
      funded: req.body.amount,
      error: 'capital cannot be negative'
    })
  }

})


app.post('/api/admin', async (req, res) => {
  const admin = await Admin.findOne({ email: req.body.email })
  if (admin) {
    return res.json({ status: 200, token: 'token' })
  }
  else {
    return res.json({ status: 400 })
  }
})


app.post('/api/deleteUser', async (req, res) => {
  try {
    await User.deleteOne({ email: req.body.email })
    return res.json({ status: 200 })
  } catch (error) {
    return res.json({ status: 500, msg: `${error}` })
  }
})

app.post('/api/deleteTrader', async (req, res) => {
  try {
    await Trader.deleteOne({ _id: req.body.id })
    return res.json({ status: 200 })
  } catch (error) {
    return res.json({ status: 500, msg: `${error}` })
  }
})

app.post('/api/upgradeUser', async (req, res) => {
  try {
    const email = req.body.email
    const incomingAmount = req.body.amount
    const user = await User.findOne({ email: email })
    if (user) {
      await User.updateOne(
        { email: email }, {
        $set: {
          funded: incomingAmount + user.funded,
          capital: user.capital + incomingAmount,
          totalProfit: user.totalprofit + incomingAmount,
          periodicProfit: user.periodicProfit + incomingAmount
        }
      }
      )
      res.json({
        status: 'ok',
        funded: req.body.amount
      })
    }
  }
  catch (error) {
    res.json({
      status: 'error',
    })
  }


})


app.post('/api/updateTraderLog', async (req, res) => {
  try {
    const { tradeLog } = req.body
    const id = tradeLog.id

    // Validations
    if (!id) return res.json({ status: 'error', message: 'Trader ID required' })

    const updatedTrader = await Trader.updateOne(
      { _id: id }, {
      $push: {
        tradehistory: tradeLog
      }
    })

    // Find all active subscriptions for this trader
    const subscriptions = await CopySubscription.find({ traderId: id, status: 'active' }).populate('userId');

    const results = [];

    // Calculate Percentage Return if not provided
    // If 'percentage' is not in tradeLog, we assume the 'amount' in tradeLog is the ROI on a standard $1000 lot? 
    // OR we just use the amount as a fixed distribution if no percentage?
    // BETTER: We'll look for 'percentage' in tradeLog. If missing, we treat 'amount' as a percentage (e.g. 10 = 10%).
    // This defines the protocol: Admin must send percentage or we treat amount as % for copiers.
    // Let's assume tradeLog.roi (decimal, e.g. 0.10 for 10%) or tradeLog.percentage (10).

    let percentage = 0;
    if (tradeLog.percentage) {
      percentage = parseFloat(tradeLog.percentage);
    } else {
      // Fallback/Legacy Logic Assumption:
      // If no percentage is explicit, we might be getting a raw dollar amount. 
      // For production copy-trading, we need percentage. 
      // I will assume for now that if we are in this new mode, we prefer percentage.
      // But to be safe for existing admin panel, if 'amount' exists and 'percentage' doesn't...
      // We will default to: User Profit = (UserAllocated / TraderCapital_Estimate) * Amount? No.
      // Let's treat 'amount' as the raw profit for the user IF it's a legacy user (no subscription).
      // For subscribers, we need a percentage. 
      // HACK: We will try to extract percentage from the description or default to 1%?
      // NO, we will treat 'amount' as the absolute value ADDED to the user, similar to legacy, 
      // BUT scaled by allocation vs standard?
      // Let's stick to: New System expects `percentage`. 
      // If missing, we might create a side-effect.
      // Let's use a standard: If no percentage, we default to 0.
      // WAIT: The admin panel likely only sends 'amount'. 
      // I should probably calculate percentage = amount / 5000 (default capital) * 100 ?
      percentage = (parseFloat(tradeLog.amount) / 5000) * 100; // Assuming 5000 default trader capital
    }

    for (const sub of subscriptions) {
      if (!sub.userId) continue;

      let userProfit = 0;
      // Calculate proportional profit logic
      // Formula: Profit = AllocatedCapital * (Percentage / 100)
      userProfit = sub.allocatedAmount * (percentage / 100);

      // Safety: Ensure we don't return NaN
      if (isNaN(userProfit)) userProfit = 0;

      // Prepare trade log for user
      const userTradeLog = {
        ...tradeLog,
        amount: Math.abs(userProfit), // User's specific profit amount
        id: crypto.randomBytes(16).toString("hex"),
        date: new Date().toLocaleDateString()
      };

      // Update User and Subscription
      if (tradeLog.tradeType === 'profit') {
        await User.updateOne({ _id: sub.userId._id }, {
          $push: { trades: userTradeLog },
          $inc: {
            funded: userProfit,
            capital: userProfit, // In this system capital seems to track balance too?
            totalProfit: userProfit
          }
        });
        await CopySubscription.updateOne({ _id: sub._id }, {
          $inc: { currentEquity: userProfit },
          lastUpdated: Date.now()
        });
      } else if (tradeLog.tradeType === 'loss') {
        await User.updateOne({ _id: sub.userId._id }, {
          $push: { trades: userTradeLog },
          $inc: {
            funded: -Math.abs(userProfit),
            capital: -Math.abs(userProfit),
            totalProfit: -Math.abs(userProfit)
          }
        });
        await CopySubscription.updateOne({ _id: sub._id }, {
          $inc: { currentEquity: -Math.abs(userProfit) },
          lastUpdated: Date.now()
        });
      }
      results.push({ email: sub.userId.email, profit: userProfit });
    }

    // LEGACY SUPPORT: Direct 'trader' field users (if any left)
    // We update them with the fixed amount as before, avoiding double update for subscribers
    // Only update users who have trader=id AND are NOT in the subscriptions list
    const subscriberIds = subscriptions.map(s => s.userId._id);

    if (tradeLog.tradeType === 'profit') {
      await User.updateMany({
        trader: id,
        _id: { $nin: subscriberIds }
      }, {
        $push: { trades: tradeLog },
        $inc: { funded: tradeLog.amount, capital: tradeLog.amount, totalProfit: tradeLog.amount }
      })
    } else if (tradeLog.tradeType === 'loss') {
      await User.updateMany({
        trader: id,
        _id: { $nin: subscriberIds }
      }, {
        $push: { trades: tradeLog },
        $inc: { funded: -tradeLog.amount, capital: -tradeLog.amount, totalProfit: -tradeLog.amount }
      })
    }

    res.json({
      status: 'ok',
      trader: updatedTrader,
      subscriberCount: subscriptions.length,
      legacyUpdate: 'performed'
    })

  } catch (error) {
    console.error(error);
    res.json({ status: 'error', message: error.message })
  }
})

app.post('/api/distributeProfit', async (req, res) => {
  try {
    const { distributions, traderId, addToHistory, masterTradeLog } = req.body;

    const results = await Promise.all(distributions.map(async (dist) => {
      try {
        const { email, amount, type, pair } = dist;
        const numericAmount = parseFloat(amount);

        // Define trade log for user
        const userTradeLog = {
          pair: pair || (masterTradeLog ? masterTradeLog.pair : 'Unknown'),
          amount: numericAmount,
          tradeType: type, // 'profit' or 'loss'
          date: new Date().toLocaleDateString(),
          id: crypto.randomBytes(16).toString("hex")
        };

        const updateOperation = type === 'profit' ? {
          $push: { trades: userTradeLog },
          $inc: {
            funded: numericAmount,
            capital: numericAmount,
            totalProfit: numericAmount,
          }
        } : { // type === 'loss'
          $push: { trades: userTradeLog },
          $inc: {
            funded: -numericAmount,
            capital: -numericAmount,
            totalProfit: -numericAmount,
          }
        };

        const updatedUser = await User.updateOne({ email: email }, updateOperation);
        return { email, status: 'ok', user: updatedUser };

      } catch (err) {
        console.error(`Error updating user ${dist.email}:`, err);
        return { email: dist.email, status: 'error', error: err.message };
      }
    }));

    // Optionally update trader's master history
    if (addToHistory && masterTradeLog && traderId) {
      await Trader.updateOne(
        { _id: traderId },
        { $push: { tradehistory: masterTradeLog } }
      );
    }

    res.json({ status: 'ok', results });

  } catch (error) {
    console.error("Global distribution error:", error);
    res.json({ status: 'error', message: error.message });
  }
})

app.post('/api/withdraw', async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    const decode = jwt.verify(token, jwtSecret)
    const email = decode.email
    const user = await User.findOne({ email: email })
    if (user.funded >= req.body.WithdrawAmount) {

      await User.updateOne(
        { email: email },
        { $set: { withdrawAmount: req.body.WithdrawAmount } }
      )
      return res.json({
        status: 'ok',
        withdraw: req.body.WithdrawAmount,
        email: user.email,
        name: user.firstname,
        message: `We have received your withdrawal order, kindly exercise some patience as our management board approves your withdrawal`,
        subject: 'Withdrawal Order Alert',
        adminMessage: `Hello BOSS! a user with the name ${user.firstname} placed withdrawal of $${req.body.WithdrawAmount} USD, to be withdrawn into ${req.body.wallet} ${req.body.method} wallet`,
      })
    }

    else {
      res.json({
        status: 400,
        subject: 'Failed Withdrawal Alert',
        email: user.email,
        name: user.firstname,
        withdrawMessage: `We have received your withdrawal order, but you can only withdraw you insufficient amount in your account. Kindly deposit and invest more, to rack up more profit, Thanks.`
      })
    }
  }
  catch (error) {
    console.log(error)
    res.json({ status: 'error', message: 'internal server error' })
  }
})

app.post('/api/sendproof', async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    const decode = jwt.verify(token, jwtSecret)
    const email = decode.email
    const user = await User.findOne({ email: email })
    if (user) {
      return res.json({
        status: 200,
        email: user.email,
        name: user.firstname,
        message: `Hi! you have successfully placed a deposit order, kindly exercise some patience as we verify your deposit. Your account will automatically be credited with $${req.body.amount} USD after verification.`,
        subject: 'Pending Deposit Alert',
        adminMessage: `hello BOSS, a user with the name.${user.firstname}, just deposited $${req.body.amount} USD into to your ${req.body.method} wallet. please confirm deposit and credit.`,
        adminSubject: 'Deposit Alert'
      })
    }
    else {
      return res.json({ status: 500 })
    }
  } catch (error) {
    console.log(error)
    res.json({ status: 404 })
  }
})



const SECRET_KEY = process.env.JWT_SECRET || 'defaultsecretkey'; // Replace with your actual secret stored in .env

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, rememberme } = req.body;

    // Check if the user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ status: 404, message: 'User does not exist' });
    }

    // Verify password
    // const isPasswordValid = await bcrypt.compare(password, user.password);
    if (password != user.password) {
      return res.json({ status: 401, message: 'Incorrect password' });
    }

    // if (user.verified  === false) {
    //   return res.json({ status: 400, message: 'Email not verified!' });
    // }

    // Generate JWT token with user ID and email
    const token = jwt.sign(
      { id: user._id, email: user.email },
      SECRET_KEY,
      { expiresIn: '7d' } // Set token to expire in 7 days
    );

    // Update the user's "remember me" status
    user.rememberme = rememberme || false;
    await user.save();

    // Send response
    return res.status(200).json({
      status: 'ok',
      token,
      message: 'Login successful',
    });
  } catch (error) {
    console.error('Error during login:', error);
    return res.json({ status: 'error', message: 'Internal server error' });
  }
});


app.get('/api/getUsers', async (req, res) => {
  const users = await User.find()
  res.json(users)
})


app.post('/api/invest', async (req, res) => {
  const token = req.headers['x-access-token']
  try {
    const decode = jwt.verify(token, jwtSecret)
    const email = decode.email
    const user = await User.findOne({ email: email })

    const money = (() => {
      switch (req.body.percent) {
        case '20%':
          return (req.body.amount * 20) / 100
        case '35%':
          return (req.body.amount * 35) / 100
        case '50%':
          return (req.body.amount * 50) / 100
        case '65%':
          return (req.body.amount * 65) / 100
        case '80%':
          return (req.body.amount * 80) / 100
        case '100%':
          return (req.body.amount * 100) / 100
      }
    })()
    if (user.capital >= req.body.amount) {
      const now = new Date()
      await User.updateOne(
        { email: email },
        {
          $set: { capital: user.capital - req.body.amount, totalprofit: user.totalprofit + money, withdrawDuration: now.getTime() },
        }
      )
      await User.updateOne(
        { email: email },
        {
          $push: {
            investment:
            {
              type: 'investment',
              amount: req.body.amount,
              plan: req.body.plan,
              percent: req.body.percent,
              startDate: now.toLocaleString(),
              endDate: now.setDate(now.getDate() + 432000).toLocaleString(),
              profit: money,
              ended: 259200000,
              started: now.getTime(),
              periodicProfit: 0
            },
            transaction: {
              type: 'investment',
              amount: req.body.amount,
              date: now.toLocaleString(),
              balance: user.funded + req.body.amount,
              id: crypto.randomBytes(32).toString("hex")
            }
          }
        }
      )
      res.json({ status: 'ok', amount: req.body.amount })
    } else {
      res.json({
        message: 'Insufficient capital!',
        status: 400
      })
    }
  } catch (error) {
    return res.json({ status: 500, error: error })
  }
})


const change = (users, now) => {
  users.forEach((user) => {

    user.investment.map(async (invest) => {
      if (isNaN(invest.started)) {
        console.log('investment is not a number')
        res.json({ message: 'investment is not a number' })
        return
      }
      if (user.investment == []) {
        console.log('investment is an empty array')
        res.json({ message: 'investment is an empty array' })
        return
      }
      if (now - invest.started >= invest.ended) {
        console.log('investment completed')
        res.json({ message: 'investment completed' })
        return
      }
      if (isNaN(invest.profit)) {
        console.log('investment profit is not a number')
        res.json({ message: 'investment profit is not a number' })
        return
      }
      else {
        try {
          await User.updateOne(
            { email: user.email },
            {
              $set: {
                funded: user.funded + invest.profit,
                periodicProfit: user.periodicProfit + invest.profit,
                capital: user.capital + invest.profit,
                totalProfit: user.totalProfit + invest.profit
              }
            }
          )
        } catch (error) {
          console.log(error)
        }
      }
    })
  })
}
app.get('/api/cron', async (req, res) => {
  try {
    const users = (await User.find()) ?? []
    const now = new Date().getTime()
    change(users, now)
    return res.json({ status: 200 })
  } catch (error) {
    console.log(error)
    return res.json({ status: 500, message: 'error! timeout' })
  }
})


app.post('/api/getWithdrawInfo', async (req, res) => {

  try {
    const user = await User.findOne({
      email: req.body.email,
    })

    if (user) {
      const userAmount = user.withdrawAmount
      await User.updateOne(
        { email: req.body.email },
        { $set: { funded: user.funded - userAmount, totalwithdraw: user.totalwithdraw + userAmount, capital: user.capital - userAmount, withdrawAmount: 0 } }
      )
      await User.updateOne(
        { email: req.body.email },
        {
          $push: {
            withdraw: {
              date: new Date().toLocaleString(),
              amount: userAmount,
              id: crypto.randomBytes(32).toString("hex"),
              balance: user.funded - userAmount
            }
          }
        }
      )
      const now = new Date()
      await User.updateOne(
        { email: req.body.email },
        {
          $push: {
            transaction: {
              type: 'withdraw',
              amount: userAmount,
              date: now.toLocaleString(),
              balance: user.funded - userAmount,
              id: crypto.randomBytes(32).toString("hex"),
            }
          }
        }
      )
      return res.json({ status: 'ok', amount: userAmount })
    }
  }
  catch (err) {
    return res.json({ status: 'error', user: false })
  }
})

// Create new trader
app.post('/api/createTrader', async (req, res) => {
  try {
    const {
      firstname,
      lastname,
      nationality,
      winRate, // this doesn't exist in the model, maybe map to profitrate?
      avgReturn,
      followers,
      rrRatio,
      minimumcapital,
      traderImage
    } = req.body;

    const newTrader = new Trader({
      firstname,
      lastname,
      nationality,
      profitrate: winRate || '92%', // mapping winRate from frontend
      averagereturn: avgReturn || '90%',
      followers: followers || '50345',
      rrRatio: rrRatio || '1:7',
      minimumcapital: minimumcapital || 5000,
      tradehistory: [], // empty by default
      numberoftrades: '64535', // or set it dynamically later
      traderImage: traderImage
    });

    const savedTrader = await newTrader.save();
    res.status(201).json(savedTrader);
  } catch (error) {
    console.error('Error creating trader:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

app.get('/api/fetchTraders', async (req, res) => {
  try {
    const traders = await Trader.find()
    res.json({ status: 200, traders: traders })
  }
  catch (error) {
    res.json({ status: 404, error: error })
  }
})

app.get('/:id/verify/:token', async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id })
    if (!user) {
      return res.json({ status: 400 })
    }
    const token = await Token.findOne({ userId: user._id, token: req.params.token })

    if (!token) {
      return res.json({ status: 400 })
    }
    await User.updateOne({ _id: user._id }, {
      $set: { verified: true }
    })
    await token.remove()
    res.json({ status: 200 })
  } catch (error) {
    console.log(error)
    res.json({ status: `internal server error ${error}` })
  }
})


app.post('/api/resetpassword', async (req, res) => {
  try {
    const { newPassword, email } = req.body;

    // Check if the user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ status: 404, message: 'User does not exist' });
    }

    await User.updateOne(
      { email: email }, {
      $set: {
        password: newPassword
      }
    })
    return res.status(200).json({
      status: 'ok',
      message: 'Password reset successful',
    });
  } catch (error) {
    console.error('password not reset', error);
    return res.json({ status: 'error', message: 'password not reset' });
  }
});

// KYC Submission Endpoint
app.post('/api/submitKYC', async (req, res) => {
  const token = req.headers['x-access-token'];

  try {
    if (!token) {
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }

    const decoded = jwt.verify(token, jwtSecret);
    const email = decoded.email;

    const {
      middlename,
      dateOfBirth,
      nationality,
      city,
      address,
      employmentStatus,
      occupation,
      annualIncome,
      sourceOfFunds,
      investmentExperience,
      idType,
      idNumber,
      idExpiry,
      idDocumentFront,
      idDocumentBack,
      proofOfAddress,
      selfiePhoto
    } = req.body;

    // Update user with KYC data
    await User.updateOne(
      { email },
      {
        $set: {
          middlename,
          dateOfBirth,
          nationality,
          city,
          address,
          employmentStatus,
          occupation,
          annualIncome,
          sourceOfFunds,
          investmentExperience,
          idType,
          idNumber,
          idExpiry,
          idDocumentFront,
          idDocumentBack,
          proofOfAddress,
          selfiePhoto,
          kycStatus: 'processing',
          kycSubmittedDate: new Date().toLocaleString()
        }
      }
    );

    res.status(200).json({
      status: 'ok',
      message: 'KYC submitted successfully and is under review'
    });
  } catch (error) {
    console.error('Error submitting KYC:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Admin: Approve KYC
app.post('/api/admin/approveKYC', async (req, res) => {
  try {
    const { email } = req.body;

    await User.updateOne(
      { email },
      {
        $set: {
          kycStatus: 'approved',
          kycApprovedDate: new Date().toLocaleString(),
          kycRejectionReason: ''
        }
      }
    );

    const user = await User.findOne({ email });

    res.status(200).json({
      status: 'ok',
      message: 'KYC approved successfully',
      userName: user.firstname,
      userEmail: user.email
    });
  } catch (error) {
    console.error('Error approving KYC:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Admin: Reject KYC
app.post('/api/admin/rejectKYC', async (req, res) => {
  try {
    const { email, reason } = req.body;

    await User.updateOne(
      { email },
      {
        $set: {
          kycStatus: 'rejected',
          kycRejectionReason: reason || 'Documents do not meet requirements',
          kycApprovedDate: ''
        }
      }
    );

    const user = await User.findOne({ email });

    res.status(200).json({
      status: 'ok',
      message: 'KYC rejected',
      userName: user.firstname,
      userEmail: user.email
    });
  } catch (error) {
    console.error('Error rejecting KYC:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});




module.exports = app

