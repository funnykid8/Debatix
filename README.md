# Debatrix — no sign-in version

Folder layout:
- public/index.html  the app page
- api/build.js       server function that calls Groq with YOUR free key
- vercel.json        lets the function run up to 60 seconds

## Deploy (about 10 minutes, free to host)
1. Make a free account at console.groq.com and create an API key. No card is needed for the free plan.
2. Put this folder in a GitHub repository (github.com > New repository > upload these files).
3. Go to vercel.com, sign in with GitHub, click Add New > Project, pick the repository, then Deploy.
4. In the Vercel project: Settings > Environment Variables. Add GROQ_API_KEY with your key. Optional: add GROQ_MODEL to choose a model from console.groq.com/docs/models (the default is openai/gpt-oss-120b; if it stops working, pick another there). Then Deployments > Redeploy.
5. Open your Vercel link. Anyone can use it without signing in.

## Keep it safe
- Never put the key inside index.html. It only goes in the Vercel setting.
- The free plan has rate limits (requests per minute and per day, set per model). If many people use the app at once, some will see "Too many requests". Check your limits at console.groq.com/settings/limits.
- api/build.js currently applies a best-effort in-memory limit of 10 cases per hour per visitor/IP on each server instance; this is not a durable shared limit across all Vercel instances.
- Open models can make up sources more often than bigger ones. Tell users to use the Find source link on every point.
