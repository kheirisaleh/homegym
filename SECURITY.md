# Security

Home Gym is built for a private home network. Profiles have no passwords by design; anyone who can reach the
app can pick a profile. Do not expose the app itself to the internet. If you need Alexa, expose only
`/alexa/workout` behind a reverse proxy.

Protected areas:

* Server settings (API keys) need the admin PIN and the main account.
* Health and cycle data need a personal PIN and are never sent to the AI with names or dates.

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button instead of a public issue.
