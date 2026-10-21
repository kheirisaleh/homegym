# Alexa skill

Ask Alexa how your training is going, or for a household report, without opening the app.

| Language | Invocation | Example |
| --- | --- | --- |
| English (US, GB) | `home coach` | "Alexa, ask home coach how my training is going." |
| German | `haus trainer` | „Alexa, frag Haus Trainer, wie mein Training läuft." |

Alexa asks who is speaking; answer with the profile name. Then she tells you workouts done out of planned this
week, your leaderboard points, whether today's workout is done and the last message from your coach.
"Daily report" / „Tagesbericht" lists who trained today and everyone's points.

## Setup

1. **Make the server reachable over HTTPS.** Alexa only calls public HTTPS endpoints with a valid certificate,
   for example through a reverse proxy (Caddy, Nginx Proxy Manager) or a Cloudflare Tunnel. Only the path
   `/alexa/workout` needs to be exposed.
2. **Create a custom skill** in the [Alexa developer console](https://developer.amazon.com/alexa/console/ask)
   with "Provision your own" as backend.
3. **Import the interaction model**: in the JSON editor of each language paste the matching file from
   [`alexa/models`](../alexa/models) (`en-US.json`, `en-GB.json`, `de-DE.json`) and build the model.
4. **Endpoint**: HTTPS, `https://<your-domain>/alexa/workout`, certificate type matching your domain.
5. **Tell Home Gym the skill id**: Settings, Alexa, "Alexa skill id" (or `ALEXA_SKILL_ID`). Requests from any
   other skill are rejected.
6. Optional: **"Users Alexa knows"** restricts which profile names Alexa may answer for.
7. Enable the skill for testing on your Amazon account and ask away.

## Security

Every request is checked the way Amazon requires: the signing certificate URL must point to
`s3.amazonaws.com/echo.api/`, the certificate chain and signature are verified, and requests older than
150 seconds are refused. The skill only reads data; it cannot change programs or log workouts.
