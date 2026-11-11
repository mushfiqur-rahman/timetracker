// Entry file for Node.js hosting (Hostinger "Node.js web app": entry file = server.js).
// The app itself lives in server/src; the built website is in server/public.
import('./server/src/index.js').catch(err => {
  console.error('Could not start Time Tracker:', err);
  process.exit(1);
});
