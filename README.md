# DevuPing 🚀

DevuPing is a full-stack SaaS-style web app for keeping backend servers alive by continuously pinging a URL at configurable intervals.

## What is included

- Full Node.js + Express backend
- MongoDB Atlas persistence for users and ping jobs
- Google One Tap authentication
- Automatic restart recovery for running ping jobs
- Responsive HTML/CSS/Vanilla JavaScript frontend
- API endpoints for job creation, stopping, and listing

## Folder structure

- `server.js` — backend application logic
- `public/index.html` — frontend UI
- `public/styles.css` — frontend styling
- `public/app.js` — frontend interaction and API integration
- `.env.example` — environment variable template

## Setup

1. Copy `.env.example` into `.env`
2. Set `MONGO_URI`, `GOOGLE_CLIENT_ID`, and `SESSION_SECRET`
3. Install dependencies:

```bash
npm install
```

4. Start the app locally:

```bash
npm run dev
```

5. Open `http://localhost:4000`

## Configuration

- `MONGO_URI`: MongoDB Atlas connection string
- `GOOGLE_CLIENT_ID`: Google Identity Services client ID
- `SESSION_SECRET`: secret for session cookies
- `PORT`: optional server port
- `FRONTEND_ORIGIN`: optional frontend origin for CORS

## Features

- Homepage accessible without login
- Google One Tap sign-in triggered when user starts a ping
- Users can start and stop jobs
- Jobs persist in MongoDB and auto-resume when the server restarts
- Each job retains the last 5 ping logs

## Deployment notes

- Frontend can be hosted on GitHub Pages as a static site
- Backend can be deployed on Railway or similar Node.js hosting
- Ensure the backend `FRONTEND_ORIGIN` is set to your GitHub Pages URL for cross-origin requests

## API Endpoints

- `GET /config` — returns Google client ID
- `POST /auth/google` — verify Google token and create/find user
- `GET /me` — returns current authenticated user
- `GET /jobs` — list user jobs
- `POST /start` — create and start a ping job
- `POST /stop` — stop a ping job
- `POST /logout` — end the session
