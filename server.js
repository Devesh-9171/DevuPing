const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'devuping-secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

if (!MONGO_URI) {
  console.warn('WARNING: MONGO_URI is not configured. Set MONGO_URI in .env before starting the app.');
}
if (!GOOGLE_CLIENT_ID) {
  console.warn('WARNING: GOOGLE_CLIENT_ID is not configured. Set GOOGLE_CLIENT_ID in .env before starting the app.');
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected'))
  .catch((error) => console.error('MongoDB connection error:', error));

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  picture: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

const jobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  url: { type: String, required: true },
  interval: { type: Number, required: true },
  status: { type: String, required: true, enum: ['running', 'stopped'], default: 'running' },
  lastPing: { type: Date, default: null },
  logs: [
    {
      time: { type: Date, required: true },
      status: { type: Number, required: true },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Job = mongoose.model('Job', jobSchema);

const app = express();
const jobRunners = new Map();

const corsOptions = {
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

function validateUrl(urlString) {
  try {
    const url = new URL(urlString);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

async function runPing(job) {
  try {
    const response = await axios.get(job.url, { timeout: 10000 });
    const now = new Date();
    await Job.findByIdAndUpdate(job._id, {
      lastPing: now,
      $push: {
        logs: {
          $each: [{ time: now, status: response.status }],
          $slice: -5,
        },
      },
    });
  } catch (error) {
    const now = new Date();
    const statusCode = error.response?.status || 0;
    await Job.findByIdAndUpdate(job._id, {
      lastPing: now,
      $push: {
        logs: {
          $each: [{ time: now, status: statusCode }],
          $slice: -5,
        },
      },
    });
  }
}

function startJobInterval(job) {
  const jobId = job._id.toString();
  if (jobRunners.has(jobId)) {
    return;
  }

  const intervalMs = job.interval * 1000;
  runPing(job).catch(console.error);

  const timer = setInterval(() => {
    runPing(job).catch(console.error);
  }, intervalMs);

  jobRunners.set(jobId, timer);
}

function stopJobInterval(jobId) {
  const timer = jobRunners.get(jobId);
  if (timer) {
    clearInterval(timer);
    jobRunners.delete(jobId);
  }
}

async function recoverRunningJobs() {
  const jobs = await Job.find({ status: 'running' });
  jobs.forEach((job) => startJobInterval(job));
  console.log(`Recovered ${jobs.length} running job(s) on startup.`);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

app.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

app.post('/auth/google', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Google credential token is required.' });
  }

  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google token payload.' });
    }

    const user = await User.findOneAndUpdate(
      { email: payload.email },
      {
        email: payload.email,
        name: payload.name || payload.email,
        picture: payload.picture || '',
        createdAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    req.session.userId = user._id;
    res.json({ user: { id: user._id, email: user.email, name: user.name, picture: user.picture } });
  } catch (error) {
    console.error('Google verify error:', error);
    res.status(401).json({ error: 'Unable to verify Google credentials.' });
  }
});

app.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found.' });
  }
  res.json({ id: user._id, email: user.email, name: user.name, picture: user.picture });
});

app.get('/jobs', requireAuth, async (req, res) => {
  const jobs = await Job.find({ userId: req.session.userId }).sort({ createdAt: -1 });
  res.json({ jobs });
});

app.post('/start', requireAuth, async (req, res) => {
  const { url, interval } = req.body;
  if (!url || !interval) {
    return res.status(400).json({ error: 'URL and interval are required.' });
  }
  if (!validateUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL. Use http:// or https://.' });
  }

  const parsedInterval = Number(interval);
  const allowedIntervals = [60, 300, 600];
  if (!allowedIntervals.includes(parsedInterval)) {
    return res.status(400).json({ error: 'Interval must be one of 60, 300, or 600 seconds.' });
  }

  const job = new Job({
    userId: req.session.userId,
    url,
    interval: parsedInterval,
    status: 'running',
    lastPing: null,
    logs: [],
    createdAt: new Date(),
  });

  await job.save();
  startJobInterval(job);
  res.json({ job });
});

app.post('/stop', requireAuth, async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required.' });
  }

  const job = await Job.findOne({ _id: jobId, userId: req.session.userId });
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  if (job.status === 'stopped') {
    return res.json({ job });
  }

  job.status = 'stopped';
  await job.save();
  stopJobInterval(jobId);
  res.json({ job });
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Unable to log out.' });
    }
    res.clearCookie('connect.sid', { sameSite: 'none', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  await recoverRunningJobs();
  console.log(`DevuPing server running on port ${PORT}`);
});
