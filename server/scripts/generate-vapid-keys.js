// Makes a VAPID key pair for Web Push alerts. Run once:  node server/scripts/generate-vapid-keys.js
// Put the two values in Railway as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Keep the private key secret.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
