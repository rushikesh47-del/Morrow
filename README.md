# Morrow Chat

Morrow is a React chat app split into `frontend/` (React and Vite) and `backend/` (Express API). MongoDB Atlas stores accounts, connection requests, conversations, and messages. Email/password authentication is handled by the API; passwords are stored as scrypt hashes, and signed sessions use HTTP-only cookies.

## MongoDB Atlas setup

1. Create a MongoDB Atlas cluster and a database user.
2. Allow your development or deployment host to connect in **Network Access**.
3. Copy the cluster connection string and set it as `MONGODB_URI` in `.env` beside the root `package.json`. Replace the connection string's username, password, and database name with your Atlas values.
4. Set `JWT_SECRET` to a private random value of at least 32 characters. For example, generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
5. Run `npm run dev` and open the Vite URL shown in the terminal.

Keep `.env` private and never expose `MONGODB_URI` or `JWT_SECRET` through frontend code or `VITE_*` variables.

## Deploying the backend to Render

Create a **Web Service** in Render for this repository, using the repository root as the root directory, `npm ci` as the build command, and `npm start` as the start command. Set these environment variables on the Render service:

- `MONGODB_URI`: your MongoDB Atlas connection string
- `JWT_SECRET`: a private random value of at least 32 characters
- `NODE_ENV`: `production`
- `FRONTEND_URL`: the exact deployed frontend origin, such as `https://your-app.vercel.app` (no path). Multiple origins can be comma-separated.

Render supplies `PORT` automatically. In the frontend host's environment variables, set `VITE_API_URL` to the Render service URL, such as `https://your-api.onrender.com` (without `/api`), then rebuild/redeploy the frontend. The client appends `/api` automatically. The backend uses secure cross-site cookies in production so sign-in works when the frontend and API are hosted on separate domains.

Allow the Render service to connect in MongoDB Atlas **Network Access**. Keep `MONGODB_URI` and `JWT_SECRET` only in Render's environment settings, never in frontend variables.

## Using chat

Create an account, then use **Send a conversation request** and enter the email address of another registered Morrow user. The recipient can review it in the requests inbox and accept or decline. A conversation is created only after the recipient accepts; then both users can message each other. Sent requests remain pending until the recipient responds. Open clients refresh conversations and request inboxes every four seconds. Members appear online while their signed-in app sends presence heartbeats; they appear offline after signing out or when heartbeats stop for 30 seconds. The other person must have a Morrow account before you can send a request.

## Deploying the frontend to Vercel

The React/Vite frontend is deployed to Vercel, while the Express API runs on Render. `vercel.json` configures Vercel to publish `frontend/dist` and proxy `/api/*` requests to the Render service. This keeps browser API calls and session cookies on the frontend's origin.

1. Push the whole project to GitHub and import the repository in Vercel. Set **Root Directory** to the project root (the folder containing this `package.json`).
2. Use `npm run build` as the build command. The output directory is already configured as `frontend/dist` in `vercel.json`.
3. The API rewrite currently targets `https://morrow-ilnn.onrender.com`. If your Render service URL differs, update the destination in `vercel.json`.
4. On Render, set `FRONTEND_URL` to the exact deployed Vercel origin (for example, `https://your-app.vercel.app`) and redeploy the backend.
5. Keep `MONGODB_URI` and `JWT_SECRET` configured only on Render. Configure MongoDB Atlas Network Access to allow the Render service to connect.
6. Redeploy the Vercel frontend, then test registration, login, and messaging on its public URL.

Existing Firebase accounts and chat data are not migrated automatically. Users must create new accounts in the Atlas-backed app. To run locally in production mode, build with `npm run build`, set `NODE_ENV=production`, configure `MONGODB_URI` and `JWT_SECRET`, and run `npm start`.
